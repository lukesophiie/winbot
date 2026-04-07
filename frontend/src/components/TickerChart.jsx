import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, Cell,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'
import { BookOpen, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'

// ── Educational guide content ─────────────────────────────────────────────────
const GUIDE = [
  {
    title: 'RSI — Relative Strength Index',
    color: 'text-purple-400',
    short: 'Measures how fast and how much price has moved. Flags when an asset is oversold or overbought.',
    bullets: [
      'RSI < 30 = Oversold — price has dropped too hard, too fast. A bounce is likely. → BUY signal',
      'RSI > 70 = Overbought — price has risen too hard, too fast. Momentum may fade. → SELL signal',
      'RSI 30–70 = Neutral zone — no strong directional signal on its own',
      'The agent never relies on RSI alone. It waits for MACD and EMA to agree before trading.',
      'Example: AAPL RSI hits 28 → oversold, but MACD is still falling → agent holds and waits',
    ],
  },
  {
    title: 'EMA 20 & EMA 50 — Exponential Moving Averages',
    color: 'text-amber-400',
    short: 'Smoothed price lines. EMA20 reacts quickly to recent moves; EMA50 shows the broader trend.',
    bullets: [
      'Price above both EMAs = uptrend (bullish) — the agent is more willing to buy',
      'Price below both EMAs = downtrend (bearish) — the agent avoids buying',
      'EMA20 crossing above EMA50 = "Golden Cross" → strong bullish signal',
      'EMA20 crossing below EMA50 = "Death Cross" → strong bearish signal',
      'The gap between EMA20 and EMA50 shows momentum: wider gap = stronger trend',
      'On the chart: amber line = EMA20, purple line = EMA50',
    ],
  },
  {
    title: 'MACD — Moving Average Convergence Divergence',
    color: 'text-cyan-400',
    short: 'Shows whether bullish or bearish momentum is building or fading using two moving averages.',
    bullets: [
      'The histogram bars show the gap between the MACD line and signal line',
      'Green bars (above 0) = positive momentum — price is gaining strength',
      'Red bars (below 0) = negative momentum — price is losing strength',
      'Bars growing taller = momentum accelerating; bars shrinking = momentum fading',
      'MACD line crossing above signal line = bullish crossover → buy signal',
      'MACD line crossing below signal line = bearish crossover → sell signal',
    ],
  },
  {
    title: 'Confidence Score',
    color: 'text-emerald-400',
    short: "Claude's certainty rating for a trade. Only scores ≥ 0.70 result in an actual order being placed.",
    bullets: [
      'Scale is 0.0–1.0 (50% → 100% in display). Below 0.70 = HOLD, no trade placed.',
      'High confidence = RSI, EMA, and MACD all agree on the same direction',
      'Low confidence = mixed signals — e.g. RSI is oversold but price is below EMAs',
      'You can raise the threshold in Settings to make the agent more selective',
      'Example: RSI=28 (buy) + EMA bullish + MACD crossing up → confidence ~0.85',
    ],
  },
  {
    title: 'Stop-Loss',
    color: 'text-red-400',
    short: 'An automatic safety exit. If a position falls by a set %, the agent sells immediately to cap the loss.',
    bullets: [
      'Default: −2%. If a stock drops 2% from your entry price, it is sold automatically.',
      'Prevents a small loss from turning into a catastrophic one.',
      'Example: Buy AAPL at $200 → stop-loss fires at $196 (−$4 loss, not −$40)',
      'You can widen or tighten this in Settings (0.5%–10%)',
      'A stop-loss trade shows as SELL_SL in the trade log',
    ],
  },
  {
    title: 'Trade Sizing — Small / Medium / Large',
    color: 'text-sky-400',
    short: 'Claude picks how much of your portfolio to risk on each trade based on signal strength.',
    bullets: [
      'Large = 100% of your max position size setting (default 10% of portfolio)',
      'Medium = 50% of max (5% of portfolio)',
      'Small = 25% of max (2.5% of portfolio)',
      'Stronger signals → larger size. Uncertain signals → smaller size.',
      'Example: $100k portfolio, max 10% → large trade = $10k, medium = $5k, small = $2.5k',
    ],
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function rsiState(v) {
  if (v < 30) return { label: 'Oversold', color: 'text-emerald-400' }
  if (v > 70) return { label: 'Overbought', color: 'text-red-400' }
  return { label: 'Neutral', color: 'text-slate-400' }
}

function fmtTime(ts, long = false) {
  if (!ts) return ''
  const d = new Date(ts)
  if (long) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Custom price chart tooltip ────────────────────────────────────────────────
function PriceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const rsi = rsiState(d.rsi)
  return (
    <div className="bg-navy-900 border border-slate-700 rounded-xl p-3 text-xs shadow-2xl min-w-[200px] pointer-events-none">
      <p className="text-slate-400 mb-2 font-mono">{fmtTime(d.time, true)}</p>
      <div className="space-y-1.5">
        <Row label="Price" value={`$${d.close?.toFixed(2)}`} valueClass="text-slate-200" />
        <Row label="EMA 20" value={`$${d.ema20?.toFixed(2)}`} valueClass={d.close >= d.ema20 ? 'text-emerald-400' : 'text-red-400'} labelClass="text-amber-400" />
        <Row label="EMA 50" value={`$${d.ema50?.toFixed(2)}`} valueClass={d.close >= d.ema50 ? 'text-emerald-400' : 'text-red-400'} labelClass="text-purple-400" />
        <div className="border-t border-slate-700/50 pt-1.5">
          <Row label="RSI" value={`${d.rsi?.toFixed(1)} · ${rsi.label}`} valueClass={`font-bold ${rsi.color}`} />
          <Row label="MACD" value={d.macd_hist?.toFixed(4)} valueClass={d.macd_hist >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        </div>
        {d.buyTrade && (
          <div className="mt-1.5 pt-1.5 border-t border-emerald-500/30">
            <p className="text-emerald-400 font-semibold mb-0.5">↑ BUY @ ${d.buyTrade.price?.toFixed(2)}</p>
            <p className="text-slate-400 leading-relaxed">{d.buyTrade.reasoning?.slice(0, 120)}…</p>
          </div>
        )}
        {d.sellTrade && (
          <div className="mt-1.5 pt-1.5 border-t border-red-500/30">
            <p className="text-red-400 font-semibold mb-0.5">↓ SELL @ ${d.sellTrade.price?.toFixed(2)}</p>
            <p className="text-slate-400 leading-relaxed">{d.sellTrade.reasoning?.slice(0, 120)}…</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, valueClass = 'text-slate-300', labelClass = 'text-slate-500' }) {
  return (
    <div className="flex justify-between gap-4">
      <span className={labelClass}>{label}</span>
      <span className={`font-mono ${valueClass}`}>{value}</span>
    </div>
  )
}

// ── Guide accordion entry ────────────────────────────────────────────────────
function GuideEntry({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-700/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between px-4 py-3 text-left hover:bg-navy-700/30 transition-colors"
      >
        <div className="flex-1 pr-4">
          <span className={`text-sm font-semibold ${item.color}`}>{item.title}</span>
          <p className="text-xs text-slate-500 mt-0.5">{item.short}</p>
        </div>
        {open
          ? <ChevronUp size={14} className="text-slate-500 shrink-0 mt-1" />
          : <ChevronDown size={14} className="text-slate-500 shrink-0 mt-1" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-slate-700/30 pt-3 bg-navy-900/40">
          <ul className="space-y-2">
            {item.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                <span className={`${item.color} shrink-0 mt-0.5`}>›</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Decision row ─────────────────────────────────────────────────────────────
function DecisionRow({ r }) {
  const [open, setOpen] = useState(false)
  const executed = r.executed === 1 || r.executed === true
  const action = r.action?.toUpperCase()
  const actionColor = action === 'BUY'
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : action === 'SELL' || action?.startsWith('SELL')
      ? 'text-red-400 border-red-500/30 bg-red-500/10'
      : 'text-slate-400 border-slate-600/30 bg-slate-700/20'

  return (
    <div
      className="px-4 py-3 hover:bg-navy-700/30 transition-colors cursor-pointer border-b border-slate-700/30 last:border-0"
      onClick={() => setOpen(v => !v)}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${actionColor}`}>{action}</span>
          {executed && <span className="text-xs text-emerald-400">✓ Executed</span>}
          {!executed && action !== 'HOLD' && r.blocked_reason && (
            <span className="text-xs text-amber-400">⚠ Blocked</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500">{Math.round((r.confidence ?? 0) * 100)}%</span>
          <span className="text-xs text-slate-600 font-mono">{new Date(r.timestamp).toLocaleTimeString()}</span>
          {open ? <ChevronUp size={12} className="text-slate-600" /> : <ChevronDown size={12} className="text-slate-600" />}
        </div>
      </div>
      <p className={`text-xs text-slate-400 ${open ? '' : 'line-clamp-2'}`}>{r.reasoning}</p>
      {open && (
        <div className="mt-2 space-y-2">
          {r.blocked_reason && (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              <strong>Why blocked:</strong> {r.blocked_reason}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {r.rsi != null && (
              <span className="text-xs bg-purple-500/10 border border-purple-500/20 rounded px-2 py-0.5 text-purple-300 font-mono">
                RSI {Number(r.rsi).toFixed(1)} · {rsiState(r.rsi).label}
              </span>
            )}
            {r.macd != null && (
              <span className={`text-xs border rounded px-2 py-0.5 font-mono ${Number(r.macd) >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300'}`}>
                MACD hist {Number(r.macd).toFixed(4)}
              </span>
            )}
            {r.ema20 != null && (
              <span className="text-xs bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5 text-amber-300 font-mono">
                EMA20 ${Number(r.ema20).toFixed(2)}
              </span>
            )}
            {r.ema50 != null && (
              <span className="text-xs bg-purple-500/10 border border-purple-500/20 rounded px-2 py-0.5 text-purple-300 font-mono">
                EMA50 ${Number(r.ema50).toFixed(2)}
              </span>
            )}
            {r.current_price != null && (
              <span className="text-xs bg-slate-700/40 border border-slate-600/30 rounded px-2 py-0.5 text-slate-300 font-mono">
                Price ${Number(r.current_price).toFixed(2)}
              </span>
            )}
            <span className="text-xs bg-sky-500/10 border border-sky-500/20 rounded px-2 py-0.5 text-sky-300 font-mono capitalize">
              Size: {r.sizing}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TickerChart({ ticker, trades = [], reasoning = [], toast }) {
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState('5d')

  const fetchChart = useCallback(async () => {
    if (!ticker) return
    setLoading(true)
    setChartData(null)
    try {
      const { data } = await axios.get(`/api/chart/${encodeURIComponent(ticker)}?period=${period}`)
      setChartData(data)
    } catch {
      toast?.(`Failed to load chart for ${ticker}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [ticker, period, toast])

  useEffect(() => { fetchChart() }, [fetchChart])

  // Filter trades/decisions for this ticker from live state
  const tickerClean = ticker.replace('/', '')
  const tickerDecisions = reasoning.filter(r => r.ticker === ticker || r.ticker === tickerClean)

  // Use DB-returned trades from chart endpoint (more complete), merged with live trades
  const allTrades = [
    ...(chartData?.trades || []),
    ...trades.filter(t => (t.ticker === ticker || t.ticker === tickerClean) &&
      !(chartData?.trades || []).some(ct => ct.id === t.id)),
  ]

  // Enrich candles: find trades that happened within ±1 hour of each candle
  const enrichedCandles = (chartData?.candles || []).map(c => {
    const ct = new Date(c.time).getTime()
    const WINDOW = 3_600_000 // 1 hour in ms
    const buyTrade  = allTrades.find(t => t.action === 'BUY'  && Math.abs(new Date(t.timestamp).getTime() - ct) < WINDOW)
    const sellTrade = allTrades.find(t => ['SELL', 'SELL_SL'].includes(t.action) && Math.abs(new Date(t.timestamp).getTime() - ct) < WINDOW)
    return { ...c, buyTrade: buyTrade || null, sellTrade: sellTrade || null }
  })

  // X-axis tick subsampling to avoid crowding
  const TICK_COUNT = 6
  const step = Math.max(1, Math.floor(enrichedCandles.length / TICK_COUNT))
  const xTicks = enrichedCandles.filter((_, i) => i % step === 0).map(c => c.time)
  const xFmt = (v) => fmtTime(v)

  // Price axis domain
  const prices = enrichedCandles.map(c => c.close)
  const priceMin = prices.length ? Math.min(...prices) * 0.997 : 0
  const priceMax = prices.length ? Math.max(...prices) * 1.003 : 100

  const latest = enrichedCandles[enrichedCandles.length - 1]
  const prev   = enrichedCandles[enrichedCandles.length - 2]
  const pctChange = latest && prev ? ((latest.close - prev.close) / prev.close * 100) : 0

  const PERIODS = [
    { key: '1d', label: '1D' },
    { key: '5d', label: '5D' },
    { key: '1mo', label: '1M' },
    { key: '3mo', label: '3M' },
  ]

  const chartTooltipStyle = {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 8,
    fontSize: 11,
    color: '#94a3b8',
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-navy-900 border border-slate-700 flex items-center justify-center">
            <span className="text-sm font-bold text-cyan-400">{ticker.slice(0, 2)}</span>
          </div>
          <div>
            <h2 className="text-lg font-bold font-mono text-slate-100">{ticker}</h2>
            {latest && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-slate-300">
                  ${latest.close.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className={`text-xs font-mono ${pctChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%
                </span>
                {latest.rsi != null && (
                  <span className={`text-xs font-mono ${rsiState(latest.rsi).color}`}>
                    · RSI {latest.rsi.toFixed(1)} ({rsiState(latest.rsi).label})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1 text-xs font-mono rounded-lg border transition-all
                  ${period === p.key
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'text-slate-500 border-slate-700 hover:text-slate-300'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={fetchChart} disabled={loading} className="btn-icon" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="card h-48 flex items-center justify-center text-slate-500 text-sm gap-2">
          <RefreshCw size={16} className="animate-spin" />
          Loading chart data…
        </div>
      )}

      {!loading && enrichedCandles.length > 0 && (
        <>
          {/* ── Price + EMA chart ── */}
          <div className="card p-4">
            {/* Legend */}
            <div className="flex items-center gap-4 mb-3 text-xs flex-wrap">
              <LegendItem color="bg-cyan-400" label="Price" />
              <LegendItem color="bg-amber-400" label="EMA 20 (fast)" />
              <LegendItem color="bg-purple-400" label="EMA 50 (slow)" />
              <LegendItem color="bg-emerald-500" label="BUY trade" square />
              <LegendItem color="bg-red-500" label="SELL trade" square />
              <span className="ml-auto text-[10px] text-slate-600">Hover any point for details</span>
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={enrichedCandles} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" ticks={xTicks} tickFormatter={xFmt} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[priceMin, priceMax]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={54} />
                <Tooltip content={<PriceTooltip />} />

                {/* Price area */}
                <Area type="monotone" dataKey="close" stroke="#22d3ee" strokeWidth={1.5} fill="url(#priceGrad)" dot={false} activeDot={{ r: 3, fill: '#22d3ee' }} />

                {/* EMAs */}
                <Line type="monotone" dataKey="ema20" stroke="#f59e0b" strokeWidth={1.5} dot={false} activeDot={false} />
                <Line type="monotone" dataKey="ema50" stroke="#a855f7" strokeWidth={1.5} dot={false} activeDot={false} />

                {/* BUY/SELL trade markers */}
                {enrichedCandles.filter(c => c.buyTrade).map((c, i) => (
                  <ReferenceLine key={`b${i}`} x={c.time} stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 2"
                    label={{ value: '▲', position: 'insideTop', fill: '#10b981', fontSize: 12 }} />
                ))}
                {enrichedCandles.filter(c => c.sellTrade).map((c, i) => (
                  <ReferenceLine key={`s${i}`} x={c.time} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2"
                    label={{ value: '▼', position: 'insideTop', fill: '#ef4444', fontSize: 12 }} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── RSI chart ── */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-purple-400">RSI (14)</span>
                {latest?.rsi != null && (
                  <span className={`text-xs font-mono font-bold ${rsiState(latest.rsi).color}`}>
                    {latest.rsi.toFixed(1)} · {rsiState(latest.rsi).label}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-600">
                Below 30 = oversold (buy zone) · Above 70 = overbought (sell zone)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={enrichedCandles} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" ticks={xTicks} tickFormatter={xFmt} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  formatter={(v) => [v?.toFixed(1), 'RSI']}
                  contentStyle={chartTooltipStyle}
                  labelFormatter={xFmt}
                />
                <ReferenceLine y={70} stroke="#ef444450" strokeDasharray="3 3"
                  label={{ value: 'OB 70', position: 'insideRight', fill: '#ef4444', fontSize: 9 }} />
                <ReferenceLine y={30} stroke="#10b98150" strokeDasharray="3 3"
                  label={{ value: 'OS 30', position: 'insideRight', fill: '#10b981', fontSize: 9 }} />
                <ReferenceLine y={50} stroke="#33415560" strokeDasharray="2 4" />
                <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={1.5} dot={false} activeDot={{ r: 2, fill: '#a855f7' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── MACD chart ── */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-cyan-400">MACD</span>
                {latest?.macd_hist != null && (
                  <span className={`text-xs font-mono font-bold ${latest.macd_hist >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {latest.macd_hist >= 0 ? '▲ Bullish' : '▼ Bearish'} momentum
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-600">
                Green bars = bullish momentum · Red bars = bearish · Cyan = MACD line · Amber = signal line
              </span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={enrichedCandles} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" ticks={xTicks} tickFormatter={xFmt} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={v => v.toFixed(2)} />
                <Tooltip
                  formatter={(v, name) => [Number(v).toFixed(4), name]}
                  contentStyle={chartTooltipStyle}
                  labelFormatter={xFmt}
                />
                <ReferenceLine y={0} stroke="#334155" />
                <Bar dataKey="macd_hist" name="Histogram" maxBarSize={6}>
                  {enrichedCandles.map((c, i) => (
                    <Cell key={i} fill={c.macd_hist >= 0 ? '#10b98180' : '#ef444480'} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="macd"        name="MACD"   stroke="#22d3ee" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="macd_signal" name="Signal" stroke="#f59e0b" strokeWidth={1}   dot={false} strokeDasharray="3 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {!loading && !chartData && (
        <div className="card p-8 text-center text-slate-500">
          <p>No chart data available for {ticker}</p>
          <p className="text-xs mt-1 text-slate-600">Market data may be unavailable outside trading hours for this ticker</p>
        </div>
      )}

      {/* ── Recent AI decisions for this ticker ── */}
      {tickerDecisions.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <h3 className="text-sm font-semibold text-slate-200">Recent AI Decisions for {ticker}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every analysis Claude ran — click any row to see the full reasoning and indicator values
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {tickerDecisions.slice(0, 15).map((r, i) => (
              <DecisionRow key={r.id ?? i} r={r} />
            ))}
          </div>
        </div>
      )}

      {/* ── Educational guide ── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={16} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-slate-200">How to Read This Chart</h3>
          <span className="text-xs text-slate-500 ml-1">— click any indicator to learn what it means</span>
        </div>
        <div className="space-y-2">
          {GUIDE.map(item => (
            <GuideEntry key={item.title} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label, square }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      {square
        ? <span className={`w-3 h-3 rounded-sm inline-block ${color}`} />
        : <span className={`w-4 h-0.5 rounded inline-block ${color}`} />}
      {label}
    </span>
  )
}
