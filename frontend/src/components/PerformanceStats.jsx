import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Award, Target, BarChart2, RefreshCw } from 'lucide-react'
import axios from 'axios'

const fmt$ = (n) =>
  typeof n === 'number'
    ? (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

function Metric({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">{label}</span>
        {Icon && <Icon size={15} className="text-slate-500" />}
      </div>
      <div className={`text-2xl font-mono font-bold ${color || 'text-slate-200'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function WinLossPie({ wins, losses }) {
  const data = [
    { name: 'Wins',   value: wins,   color: '#34d399' },
    { name: 'Losses', value: losses, color: '#f87171' },
  ].filter((d) => d.value > 0)

  if (data.length === 0) return (
    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data yet</div>
  )

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Legend
          formatter={(value) => <span className="text-xs text-slate-400">{value}</span>}
        />
        <Tooltip
          formatter={(v, name) => [v, name]}
          contentStyle={{ background: '#0a1225', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

function EquityChart({ history }) {
  if (!history || history.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
        Not enough data yet
      </div>
    )
  }
  const data = history.map((s) => ({
    time: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: s.total_value,
    pnl: s.daily_pnl,
  }))
  const firstVal = data[0]?.value
  const up = (data[data.length - 1]?.value ?? 0) >= (firstVal ?? 0)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false}
          tickFormatter={(v) => '$' + (v / 1000).toFixed(1) + 'k'} width={60} />
        <Tooltip
          formatter={(v) => ['$' + v.toLocaleString('en-US', { minimumFractionDigits: 2 }), 'Portfolio']}
          contentStyle={{ background: '#0a1225', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={up ? 'rgba(52,211,153,0.7)' : 'rgba(248,113,113,0.7)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function PerformanceStats({ portfolioHistory }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/performance')
      setStats(data.stats)
    } catch (e) {
      console.error('Performance fetch error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])

  const s = stats

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Performance</h1>
          <p className="text-xs text-slate-500 mt-0.5">Cumulative trading statistics</p>
        </div>
        <button onClick={fetch} disabled={loading} className="btn-icon" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric
          label="Total Return"
          value={s ? `${s.total_return_pct >= 0 ? '+' : ''}${s.total_return_pct.toFixed(2)}%` : '—'}
          icon={s?.total_return_pct >= 0 ? TrendingUp : TrendingDown}
          color={!s ? 'text-slate-200' : s.total_return_pct >= 0 ? 'gain' : 'loss'}
        />
        <Metric
          label="Win Rate"
          value={s ? `${s.win_rate.toFixed(1)}%` : '—'}
          sub={s ? `${s.winning_trades}W / ${s.losing_trades}L` : ''}
          icon={Target}
          color={!s ? 'text-slate-200' : s.win_rate >= 50 ? 'gain' : 'loss'}
        />
        <Metric
          label="Sharpe Ratio"
          value={s ? s.sharpe_ratio.toFixed(3) : '—'}
          sub="annualised"
          icon={BarChart2}
          color={!s ? 'text-slate-200' : s.sharpe_ratio >= 1 ? 'gain' : s.sharpe_ratio >= 0 ? 'text-cyan-400' : 'loss'}
        />
        <Metric
          label="Total P&L"
          value={s ? fmt$(s.total_pnl) : '—'}
          sub={s ? `${s.total_trades} trades` : ''}
          icon={Award}
          color={!s ? 'text-slate-200' : s.total_pnl >= 0 ? 'gain' : 'loss'}
        />
      </div>

      {/* Best / Worst trade */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <span className="section-label">Best Trade</span>
            <TrendingUp size={15} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-mono font-bold gain">
            {s ? fmt$(s.best_trade) : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <span className="section-label">Worst Trade</span>
            <TrendingDown size={15} className="text-red-500" />
          </div>
          <div className="text-2xl font-mono font-bold loss">
            {s ? fmt$(s.worst_trade) : '—'}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Portfolio Value History</h2>
          <EquityChart history={portfolioHistory} />
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Win / Loss Distribution</h2>
          {s && <WinLossPie wins={s.winning_trades} losses={s.losing_trades} />}
        </div>
      </div>

      {/* Metrics table */}
      {s && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <h2 className="text-sm font-semibold text-slate-200">Full Breakdown</h2>
          </div>
          <div className="divide-y divide-slate-700/30">
            {[
              ['Total Trades',    s.total_trades],
              ['Winning Trades',  s.winning_trades],
              ['Losing Trades',   s.losing_trades],
              ['Win Rate',        `${s.win_rate.toFixed(2)}%`],
              ['Total P&L',       fmt$(s.total_pnl)],
              ['Total Return',    `${s.total_return_pct >= 0 ? '+' : ''}${s.total_return_pct.toFixed(2)}%`],
              ['Sharpe Ratio',    s.sharpe_ratio.toFixed(3)],
              ['Best Trade',      fmt$(s.best_trade)],
              ['Worst Trade',     fmt$(s.worst_trade)],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between px-5 py-3 hover:bg-navy-700/20">
                <span className="text-sm text-slate-400">{label}</span>
                <span className="text-sm font-mono font-medium text-slate-200">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
