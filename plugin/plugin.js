/**
 * Hermes 用量统计插件（v5 — 独立数据源版）
 *
 * 架构:
 *   - 数据源: ~/.hermes/plugins/usage-stats/daemon.py (独立 Python 进程)
 *   - 通信:   fetch('http://127.0.0.1:'+port+'/insights?days=N')
 *   - 端口协商: 端口扫描 18721-18999（daemon 写实际端口到 daemon.json）
 *
 * 与 v4 的差异:
 *   - 不依赖 host.request('insights.get')
 *   - 不依赖 gateway / hermes-agent 任何模块
 *   - Hermes update / gateway 重启不影响此按钮
 *   - daemon 挂了有 3 次重试（1s/2s/3s）
 *
 * 数据 schema: { schema_version: 2, overview, models, platforms, tools,
 *                skills, activity, daily_usage, ... }
 * 当前版本不匹配时降级（按 key 访问，缺失字段 fallback）。
 */
import { cn, host, usePluginI18n, Button, Badge, Skeleton, ScrollArea } from '@hermes/plugin-sdk'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import React, { useState, useEffect, useCallback, useMemo, useRef, Component } from 'react'

var ID = 'usage-stats'

// ─── 自诊断错误边界 ─────────────────────────────────────────
function dumpError(err) {
  try {
    console.error('[usage-stats][diagnose] RENDER ERROR:', err && err.stack ? err.stack : String(err))
  } catch (e2) {}
}

class DiagBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }
  static getDerivedStateFromError(err) {
    return { err: err }
  }
  componentDidCatch(err, info) {
    dumpError(err)
    try {
      console.error('[usage-stats][diagnose] COMPONENT STACK:', info && info.componentStack)
    } catch (e2) {}
  }
  render() {
    if (this.state.err) {
      return jsx('div', { className: 'p-6 text-sm text-(--ui-text-tertiary)', children: '[usage-stats] crashed: ' + (this.state.err && this.state.err.message) })
    }
    return this.props.children
  }
}

// ─── 工具函数 ────────────────────────────────────────────────

function formatTokens(n) {
  if (n == null) return '-'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function formatDuration(seconds) {
  if (!seconds) return '-'
  var h = Math.floor(seconds / 3600)
  var m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return h + 'h ' + m + 'm'
  return m + 'm'
}

function formatDate(ts) {
  if (!ts) return '-'
  var d = new Date(ts * 1000)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

var MODEL_COLOR_POOL = ['#4CAF50', '#9C27B0', '#FF9800', '#F44336']

async function fetchDaemonJSON(path) {
  for (var p = 18721; p <= 18999; p++) {
    try {
      var c = new AbortController()
      var timer = setTimeout(function () { c.abort() }, 600)
      var r = await fetch('http://127.0.0.1:' + p + path, { signal: c.signal })
      clearTimeout(timer)
      if (r.ok) return r.json()
    } catch (e) {}
  }
  throw new Error('daemon unreachable on 18721-18999')
}

function UsagePane() {
  var t = usePluginI18n(ID)
  var tr = (typeof t === 'function') ? t : function (k) { return k }

  var _useState = useState(null), data = _useState[0], setData = _useState[1]
  var _useState2 = useState(false), loading = _useState2[0], setLoading = _useState2[1]
  var _useState3 = useState(7), days = _useState3[0], setDays = _useState3[1]
  var _useState4 = useState(null), error = _useState4[0], setError = _useState4[1]

  console.error('[usage-stats] USAGE-PANE MOUNTED')
  var lastFetchedDaysRef = useRef(null)

  var fetchInsights = useCallback(function (d) {
    if (lastFetchedDaysRef.current === d) return
    lastFetchedDaysRef.current = d

    setLoading(true)
    setError(null)

    var attempts = 0
    function doRequest() {
      fetchDaemonJSON('/insights?days=' + d).then(function (result) {
        console.error('[usage-stats] daemon result: schema_v=' + result.schema_version + ' sessions=' + (result.overview && result.overview.total_sessions))
        setData(result)
        setLoading(false)
      }).catch(function (e) {
        var msg = (e && e.message) || String(e)
        if (attempts < 3) {
          attempts++
          console.error('[usage-stats] daemon fetch fail, retry ' + attempts + '/3 in ' + (1000 * attempts) + 'ms:', msg)
          setTimeout(doRequest, 1000 * attempts)
        } else {
          console.error('[usage-stats] daemon fetch failed after retries:', e)
          lastFetchedDaysRef.current = null
          setError(tr('fetchError') + ' (' + msg + ')')
          setData(null)
          setLoading(false)
        }
      })
    }
    setTimeout(doRequest, 100)
  }, [t])

  useEffect(function () {
    fetchInsights(days)
  }, [])

  useEffect(function () {
    if (days !== 7) {
      fetchInsights(days)
    }
  }, [days, fetchInsights])

  var dayOptions = [7, 14, 30, 90]
  var ov = data && data.overview
  var hasData = !loading && !error && data && ov && ov.total_sessions > 0

  return jsx(ScrollArea, {
    className: 'h-full',
    children: jsxs('div', {
      className: 'flex h-full flex-col gap-4 p-5',
      children: [
        jsxs('div', {
          className: 'flex items-center justify-between shrink-0',
          children: [
            jsxs('div', { className: 'text-lg font-semibold flex items-center gap-2', children: [
              '📊 ', tr('title'),
              data && jsx('span', { className: 'text-xs text-(--ui-text-tertiary) font-normal', children: 'v' + data.schema_version })
            ] }),
            jsx('div', { className: 'flex items-center gap-1', children: dayOptions.map(function (d) {
              return jsx('button', {
                className: cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  days === d
                    ? 'bg-(--ui-accent) text-white shadow-sm'
                    : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)'),
                onClick: function () { setDays(d) },
                children: d + tr('days')
              }, d)
            }) })
          ]
        }),

        loading && jsx('div', {
          className: 'flex flex-col gap-3',
          children: [1, 2, 3, 4, 5, 6].map(function (i) { return jsx(Skeleton, { className: 'h-16 w-full' }, i) })
        }),

        error && !loading && jsxs('div', {
          className: 'flex flex-col items-center gap-3 py-12 text-(--ui-text-tertiary)',
          children: [
            jsx('div', { className: 'text-4xl', children: '⚠️' }),
            jsx('div', { className: 'text-sm max-w-md text-center', children: error }),
            jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('daemonHint') }),
            jsx(Button, { size: 'sm', variant: 'secondary', onClick: function () { fetchInsights(days) }, children: tr('retry') })
          ]
        }),

        !loading && !error && !hasData && jsx('div', {
          className: 'flex flex-col items-center gap-3 py-12 text-(--ui-text-tertiary)',
          children: [jsx('div', { className: 'text-4xl', children: '📭' }), jsx('div', { className: 'text-sm', children: tr('noData') })]
        }),

        hasData && jsxs('div', {
          className: 'flex flex-col gap-4',
          children: [
            OverviewCards(tr, ov),
            ModelsSection(tr, data.models || [], ov.total_tokens),
            jsxs('div', { className: 'grid grid-cols-1 lg:grid-cols-2 gap-4', children: [
              PlatformsSection(tr, data.platforms || []),
              ToolsSection(tr, data.tools || []),
            ] }),
            jsxs('div', { className: 'grid grid-cols-1 lg:grid-cols-2 gap-4', children: [
              SkillsSection(tr, data.skills),
              ActivitySection(tr, data.activity, ov),
            ] }),
            jsx(DailyUsageChart, { t: tr, dailyUsage: data.daily_usage || [] }),
            jsxs('div', { className: 'text-xs text-(--ui-text-tertiary) text-center pt-1', children: [
              tr('dateRange'), ': ', formatDate(ov.date_range_start), ' — ', formatDate(ov.date_range_end)
            ] })
          ]
        }),

        jsx('div', { className: 'flex justify-center pt-2', children: jsx(Button, {
          size: 'sm', variant: 'secondary',
          onClick: function () { fetchInsights(days) },
          children: tr('refresh')
        }) })
      ]
    })
  })
}

function OverviewCards(t, ov) {
  var cards = [
    { icon: '🗓️', label: t('sessions'), value: ov.total_sessions, sub: ov.total_sessions + ' total' },
    { icon: '💬', label: t('messages'), value: ov.total_messages, sub: Math.round(ov.total_messages / Math.max(ov.total_sessions, 1)) + '/session' },
    { icon: '🔧', label: t('toolCalls'), value: ov.total_tool_calls, sub: Math.round(ov.total_tool_calls / Math.max(ov.total_sessions, 1)) + '/session' },
    { icon: '🧮', label: t('totalTokens'), value: formatTokens(ov.total_tokens), sub: '↓' + formatTokens(ov.total_input_tokens) + ' ↑' + formatTokens(ov.total_output_tokens) },
    { icon: '📖', label: t('cacheRead'), value: formatTokens(ov.total_cache_read_tokens), sub: 'cache hit' },
    { icon: '⏱️', label: t('activeTime'), value: formatDuration(ov.total_hours * 3600), sub: formatDuration(ov.avg_session_duration) + '/session' },
  ]
  return jsx('div', {
    className: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2',
    children: cards.map(function (c, i) {
      return jsxs('div', {
        className: 'rounded-lg border border-(--ui-stroke-secondary) p-3 flex flex-col gap-1',
        children: [
          jsx('div', { className: 'text-[0.65rem] text-(--ui-text-tertiary) uppercase tracking-wide', children: c.icon + ' ' + c.label }),
          jsx('div', { className: 'text-base font-bold leading-tight', children: c.value }),
          jsx('div', { className: 'text-[0.65rem] text-(--ui-text-tertiary)', children: c.sub })
        ]
      }, i)
    })
  })
}

function ModelsSection(t, models, totalTokens) {
  if (!models || !models.length) return null
  var sorted = models.slice().sort(function (a, b) { return b.total_tokens - a.total_tokens })
  return jsxs('div', {
    className: 'rounded-lg border border-(--ui-stroke-secondary) p-4',
    children: [
      jsx('div', { className: 'text-sm font-semibold mb-3 flex items-center gap-2', children: '🤖 ' + t('models') }),
      jsx('div', { className: 'flex flex-col gap-2', children: sorted.slice(0, 8).map(function (m, i) {
        var pct = totalTokens > 0 ? (m.total_tokens / totalTokens * 100) : 0
        var barColor = MODEL_COLOR_POOL[i % MODEL_COLOR_POOL.length]
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsxs('div', { className: 'flex items-center justify-between text-xs', children: [
              jsxs('div', { className: 'flex items-center gap-2', children: [
                jsx('span', { className: 'font-medium text-(--ui-text-primary)', children: m.model }),
                jsx('span', { className: 'text-(--ui-text-tertiary)', children: m.sessions + ' sess' })
              ] }),
              jsxs('div', { className: 'flex items-center gap-2 text-(--ui-text-secondary)', children: [
                jsx('span', { children: formatTokens(m.total_tokens) }),
                jsx('span', { className: 'text-(--ui-text-tertiary) w-12 text-right', children: pct.toFixed(1) + '%' })
              ] })
            ] }),
            jsx('div', { className: 'h-2.5 rounded-full bg-(--chrome-action-hover) overflow-hidden', children: jsx('div', {
              className: 'h-full rounded-full transition-all',
              style: { width: Math.max(2, pct) + '%', backgroundColor: barColor }
            }) })
          ]
        }, i)
      }) })
    ]
  })
}

function PlatformsSection(t, platforms) {
  if (!platforms || !platforms.length) return null
  var sorted = platforms.slice().sort(function (a, b) { return b.total_tokens - a.total_tokens })
  var total = sorted.reduce(function (s, p) { return s + p.total_tokens }, 0) || 1
  return jsxs('div', {
    className: 'rounded-lg border border-(--ui-stroke-secondary) p-4',
    children: [
      jsx('div', { className: 'text-sm font-semibold mb-3 flex items-center gap-2', children: '💻 ' + t('platforms') }),
      jsx('div', { className: 'flex flex-col gap-2', children: sorted.map(function (p, i) {
        var pct = p.total_tokens / total * 100
        return jsxs('div', {
          className: 'flex items-center justify-between text-xs',
          children: [
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('span', { className: 'font-medium', children: p.platform }),
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: p.sessions + ' sess' })
            ] }),
            jsxs('div', { className: 'flex items-center gap-2 text-(--ui-text-secondary)', children: [
              jsx('span', { children: formatTokens(p.total_tokens) }),
              jsx('span', { className: 'text-(--ui-text-tertiary) w-12 text-right', children: pct.toFixed(1) + '%' })
            ] })
          ]
        }, i)
      }) })
    ]
  })
}

function ToolsSection(t, tools) {
  if (!tools || !tools.length) return null
  var sorted = tools.slice().sort(function (a, b) { return b.count - a.count })
  return jsxs('div', {
    className: 'rounded-lg border border-(--ui-stroke-secondary) p-4',
    children: [
      jsx('div', { className: 'text-sm font-semibold mb-3 flex items-center gap-2', children: '🔧 ' + t('topTools') }),
      jsx('div', { className: 'flex flex-col gap-1.5', children: sorted.slice(0, 8).map(function (tool, i) {
        return jsxs('div', {
          className: 'flex items-center justify-between text-xs',
          children: [
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('span', { className: 'w-5 text-(--ui-text-tertiary) font-mono', children: '#' + (i + 1) }),
              jsx('span', { className: 'font-medium', children: tool.tool })
            ] }),
            jsxs('div', { className: 'flex items-center gap-2 text-(--ui-text-secondary)', children: [
              jsx('span', { children: tool.count }),
              jsx('span', { className: 'text-(--ui-text-tertiary) w-12 text-right', children: tool.percentage.toFixed(1) + '%' })
            ] })
          ]
        }, i)
      }) })
    ]
  })
}

function SkillsSection(t, skills) {
  if (!skills || !skills.summary) return null
  var s = skills.summary
  var top = skills.top || []
  return jsxs('div', {
    className: 'rounded-lg border border-(--ui-stroke-secondary) p-4',
    children: [
      jsx('div', { className: 'text-sm font-semibold mb-3 flex items-center gap-2', children: '🎯 ' + t('skills') }),
      jsxs('div', { className: 'grid grid-cols-2 gap-3', children: [
        jsxs('div', { className: 'rounded-md bg-(--chrome-action-hover) p-3', children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: t('skillLoads') }),
          jsx('div', { className: 'text-lg font-bold', children: s.total_loads || 0 })
        ] }),
        jsxs('div', { className: 'rounded-md bg-(--chrome-action-hover) p-3', children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: t('distinctSkills') }),
          jsx('div', { className: 'text-lg font-bold', children: s.distinct_skills || 0 })
        ] })
      ] }),
      top.length > 0 && jsx('div', { className: 'mt-3 flex flex-col gap-1.5', children: top.slice(0, 5).map(function (sk, i) {
        return jsxs('div', {
          className: 'flex items-center justify-between text-xs',
          children: [
            jsx('span', { className: 'font-medium truncate', children: sk.skill_hash }),
            jsx('span', { className: 'text-(--ui-text-tertiary)', children: sk.count })
          ]
        }, i)
      }) })
    ]
  })
}

function ActivitySection(t, activity, ov) {
  if (!activity) return null
  return jsxs('div', {
    className: 'rounded-lg border border-(--ui-stroke-secondary) p-4',
    children: [
      jsx('div', { className: 'text-sm font-semibold mb-3 flex items-center gap-2', children: '🔥 ' + t('activity') }),
      jsxs('div', { className: 'grid grid-cols-2 gap-3', children: [
        jsxs('div', { className: 'rounded-md bg-(--chrome-action-hover) p-3', children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: t('activeDays') }),
          jsx('div', { className: 'text-lg font-bold', children: activity.active_days || 0 })
        ] }),
        jsxs('div', { className: 'rounded-md bg-(--chrome-action-hover) p-3', children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: t('maxStreak') }),
          jsx('div', { className: 'text-lg font-bold', children: (activity.max_streak || 0) + ' ' + t('days') })
        ] })
      ] }),
      activity.by_hour && jsx('div', { className: 'mt-3', children:
        jsx('div', { className: 'flex items-end gap-0.5 h-12', children: activity.by_hour.map(function (cnt, i) {
          var mx = Math.max.apply(null, activity.by_hour) || 1
          var h = Math.max(2, cnt / mx * 48)
          return jsx('div', {
            className: 'flex-1 rounded-sm',
            style: { height: h + 'px', backgroundColor: cnt > 0 ? '#4CAF50' : 'var(--chrome-action-hover)' },
            title: i + ':00 — ' + cnt + ' sessions'
          }, i)
        }) })
      })
    ]
  })
}

function DailyUsageChart(props) {
  var t = props.t
  var dailyUsage = props.dailyUsage || []
  var _useState1 = useState(new Set()), hiddenModels = _useState1[0], setHiddenModels = _useState1[1]

  var days = (dailyUsage && dailyUsage.length) ? dailyUsage.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1 }) : []

  var modelTotals = useMemo(function () {
    var m = {}
    for (var i = 0; i < days.length; i++) {
      var models = days[i].models || {}
      for (var k in models) {
        if (!Object.prototype.hasOwnProperty.call(models, k)) continue
        var inp = (models[k].input_tokens || 0) + (models[k].output_tokens || 0)
        m[k] = (m[k] || 0) + inp
      }
    }
    return m
  }, [days])

  var models = Object.keys(modelTotals).sort(function (a, b) { return modelTotals[b] - modelTotals[a] })
  var visibleModels = models.filter(function (m) { return !hiddenModels.has(m) })

  var P = useMemo(function () { return { left: 50, right: 20, top: 10, bottom: 30 } }, [])
  var PW = 600 - P.left - P.right
  var PH = 200 - P.top - P.bottom

  function maxValFn() {
    var mx = 1
    for (var i = 0; i < days.length; i++) {
      var models = days[i].models || {}
      for (var k in models) {
        if (hiddenModels.has(k)) continue
        var v = (models[k].input_tokens || 0) + (models[k].output_tokens || 0)
        if (v > mx) mx = v
      }
    }
    return mx
  }
  var maxVal = maxValFn()
  var n = days.length

  function x(i) { return P.left + (n > 1 ? (i / (n - 1)) * PW : PW / 2) }
  function y(v) { return P.top + PH - (v / maxVal) * PH }

  if (!days.length) {
    return jsx('div', { className: 'rounded-lg border border-(--ui-stroke-secondary) p-4 text-(--ui-text-tertiary) text-sm text-center', children: t('noData') })
  }

  var colorFor = {}
  for (var ci = 0; ci < visibleModels.length; ci++) colorFor[visibleModels[ci]] = MODEL_COLOR_POOL[ci % MODEL_COLOR_POOL.length]

  var series = visibleModels.map(function (m) {
    var pts = []
    for (var i = 0; i < days.length; i++) {
      var mb = days[i].models[m] || { input_tokens: 0, output_tokens: 0 }
      var v = (mb.input_tokens || 0) + (mb.output_tokens || 0)
      pts.push({ x: x(i), y: y(v), v: v, d: days[i].date })
    }
    return { model: m, points: pts, color: colorFor[m] }
  })

  return jsx('div', {
    className: 'rounded-lg border border-(--ui-stroke-secondary) p-4',
    children: jsxs('div', { children: [
      jsx('div', { className: 'text-sm font-semibold mb-3 flex items-center justify-between', children:
        jsxs('div', { className: 'flex items-center gap-2', children: ['📈 ', t('chartTitle')] })
      }),
      jsxs('div', { className: 'flex flex-wrap gap-2 mb-2', children: [
        models.map(function (m) {
          var hidden = hiddenModels.has(m)
          return jsx('button', {
            className: cn('text-[10px] px-2 py-0.5 rounded border transition-colors',
              hidden
                ? 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'
                : 'border-transparent text-white'),
            style: hidden ? {} : { backgroundColor: colorFor[m] || '#888' },
            onClick: function () {
                var next = new Set(hiddenModels)
                if (hidden) next.delete(m); else next.add(m)
                setHiddenModels(next)
              },
            children: m + (hidden ? ' (hidden)' : '')
          }, m)
        })
      ] }),
      jsx('svg', {
        viewBox: '0 0 600 200', className: 'w-full h-auto',
        children: jsxs('g', { children: [
          [0, 0.25, 0.5, 0.75, 1].map(function (p, i) {
            var yp = P.top + PH - p * PH
            return jsxs('g', { key: 'ytick-' + i, children: [
              jsx('line', { x1: P.left, y1: yp, x2: P.left + PW, y2: yp, stroke: 'var(--ui-stroke-secondary)', strokeWidth: 0.5, strokeDasharray: '2,2' }),
              jsx('text', { x: P.left - 5, y: yp + 3, fontSize: 9, textAnchor: 'end', fill: 'var(--ui-text-tertiary)', children: formatTokens(Math.round(maxVal * p)) })
            ] })
          }),
          days.map(function (d, i) {
            if (n > 1 && i !== 0 && i !== n - 1 && i !== Math.floor(n / 2)) return null
            return jsx('text', {
              key: 'xtick-' + i,
              x: x(i), y: P.top + PH + 15,
              fontSize: 9, textAnchor: 'middle',
              fill: 'var(--ui-text-tertiary)',
              children: d.date_label
            })
          }),
          series.map(function (s) {
            if (!s.points.length) return null
            var path = s.points.map(function (p, i) {
              return (i === 0 ? 'M' : 'L') + p.x + ',' + p.y
            }).join(' ')
            return jsxs('g', { key: 'line-' + s.model, children: [
              jsx('path', { d: path, fill: 'none', stroke: s.color, strokeWidth: 2 }),
              s.points.map(function (p, i) {
                return jsx('circle', { key: 'pt-' + s.model + '-' + i, cx: p.x, cy: p.y, r: 3, fill: s.color, stroke: '#fff', strokeWidth: 1 })
              })
            ] })
          })
        ] })
      })
    ] })
  })
}

function UsageChip() {
  var t = usePluginI18n(ID)
  var tr = (typeof t === 'function') ? t : function (k) { return k }
  return jsx('button', {
    className: cn(
      'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
      'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
      'transition-colors'
    ),
    title: tr('chipLabel'),
    onClick: function () {
      host.navigate('/usage-stats')
    },
    children: '📊 ' + tr('chipLabel')
  })
}

export default {
  id: ID,
  version: '5.0.0',
  register: function (ctx) {
    ctx.i18n.register({
      en: {
        title: 'Usage Stats', days: 'd',
        sessions: 'Sessions', messages: 'Messages', toolCalls: 'Tool Calls',
        activeTime: 'Active Time', tokens: 'Tokens',
        inputTokens: 'Input', outputTokens: 'Output', totalTokens: 'Total Tokens',
        cacheRead: 'Cache Read', cacheWrite: 'Cache Write',
        costs: 'Cost', estimatedCost: 'Estimated',
        models: 'Models', platforms: 'Platforms', topTools: 'Top Tools',
        activity: 'Activity', skills: 'Skills',
        skillLoads: 'Loads', skillEdits: 'Edits', skillActions: 'Actions',
        distinctSkills: 'Distinct',
        refresh: 'Refresh', loading: 'Loading...', retry: 'Retry',
        fetchError: 'Failed to load. Make sure the daemon is installed.',
        daemonHint: 'Run: bash ~/.hermes/plugins/usage-stats/manage.sh install',
        chipLabel: 'Usage', noData: 'No data',
        dateRange: 'Range', activeDays: 'Active days', maxStreak: 'Max streak',
        avgMessagesPerSession: 'Avg msgs/session',
        chartTitle: 'Daily usage trend', tokensIn: 'In', tokensOut: 'Out',
        show: 'Show', hide: 'Hide',
      },
      zh: {
        title: '用量统计', days: ' 天',
        sessions: '会话数', messages: '消息数', toolCalls: '工具调用',
        activeTime: '活跃时间', tokens: 'Token 用量',
        inputTokens: '输入', outputTokens: '输出', totalTokens: '总 Token',
        cacheRead: '缓存读取', cacheWrite: '缓存写入',
        costs: '费用', estimatedCost: '估算费用',
        models: '模型用量', platforms: '平台分布', topTools: '工具排名',
        activity: '活动模式', skills: '技能统计',
        skillLoads: '加载次数', skillEdits: '编辑次数', skillActions: '操作次数',
        distinctSkills: '使用技能数',
        refresh: '刷新', loading: '加载中...', retry: '重试',
        fetchError: '加载失败，请确认 daemon 已安装。',
        daemonHint: '运行: bash ~/.hermes/plugins/usage-stats/manage.sh install',
        chipLabel: '用量', noData: '暂无数据',
        dateRange: '时间范围', activeDays: '活跃天数', maxStreak: '最长连续',
        avgMessagesPerSession: '平均每会话消息',
        chartTitle: '每日用量趋势', tokensIn: '输入', tokensOut: '输出',
        show: '显示', hide: '隐藏',
      }
    })

    ctx.register({
      id: 'route',
      area: 'routes',
      data: { path: '/usage-stats' },
      title: '📊 Usage Stats',
      render: function () {
        return jsx(DiagBoundary, {
          children: jsx(React.Suspense, {
            fallback: jsx('div', { className: 'flex h-full items-center justify-center text-(--ui-text-tertiary)', children: '加载中...' }),
            children: jsx(UsagePane, {})
          })
        })
      }
    })

    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 100,
      render: function () { return jsx(UsageChip, {}) }
    })
  }
}
