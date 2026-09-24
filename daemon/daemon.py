#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用量统计独立 daemon —— 不依赖 hermes-agent gateway。

- 直读 ~/.hermes/state.db (sqlite3 stdlib)
- HTTP 暴露 /insights?days=N
- 端口动态分配，写 ~/.hermes/plugins/usage-stats/daemon.json
- schema_version 字段保证前后端字段解耦，前端可降级

启动方式: launchd plist (常驻) 或 nohup
停止方式: SIGTERM (LaunchControl / kill $(cat daemon.pid))
"""
import http.server
import json
import os
import signal
import sqlite3
import socketserver
import sys
import time
from datetime import datetime
from urllib.parse import urlparse, parse_qs

SCHEMA_VERSION = 2


def _get_hermes_home():
    """自动检测 Hermes home 目录，支持全平台。

    优先级：
    1. HERMES_HOME 环境变量（用户可自定义）
    2. Windows: %LOCALAPPDATA%\\hermes
    3. macOS / Linux: ~/.hermes
    """
    explicit = os.environ.get("HERMES_HOME", "").strip()
    if explicit:
        return explicit
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA", ""), "hermes")
    return os.path.expanduser("~/.hermes")


HERMES_HOME = _get_hermes_home()
STATE_DB = os.path.join(HERMES_HOME, "state.db")
CONFIG_DIR = os.path.join(HERMES_HOME, "plugins", "usage-stats")
PORT_FILE = os.path.join(CONFIG_DIR, "daemon.json")
PID_FILE = os.path.join(CONFIG_DIR, "daemon.pid")
LOG_FILE = os.path.join(CONFIG_DIR, "daemon.log")

TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")
MAX_PORT = 18999  # 端口范围 18721-18999


def _short_model(model):
    return (model or "unknown").split("/")[-1]


def _safe_dt(ts):
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(float(ts))
    except Exception:
        return None


def _safe_strftime(dt, fmt):
    if not dt:
        return ""
    try:
        return dt.strftime(fmt)
    except Exception:
        return ""


def _parse_json_list(raw):
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, str):
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _log(msg):
    line = f"[{datetime.now().isoformat()}] {msg}"
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line, file=sys.stderr, flush=True)


def _query_sessions(conn, days, since_ts):
    """最近 N 天的 sessions（按 started_at 过滤）。"""
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT id, source, model, started_at, ended_at,
               message_count, tool_call_count, tool_names,
               input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, reasoning_tokens, title
        FROM sessions
        WHERE started_at >= ?
        ORDER BY started_at DESC
        """,
        (since_ts,),
    ).fetchall()
    return rows


def _query_messages(conn, since_ts):
    """聚合 tool 调用次数（从 tool_calls JSON 解析 function.name）。"""
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT m.tool_calls
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE s.started_at >= ?
          AND m.role = 'assistant'
          AND m.tool_calls IS NOT NULL
        """,
        (since_ts,),
    ).fetchall()
    counts = {}
    for (raw,) in rows:
        for fn in _parse_json_list(raw):
            name = fn.get("function", {}).get("name") if isinstance(fn, dict) else None
            if name:
                counts[name] = counts.get(name, 0) + 1
    return sorted(counts.items(), key=lambda x: x[1], reverse=True)[:20]


def _query_skill_metrics(conn, since_ts):
    """统计 system_prompts / system_prompt_hash 的使用。"""
    cur = conn.cursor()
    try:
        rows = cur.execute(
            """
            SELECT COALESCE(s.system_prompt_hash, 'adhoc') AS h,
                   COUNT(*) AS cnt
            FROM sessions s
            WHERE s.started_at >= ?
            GROUP BY h
            ORDER BY cnt DESC
            LIMIT 20
            """,
            (since_ts,),
        ).fetchall()
        return rows
    except Exception:
        return []


def _compute_overview(sessions, tool_rows):
    total_sessions = len(sessions)
    total_messages = sum(s[5] or 0 for s in sessions)
    total_tool_calls = sum(s[6] or 0 for s in sessions)
    total_input = sum(s[8] or 0 for s in sessions)
    total_output = sum(s[9] or 0 for s in sessions)
    total_cache_read = sum(s[10] or 0 for s in sessions)
    total_cache_write = sum(s[11] or 0 for s in sessions)
    total_reasoning = sum(s[12] or 0 for s in sessions)
    total_tokens = total_input + total_output
    durations = []
    for s in sessions:
        a, b_ = s[3], s[4]
        if a and b_:
            durations.append(b_ - a)
    total_hours = sum(durations) / 3600.0 if durations else 0.0
    avg_dur = (sum(durations) / len(durations)) if durations else 0.0
    valid_started = [_safe_dt(s[3]) for s in sessions if s[3]]
    active_days = len({d.date().isoformat() for d in valid_started if d})
    started_ts = [s[3] for s in sessions if s[3]]
    return {
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "total_tool_calls": total_tool_calls,
        "total_tokens": total_tokens,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_cache_read_tokens": total_cache_read,
        "total_cache_write_tokens": total_cache_write,
        "total_reasoning_tokens": total_reasoning,
        "total_hours": round(total_hours, 2),
        "avg_session_duration": round(avg_dur, 2),
        "active_days": active_days,
        "date_range_start": min(started_ts) if started_ts else None,
        "date_range_end": max(started_ts) if started_ts else None,
    }


def _compute_models(sessions):
    bucket = {}
    for s in sessions:
        m = _short_model(s[2])
        b = bucket.setdefault(m, {
            "model": m, "sessions": 0,
            "input_tokens": 0, "output_tokens": 0,
            "cache_read_tokens": 0, "cache_write_tokens": 0,
            "reasoning_tokens": 0, "total_tokens": 0,
        })
        b["sessions"] += 1
        b["input_tokens"] += s[8] or 0
        b["output_tokens"] += s[9] or 0
        b["cache_read_tokens"] += s[10] or 0
        b["cache_write_tokens"] += s[11] or 0
        b["reasoning_tokens"] += s[12] or 0
        b["total_tokens"] = b["input_tokens"] + b["output_tokens"]
    return sorted(bucket.values(), key=lambda x: x["total_tokens"], reverse=True)


def _compute_platforms(sessions):
    bucket = {}
    for s in sessions:
        p = s[1] or "unknown"
        b = bucket.setdefault(p, {
            "platform": p, "sessions": 0, "messages": 0,
            "input_tokens": 0, "output_tokens": 0,
            "total_tokens": 0, "tool_calls": 0,
        })
        b["sessions"] += 1
        b["messages"] += s[5] or 0
        b["tool_calls"] += s[6] or 0
        b["input_tokens"] += s[8] or 0
        b["output_tokens"] += s[9] or 0
        b["total_tokens"] = b["input_tokens"] + b["output_tokens"]
    return sorted(bucket.values(), key=lambda x: x["total_tokens"], reverse=True)


def _compute_tools(tool_counts, total_calls):
    """tool_counts: list[(name, cnt)]"""
    out = []
    for name, cnt in tool_counts:
        pct = (cnt / total_calls * 100) if total_calls else 0
        out.append({"tool": name, "count": cnt, "percentage": round(pct, 2)})
    return out


def _compute_daily_usage(sessions):
    by_day = {}
    for s in sessions:
        dt = _safe_dt(s[3])
        if not dt:
            continue
        date = dt.strftime("%Y-%m-%d")
        day = by_day.setdefault(date, {
            "date": date, "date_label": dt.strftime("%b %d"),
            "sessions": 0, "models": {},
        })
        day["sessions"] += 1
        m = _short_model(s[2])
        mb = day["models"].setdefault(m, {
            "sessions": 0, "input_tokens": 0, "output_tokens": 0,
            "cache_read_tokens": 0, "cache_write_tokens": 0,
            "reasoning_tokens": 0,
        })
        mb["sessions"] += 1
        mb["input_tokens"] += s[8] or 0
        mb["output_tokens"] += s[9] or 0
        mb["cache_read_tokens"] += s[10] or 0
        mb["cache_write_tokens"] += s[11] or 0
        mb["reasoning_tokens"] += s[12] or 0
    return [by_day[d] for d in sorted(by_day)]


def _compute_activity(sessions, overview):
    by_day = {}
    by_hour = [0] * 24
    for s in sessions:
        dt = _safe_dt(s[3])
        if not dt:
            continue
        d = dt.date().isoformat()
        by_day[d] = by_day.get(d, 0) + 1
        by_hour[dt.hour] += 1
    days_sorted = sorted(by_day)
    max_streak = cur = 1
    for i in range(1, len(days_sorted)):
        try:
            prev = datetime.fromisoformat(days_sorted[i - 1]).date()
            curr = datetime.fromisoformat(days_sorted[i]).date()
            if (curr - prev).days == 1:
                cur += 1
                max_streak = max(max_streak, cur)
            else:
                cur = 1
        except Exception:
            cur = 1
    busiest_hour = by_hour.index(max(by_hour)) if by_hour else 0
    return {
        "by_day": [{"date": d, "count": by_day[d]} for d in days_sorted],
        "by_hour": by_hour,
        "max_streak": max_streak,
        "busiest_hour": busiest_hour,
        "active_days": overview["active_days"],
    }


def _compute_skills(skill_rows, total_sessions):
    if not skill_rows:
        return {"summary": {"total_loads": 0, "distinct_skills": 0}, "top": []}
    top = [{"skill_hash": h[:20] + "..." if len(h) > 20 else h, "count": c}
           for h, c in skill_rows[:10]]
    return {
        "summary": {
            "total_loads": sum(c for _, c in skill_rows),
            "distinct_skills": len(skill_rows),
        },
        "top": top,
    }


def build_report(days):
    """主入口：组装完整 insights 报告。"""
    days = max(1, min(int(days or 7), 365))
    since_ts = time.time() - days * 86400
    if not os.path.exists(STATE_DB):
        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": time.time(),
            "days": days,
            "error": "state.db not found",
            "overview": {
                "total_sessions": 0, "total_messages": 0,
                "total_tool_calls": 0, "total_tokens": 0,
                "total_input_tokens": 0, "total_output_tokens": 0,
                "total_cache_read_tokens": 0, "total_cache_write_tokens": 0,
                "total_reasoning_tokens": 0,
                "total_hours": 0.0, "avg_session_duration": 0.0,
                "active_days": 0, "date_range_start": None, "date_range_end": None,
            },
            "models": [], "platforms": [], "tools": [],
            "skills": {"summary": {"total_loads": 0, "distinct_skills": 0}, "top": []},
            "activity": {"by_day": [], "by_hour": [0] * 24,
                         "max_streak": 0, "busiest_hour": 0, "active_days": 0},
            "daily_usage": [],
        }

    conn = sqlite3.connect(STATE_DB, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        sessions_rows = _query_sessions(conn, days, since_ts)
        tool_rows = _query_messages(conn, since_ts)
        skill_rows = _query_skill_metrics(conn, since_ts)
    finally:
        conn.close()

    overview = _compute_overview(sessions_rows, tool_rows)
    models = _compute_models(sessions_rows)
    platforms = _compute_platforms(sessions_rows)
    tools = _compute_tools(tool_rows, overview["total_tool_calls"])
    daily = _compute_daily_usage(sessions_rows)
    activity = _compute_activity(sessions_rows, overview)
    skills = _compute_skills(skill_rows, overview["total_sessions"])

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": time.time(),
        "days": days,
        "overview": overview,
        "models": models,
        "platforms": platforms,
        "tools": tools,
        "skills": skills,
        "activity": activity,
        "daily_usage": daily,
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        _log(f"HTTP {self.address_string()} - {fmt % args}")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            self._json(200, {"ok": True, "schema_version": SCHEMA_VERSION})
            return
        if u.path == "/insights":
            q = parse_qs(u.query)
            days = int((q.get("days") or ["7"])[0])
            try:
                report = build_report(days)
                self._json(200, report)
            except Exception as e:
                _log(f"build_report error: {e}")
                self._json(500, {"error": str(e), "schema_version": SCHEMA_VERSION})
            return
        if u.path == "/" or u.path == "/index.html":
            self._json(200, {
                "name": "usage-stats daemon",
                "schema_version": SCHEMA_VERSION,
                "endpoints": ["/health", "/insights?days=N"],
            })
            return
        self._json(404, {"error": "not found"})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def _find_port():
    """从 18721 起找一个空闲端口。"""
    import socket as sk
    for p in range(18721, MAX_PORT + 1):
        with sk.socket(sk.AF_INET, sk.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise RuntimeError("no free port in 18721-18999")


def _write_port_file(port, pid):
    with open(PORT_FILE, "w") as f:
        json.dump({
            "port": port, "pid": pid,
            "schema_version": SCHEMA_VERSION,
            "started_at": time.time(),
            "version": 1,
        }, f, indent=2)
    with open(PID_FILE, "w") as f:
        f.write(str(pid))


def _cleanup():
    for p in (PORT_FILE, PID_FILE):
        try:
            os.remove(p)
        except FileNotFoundError:
            pass


def main():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    port = _find_port()
    pid = os.getpid()
    _write_port_file(port, pid)
    _log(f"daemon start pid={pid} port={port} state_db={STATE_DB}")

    def _term(signum, frame):
        _log(f"received signal {signum}, shutting down")
        _cleanup()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)

    class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    try:
        with ThreadingServer(("127.0.0.1", port), Handler) as srv:
            _log(f"listening on 127.0.0.1:{port}")
            srv.serve_forever()
    finally:
        _cleanup()


if __name__ == "__main__":
    main()