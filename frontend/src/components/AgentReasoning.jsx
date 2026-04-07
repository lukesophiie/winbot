import { useState } from 'react'
import { Brain, ChevronDown, ChevronUp, CheckCircle, XCircle, MinusCircle } from 'lucide-react'

function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'bg-emerald-400' : pct >= 70 ? 'bg-cyan-400' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  )
}

function IndicatorPill({ label, value, unit = '' }) {
  if (value === undefined || value === null) return null
  return (
    <div className="flex flex-col items-center bg-navy-900/60 rounded-lg px-3 py-2 border border-slate-700/40">
      <span className="text-xs text-slate-500 mb-0.5">{label}</span>
      <span className="text-sm font-mono font-semibold text-slate-200">
        {typeof value === 'number' ? value.toFixed(2) : value}{unit}
      </span>
    </div>
  )
}

function ReasoningCard({ entry }) {
  const [expanded, setExpanded] = useState(false)

  const action = entry.action?.toUpperCase() || 'HOLD'
  const executed = entry.executed === true || entry.executed === 1

  const actionColor = {
    BUY: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    SELL: 'text-red-400 border-red-500/30 bg-red-500/10',
    HOLD: 'text-slate-400 border-slate-600/30 bg-slate-700/20',
    LONG: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    SHORT: 'text-red-400 border-red-500/30 bg-red-500/10',
  }[action] || 'text-slate-400 border-slate-600/30 bg-slate-700/20'

  const ind = entry.indicators || {}
  const rsi = entry.rsi ?? ind.rsi
  const macd = entry.macd ?? ind.macd_hist
  const ema20 = entry.ema20 ?? ind.ema20
  const ema50 = entry.ema50 ?? ind.ema50
  const price = entry.current_price ?? ind.price

  return (
    <div className={`card overflow-hidden transition-all duration-200
      ${executed ? 'border-cyan-500/20' : 'border-slate-700/50'}`}>
      <div
        className="flex items-start justify-between p-4 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Left */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`mt-0.5 flex items-center gap-1 text-xs font-mono font-bold
            px-2.5 py-1 rounded-lg border shrink-0 ${actionColor}`}>
            {action}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-mono font-bold text-slate-200">{entry.ticker}</span>
              {price !== undefined && price !== null && (
                <span className="text-xs text-slate-500 font-mono">${Number(price).toFixed(2)}</span>
              )}
              {executed ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle size={11} /> Executed
                </span>
              ) : action !== 'HOLD' ? (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <XCircle size={11} /> Blocked
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <MinusCircle size={11} /> Hold
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 line-clamp-2 pr-4">{entry.reasoning}</p>
            {entry.blocked_reason && !executed && (
              <p className="text-xs text-amber-400/70 mt-1">⚠ {entry.blocked_reason}</p>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col items-end gap-1.5 shrink-0 ml-3">
          <div className="text-xs text-slate-500 font-mono whitespace-nowrap">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
          <div className="w-24">
            <ConfidenceBar value={entry.confidence} />
          </div>
          {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/40 pt-3 animate-fade-in">
          <p className="text-sm text-slate-300 leading-relaxed mb-3">{entry.reasoning}</p>

          {/* Indicators grid */}
          <div className="flex flex-wrap gap-2">
            <IndicatorPill label="RSI" value={rsi} />
            <IndicatorPill label="MACD Hist" value={macd} />
            <IndicatorPill label="EMA 20" value={ema20} unit="" />
            <IndicatorPill label="EMA 50" value={ema50} unit="" />
            <IndicatorPill label="Sizing" value={entry.sizing} />
            <IndicatorPill label="Confidence" value={entry.confidence * 100} unit="%" />
          </div>

          {entry.blocked_reason && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              <strong>Blocked:</strong> {entry.blocked_reason}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentReasoning({ reasoning, agentRunning }) {
  const [filter, setFilter] = useState('ALL')

  const filters = ['ALL', 'BUY', 'SELL', 'HOLD', 'Executed', 'Blocked']

  const filtered = reasoning.filter((r) => {
    if (filter === 'ALL') return true
    if (filter === 'Executed') return r.executed === true || r.executed === 1
    if (filter === 'Blocked') return !r.executed && r.action?.toUpperCase() !== 'HOLD'
    return r.action?.toUpperCase() === filter
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">AI Reasoning Log</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Every decision Claude makes, explained in full
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border
          ${agentRunning
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-slate-700/30 border-slate-600/30 text-slate-500'}`}>
          {agentRunning ? <><span className="live-dot" /> Live</> : <><span className="offline-dot" /> Idle</>}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border
              ${filter === f
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                : 'text-slate-500 border-slate-700 hover:text-slate-300'}`}
          >
            {f}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-auto self-center">{filtered.length} entries</span>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Brain size={40} className="mx-auto mb-3 text-slate-600" />
          <p className="text-slate-500">No reasoning entries yet</p>
          <p className="text-xs text-slate-600 mt-1">
            {agentRunning ? 'Waiting for next analysis cycle…' : 'Start the agent to see live decisions'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry, i) => (
            <ReasoningCard key={entry.id ?? i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
