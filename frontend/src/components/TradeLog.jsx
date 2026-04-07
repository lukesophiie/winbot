import { useState } from 'react'
import { History, TrendingUp, TrendingDown, Search } from 'lucide-react'

const fmt$ = (n) =>
  typeof n === 'number'
    ? '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

function ActionBadge({ action }) {
  const map = {
    BUY: 'badge-buy', SELL: 'badge-sell', HOLD: 'badge-hold',
    LONG: 'badge-buy', SHORT: 'badge-sell', SELL_SL: 'badge-sl',
  }
  return <span className={map[action] || 'badge-hold'}>{action}</span>
}

function PnlCell({ pnl }) {
  if (!pnl && pnl !== 0) return <span className="text-slate-500">—</span>
  return (
    <span className={`font-mono text-sm font-semibold ${pnl >= 0 ? 'gain' : 'loss'}`}>
      {pnl >= 0 ? '+' : '-'}{fmt$(pnl)}
    </span>
  )
}

export default function TradeLog({ trades }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL')

  const actions = ['ALL', 'BUY', 'SELL', 'SELL_SL']

  const filtered = trades.filter((t) => {
    const matchTicker = t.ticker.toLowerCase().includes(search.toLowerCase())
    const matchAction = filter === 'ALL' || t.action === filter
    return matchTicker && matchAction
  })

  const totalPnl = trades.reduce((acc, t) => acc + (t.pnl || 0), 0)
  const wins = trades.filter((t) => t.pnl > 0).length
  const losses = trades.filter((t) => t.pnl < 0).length

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Trade Log</h1>
          <p className="text-xs text-slate-500 mt-0.5">{trades.length} total trades recorded</p>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Trades', value: trades.length, icon: History },
          { label: 'Total P&L', value: (totalPnl >= 0 ? '+' : '') + fmt$(Math.abs(totalPnl)),
            color: totalPnl >= 0 ? 'gain' : 'loss', icon: totalPnl >= 0 ? TrendingUp : TrendingDown },
          { label: 'Winning', value: wins, color: 'gain', icon: TrendingUp },
          { label: 'Losing',  value: losses, color: 'loss', icon: TrendingDown },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="section-label">{label}</span>
              <Icon size={15} className="text-slate-500" />
            </div>
            <div className={`text-2xl font-mono font-bold ${color || 'text-slate-200'}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker…"
            className="input pl-9"
          />
        </div>
        <div className="flex gap-1">
          {actions.map((a) => (
            <button
              key={a}
              onClick={() => setFilter(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${filter === a
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-500 border border-slate-700 hover:text-slate-300'}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-900/60 text-xs text-slate-500 border-b border-slate-700/50">
                {['Time', 'Ticker', 'Action', 'Qty', 'Price', 'Total', 'P&L', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    <History size={28} className="mx-auto mb-2 opacity-30" />
                    <p>No trades found</p>
                  </td>
                </tr>
              ) : (
                filtered.map((t, i) => (
                  <tr key={t.id ?? i} className="table-row">
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono whitespace-nowrap">
                      <div>{new Date(t.timestamp).toLocaleDateString()}</div>
                      <div className="text-slate-600">{new Date(t.timestamp).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-200">{t.ticker}</td>
                    <td className="px-4 py-3"><ActionBadge action={t.action} /></td>
                    <td className="px-4 py-3 font-mono text-slate-300">{Number(t.quantity).toFixed(4)}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{fmt$(t.price)}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{fmt$(t.total_value)}</td>
                    <td className="px-4 py-3"><PnlCell pnl={t.pnl} /></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium
                        ${t.status === 'filled' ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 bg-slate-700/30'}`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
