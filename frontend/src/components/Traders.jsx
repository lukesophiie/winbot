import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  TrendingUp, TrendingDown, Play, Square, RotateCcw,
  ChevronDown, ChevronRight, Trophy, Users, PlayCircle, Radio,
} from 'lucide-react'

// ── Colour mappings ───────────────────────────────────────────────────────────
const COLOR_MAP = {
  red:    { badge: 'bg-red-500/15 text-red-400 border border-red-500/25',    dot: 'bg-red-500',    ring: 'ring-red-500/30',    text: 'text-red-400',    header: 'from-red-500/10'    },
  orange: { badge: 'bg-orange-500/15 text-orange-400 border border-orange-500/25', dot: 'bg-orange-500', ring: 'ring-orange-500/30', text: 'text-orange-400', header: 'from-orange-500/10' },
  blue:   { badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',   dot: 'bg-blue-500',   ring: 'ring-blue-500/30',   text: 'text-blue-400',   header: 'from-blue-500/10'   },
  green:  { badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25', dot: 'bg-emerald-500', ring: 'ring-emerald-500/30', text: 'text-emerald-400', header: 'from-emerald-500/10' },
  slate:  { badge: 'bg-slate-500/15 text-slate-400 border border-slate-500/25', dot: 'bg-slate-400',  ring: 'ring-slate-500/30',  text: 'text-slate-400',  header: 'from-slate-500/10'  },
}

const c = (color) => COLOR_MAP[color] || COLOR_MAP.slate

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt$ = (n) =>
  (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtPct = (n) => `${(n ?? 0) >= 0 ? '+' : ''}${(n ?? 0).toFixed(2)}%`

const toAEST = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts.includes('T') ? ts + (ts.endsWith('Z') ? '' : 'Z') : ts + 'Z')
  return d.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

const fmtPnl = (n) => (
  <span className={(n ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
    {(n ?? 0) >= 0 ? '+' : ''}{fmt$(n)}
  </span>
)

// ── Leaderboard row ───────────────────────────────────────────────────────────
function LeaderboardRow({ trader, rank, selected, onClick }) {
  const col = c(trader.color)
  const pnl = trader.pnl ?? 0
  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${
        selected
          ? `bg-navy-700/60 ring-1 ring-inset ${col.ring}`
          : 'hover:bg-navy-700/30'
      }`}
    >
      <td className="px-4 py-3 text-center">
        {rank === 1 ? (
          <Trophy size={14} className="text-yellow-400 mx-auto" />
        ) : (
          <span className="text-slate-400 text-sm font-mono">{rank}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{trader.emoji}</span>
          <span className={`font-semibold ${col.text}`}>{trader.display_name}</span>
        </div>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className={`text-xs px-2 py-0.5 rounded-full ${col.badge}`}>
          {trader.style}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-sm text-slate-200">
        {fmt$(trader.portfolio_value)}
      </td>
      <td className="px-4 py-3 font-mono text-sm">
        <div className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          {pnl >= 0 ? '+' : ''}{fmt$(pnl)}
        </div>
        <div className={`text-xs ${pnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
          {fmtPct(trader.pnl_pct)}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-300 hidden md:table-cell">
        {trader.win_rate?.toFixed(1)}%
      </td>
      <td className="px-4 py-3 text-sm text-slate-400 hidden lg:table-cell">
        {trader.total_trades}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              trader.is_running ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span className="text-xs text-slate-400 hidden sm:inline">
            {trader.is_running ? 'Active' : 'Idle'}
          </span>
        </div>
      </td>
    </tr>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'slate' }) {
  return (
    <div className="stat-card">
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold font-mono mt-1 ${color === 'slate' ? 'text-slate-100' : ''}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Decision row ──────────────────────────────────────────────────────────────
function DecisionRow({ d }) {
  const [open, setOpen] = useState(false)
  const actionColors = {
    BUY:   'text-emerald-400 bg-emerald-500/10',
    SELL:  'text-red-400 bg-red-500/10',
    SHORT: 'text-orange-400 bg-orange-500/10',
    COVER: 'text-blue-400 bg-blue-500/10',
    HOLD:  'text-slate-400 bg-slate-500/10',
  }
  const ac = actionColors[d.action] || actionColors.HOLD
  return (
    <div className="border-b border-slate-700/40 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700/20 text-left transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-slate-500 shrink-0" /> : <ChevronRight size={12} className="text-slate-500 shrink-0" />}
        <span className={`text-xs px-2 py-0.5 rounded font-mono font-semibold ${ac}`}>
          {d.action}
        </span>
        <span className="text-sm font-medium text-slate-200">{d.ticker}</span>
        <span className="text-xs text-slate-400 font-mono">
          {(d.confidence * 100).toFixed(0)}%
        </span>
        <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${d.executed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-600/30 text-slate-500'}`}>
          {d.executed ? 'executed' : d.blocked_reason ? 'blocked' : 'skipped'}
        </span>
        <span className="text-xs text-slate-500 ml-2 hidden sm:inline">
          {d.timestamp?.slice(0, 16).replace('T', ' ')}
        </span>
      </button>
      {open && (
        <div className="px-9 pb-3 text-xs text-slate-400 space-y-1">
          <p>{d.reasoning}</p>
          {d.blocked_reason && (
            <p className="text-red-400">Blocked: {d.blocked_reason}</p>
          )}
          {d.rsi != null && (
            <p className="text-slate-500 font-mono">
              RSI {d.rsi?.toFixed(1)} · MACD {d.macd?.toFixed(4)} · EMA20 ${d.ema20?.toFixed(2)} · EMA50 ${d.ema50?.toFixed(2)} · Price ${d.current_price?.toFixed(2)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main component
// ══════════════════════════════════════════════════════════════════════════════
export default function Traders({ toast }) {
  const [traders, setTraders] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [trades, setTrades] = useState([])
  const [decisions, setDecisions] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)

  // ── Fetch leaderboard ────────────────────────────────────────────────────
  const fetchTraders = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/traders')
      const sorted = (data.traders || []).sort(
        (a, b) => (b.portfolio_value ?? 0) - (a.portfolio_value ?? 0)
      )
      setTraders(sorted)
      if (selected) {
        const updated = sorted.find((t) => t.name === selected.name)
        if (updated) setSelected(updated)
      }
    } catch (e) {
      console.error('Traders fetch failed:', e)
    }
  }, [selected])

  // ── Fetch selected trader detail ─────────────────────────────────────────
  const fetchDetail = useCallback(async (name) => {
    if (!name) return
    setLoading(true)
    try {
      const [detailRes, tradesRes, decisionsRes] = await Promise.all([
        axios.get(`/api/traders/${name}`),
        axios.get(`/api/traders/${name}/trades?limit=50`),
        axios.get(`/api/traders/${name}/decisions?limit=50`),
      ])
      setDetail(detailRes.data)
      setTrades(tradesRes.data.trades || [])
      setDecisions(decisionsRes.data.decisions || [])
    } catch (e) {
      console.error('Trader detail fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Initial load + poll ──────────────────────────────────────────────────
  useEffect(() => {
    fetchTraders()
    const interval = setInterval(fetchTraders, 15_000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line

  // Refresh detail when selection changes
  useEffect(() => {
    if (selected) fetchDetail(selected.name)
  }, [selected?.name]) // eslint-disable-line

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleStart = async (name) => {
    setActionLoading(name + ':start')
    try {
      await axios.post(`/api/traders/${name}/start`)
      toast(`${name} trader started`, 'success')
      await fetchTraders()
      if (selected?.name === name) fetchDetail(name)
    } catch (e) {
      toast(e.response?.data?.detail || `Failed to start ${name}`, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleStop = async (name) => {
    setActionLoading(name + ':stop')
    try {
      await axios.post(`/api/traders/${name}/stop`)
      toast(`${name} trader stopped`, 'info')
      await fetchTraders()
      if (selected?.name === name) fetchDetail(name)
    } catch (e) {
      toast(e.response?.data?.detail || `Failed to stop ${name}`, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReset = async (name) => {
    if (!window.confirm(`Reset ${name}? This will clear all trades and positions.`)) return
    setActionLoading(name + ':reset')
    try {
      await axios.post(`/api/traders/${name}/reset`)
      toast(`${name} reset to $10,000`, 'success')
      await fetchTraders()
      if (selected?.name === name) fetchDetail(name)
    } catch (e) {
      toast(e.response?.data?.detail || `Failed to reset ${name}`, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResetAll = async () => {
    if (!window.confirm('Reset ALL traders? This clears all trades, positions and resets each to $10,000.')) return
    setActionLoading('reset-all')
    try {
      await axios.post('/api/traders/reset-all')
      toast('All traders reset to $10,000', 'success')
      await fetchTraders()
      setSelected(null)
      setDetail(null)
    } catch (e) {
      toast(e.response?.data?.detail || 'Reset failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRunAll = async () => {
    setActionLoading('all')
    const idle = traders.filter((t) => !t.is_running)
    if (idle.length === 0) {
      toast('All traders are already running', 'info')
      setActionLoading(null)
      return
    }
    let started = 0
    await Promise.all(
      idle.map(async (t) => {
        try {
          await axios.post(`/api/traders/${t.name}/start`)
          started++
        } catch (e) {
          toast(e.response?.data?.detail || `Failed to start ${t.name}`, 'error')
        }
      })
    )
    if (started > 0) toast(`Started ${started} trader${started > 1 ? 's' : ''}`, 'success')
    await fetchTraders()
    setActionLoading(null)
  }

  const handleFollow = async (name, mode) => {
    if (mode === 'live') {
      const ok = window.confirm(
        '⚠️ LIVE MODE — This will place REAL trades with REAL money on your live Alpaca account.\n\nPosition sizes will be scaled to your real portfolio.\n\nAre you sure?'
      )
      if (!ok) return
    }
    setActionLoading(name + ':follow')
    try {
      await axios.post(`/api/traders/${name}/follow`, { mode })
      const label = mode === 'off' ? 'unfollowed' : `now following in ${mode.toUpperCase()} mode`
      toast(`${name} ${label}`, mode === 'live' ? 'trade' : 'success')
      await fetchTraders()
    } catch (e) {
      toast(e.response?.data?.detail || 'Follow failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const selTrader = selected ? traders.find((t) => t.name === selected.name) : null
  const col = selTrader ? c(selTrader.color) : c('slate')

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={22} className="text-cyan-400" />
          <div>
            <h1 className="text-xl font-bold text-slate-100">Virtual Traders</h1>
            <p className="text-sm text-slate-400">5 AI traders competing with $10,000 each</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetAll}
            disabled={!!actionLoading}
            className="btn-ghost text-sm"
            title="Reset all traders to $10,000 starting balance"
          >
            <RotateCcw size={15} />
            {actionLoading === 'reset-all' ? 'Resetting…' : 'Reset All'}
          </button>
          <button
            onClick={handleRunAll}
            disabled={!!actionLoading}
            className="btn-primary text-sm"
          >
            <PlayCircle size={16} />
            {actionLoading === 'all' ? 'Starting…' : 'Run All Traders'}
          </button>
        </div>
      </div>

      {/* ── Leaderboard ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h2 className="text-sm font-semibold text-slate-300">Leaderboard</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-center w-10">#</th>
                <th className="px-4 py-2.5 text-left">Trader</th>
                <th className="px-4 py-2.5 text-left hidden sm:table-cell">Style</th>
                <th className="px-4 py-2.5 text-left">Portfolio</th>
                <th className="px-4 py-2.5 text-left">P&amp;L</th>
                <th className="px-4 py-2.5 text-left hidden md:table-cell">Win Rate</th>
                <th className="px-4 py-2.5 text-left hidden lg:table-cell">Trades</th>
                <th className="px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {traders.map((t, i) => (
                <LeaderboardRow
                  key={t.name}
                  trader={t}
                  rank={i + 1}
                  selected={selected?.name === t.name}
                  onClick={() => setSelected(t)}
                />
              ))}
              {traders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">
                    Loading traders…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Trader Profile ── */}
      {selTrader && (
        <div className="space-y-4">
          {/* Profile header */}
          <div className={`card overflow-hidden bg-gradient-to-r ${col.header} to-transparent`}>
            <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 flex items-center gap-4">
                <span className="text-5xl">{selTrader.emoji}</span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className={`text-2xl font-bold ${col.text}`}>{selTrader.display_name}</h2>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${col.badge}`}>
                      {selTrader.style}
                    </span>
                    <span className={`w-2 h-2 rounded-full ${selTrader.is_running ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                  </div>
                  <p className="text-slate-400 text-sm mt-0.5 capitalize">{selTrader.personality} trader</p>
                  <p className="text-slate-500 text-xs mt-1">
                    Conf ≥ {(selTrader.confidence_threshold * 100).toFixed(0)}% · Stop {selTrader.stop_loss_pct}% · Pos {selTrader.max_position_size_pct}% · {selTrader.trading_interval}min interval
                  </p>
                </div>
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {selTrader.is_running ? (
                  <button
                    onClick={() => handleStop(selTrader.name)}
                    disabled={actionLoading === selTrader.name + ':stop'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/25 text-sm font-medium transition-all"
                  >
                    <Square size={13} />
                    {actionLoading === selTrader.name + ':stop' ? 'Stopping…' : 'Stop'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStart(selTrader.name)}
                    disabled={actionLoading === selTrader.name + ':start'}
                    className="btn-primary text-sm py-2 px-4"
                  >
                    <Play size={13} />
                    {actionLoading === selTrader.name + ':start' ? 'Starting…' : 'Start'}
                  </button>
                )}
                {/* Follow buttons */}
                {(() => {
                  const fm = selTrader.follow_mode || 'off'
                  return fm !== 'off' ? (
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${
                        fm === 'live'
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
                      }`}>
                        <Radio size={13} className="animate-pulse" />
                        Following ({fm.toUpperCase()})
                      </div>
                      <button
                        onClick={() => handleFollow(selTrader.name, 'off')}
                        disabled={!!actionLoading}
                        className="px-3 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-400 border border-slate-600/40 text-sm transition-all"
                      >
                        Unfollow
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleFollow(selTrader.name, 'paper')}
                        disabled={!!actionLoading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/25 text-sm transition-all"
                        title="Mirror this trader's signals to your paper Alpaca account"
                      >
                        <Radio size={13} /> Follow (Paper)
                      </button>
                      <button
                        onClick={() => handleFollow(selTrader.name, 'live')}
                        disabled={!!actionLoading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 text-sm transition-all"
                        title="Mirror this trader's signals to your LIVE Alpaca account with real money"
                      >
                        <Radio size={13} /> Follow (Live 💰)
                      </button>
                    </div>
                  )
                })()}
                <button
                  onClick={() => handleReset(selTrader.name)}
                  disabled={selTrader.is_running || actionLoading === selTrader.name + ':reset'}
                  title={selTrader.is_running ? 'Stop trader before resetting' : 'Reset to $10,000'}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-400 hover:text-slate-200 border border-slate-600/40 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={13} />
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Stats */}
          {loading ? (
            <div className="text-center py-8 text-slate-500 text-sm">Loading…</div>
          ) : detail ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Portfolio Value"
                  value={fmt$(detail.portfolio_value)}
                  sub={`Cash: ${fmt$(detail.cash)}`}
                />
                <StatCard
                  label="P&L"
                  value={
                    <span className={(detail.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {(detail.pnl ?? 0) >= 0 ? '+' : ''}{fmt$(detail.pnl)}
                    </span>
                  }
                  sub={fmtPct(detail.pnl_pct)}
                />
                <StatCard
                  label="Win Rate"
                  value={`${(detail.win_rate ?? 0).toFixed(1)}%`}
                  sub={`${detail.winning_trades ?? 0}W / ${detail.losing_trades ?? 0}L`}
                />
                <StatCard
                  label="Total Trades"
                  value={detail.total_trades ?? 0}
                  sub={`${Object.keys(detail.positions || {}).length} open positions`}
                />
              </div>

              {/* Positions */}
              {Object.keys(detail.positions || {}).length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50">
                    <h3 className="text-sm font-semibold text-slate-300">Open Positions</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2.5 text-left">Ticker</th>
                          <th className="px-4 py-2.5 text-left">Side</th>
                          <th className="px-4 py-2.5 text-right">Qty</th>
                          <th className="px-4 py-2.5 text-right">Buy Price</th>
                          <th className="px-4 py-2.5 text-right">Current Price</th>
                          <th className="px-4 py-2.5 text-right">Value</th>
                          <th className="px-4 py-2.5 text-right">Unrealized P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {Object.entries(detail.positions).map(([ticker, pos]) => (
                          <tr key={ticker} className="hover:bg-slate-700/20">
                            <td className="px-4 py-2.5 font-semibold text-slate-200">{ticker}</td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                                pos.side === 'long'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-red-500/10 text-red-400'
                              }`}>
                                {pos.side.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                              {pos.qty?.toFixed(4)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                              {fmt$(pos.avg_price)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-cyan-300">
                              {fmt$(pos.current_price)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                              {fmt$(pos.live_value)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">
                              {fmtPnl(pos.unrealized_pnl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent trades */}
              {trades.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50">
                    <h3 className="text-sm font-semibold text-slate-300">Recent Trades</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2.5 text-left">Time (AEST)</th>
                          <th className="px-4 py-2.5 text-left">Ticker</th>
                          <th className="px-4 py-2.5 text-left">Action</th>
                          <th className="px-4 py-2.5 text-right">Qty</th>
                          <th className="px-4 py-2.5 text-right">Buy Price</th>
                          <th className="px-4 py-2.5 text-right">Sell Price</th>
                          <th className="px-4 py-2.5 text-right">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {trades.map((tr) => {
                          const actionColors = {
                            BUY: 'bg-emerald-500/10 text-emerald-400',
                            SELL: 'bg-red-500/10 text-red-400',
                            SHORT: 'bg-orange-500/10 text-orange-400',
                            COVER: 'bg-blue-500/10 text-blue-400',
                          }
                          const ac = actionColors[tr.action] || 'bg-slate-500/10 text-slate-400'
                          const isBuy = tr.action === 'BUY' || tr.action === 'COVER'
                          return (
                            <tr key={tr.id} className="hover:bg-slate-700/20">
                              <td className="px-4 py-2.5 text-xs text-slate-500 font-mono whitespace-nowrap">
                                {toAEST(tr.timestamp)}
                              </td>
                              <td className="px-4 py-2.5 font-semibold text-slate-200">{tr.ticker}</td>
                              <td className="px-4 py-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded font-semibold font-mono ${ac}`}>
                                  {tr.action}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                                {tr.quantity?.toFixed(4)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                                {isBuy ? fmt$(tr.price) : <span className="text-slate-600">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-red-400">
                                {!isBuy ? fmt$(tr.price) : <span className="text-slate-600">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono">
                                {tr.pnl != null && tr.pnl !== 0 ? fmtPnl(tr.pnl) : <span className="text-slate-600">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* AI Decisions */}
              {decisions.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50">
                    <h3 className="text-sm font-semibold text-slate-300">
                      Recent AI Decisions
                    </h3>
                  </div>
                  <div>
                    {decisions.map((d) => (
                      <DecisionRow key={d.id} d={d} />
                    ))}
                  </div>
                </div>
              )}

              {detail.total_trades === 0 && Object.keys(detail.positions || {}).length === 0 && (
                <div className="card px-6 py-10 text-center">
                  <p className="text-slate-500 text-sm">
                    No activity yet. Start this trader to begin virtual trading.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {!selected && traders.length > 0 && (
        <div className="card px-6 py-10 text-center">
          <p className="text-slate-500 text-sm">Click a trader in the leaderboard to view their profile.</p>
        </div>
      )}
    </div>
  )
}
