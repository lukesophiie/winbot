import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, DollarSign, Activity,
  Briefcase, Zap, ZapOff, AlertCircle,
} from 'lucide-react'
import axios from 'axios'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt$ = (n) =>
  typeof n === 'number'
    ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

const fmtPct = (n) =>
  typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'

function StatCard({ label, value, subValue, subLabel, icon: Icon, positive, negative }) {
  const color =
    positive === true ? 'text-emerald-400' :
    positive === false ? 'text-red-400' :
    'text-cyan-400'
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">{label}</span>
        <Icon size={16} className="text-slate-500" />
      </div>
      <div className={`text-2xl font-mono font-bold ${color}`}>{value}</div>
      {subValue !== undefined && (
        <div className={`text-xs mt-1 ${positive === true ? 'gain' : positive === false ? 'loss' : 'text-slate-500'}`}>
          {subValue} {subLabel}
        </div>
      )}
    </div>
  )
}

function ActionBadge({ action }) {
  const map = {
    BUY: 'badge-buy', SELL: 'badge-sell', HOLD: 'badge-hold',
    LONG: 'badge-buy', SHORT: 'badge-sell', SELL_SL: 'badge-sl',
  }
  return <span className={map[action] || 'badge-hold'}>{action}</span>
}

// ── Custom chart tooltip ───────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div className="bg-navy-800 border border-cyan-500/20 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-400 mb-1">{label}</div>
      <div className="text-cyan-300 font-mono font-semibold">{fmt$(val)}</div>
    </div>
  )
}

export default function Dashboard({
  agentRunning, agentLoading, startAgent, stopAgent,
  portfolio, positions, trades, portfolioHistory, tradingMode,
  toast,
}) {
  const [winRate, setWinRate] = useState(null)
  const [runningNow, setRunningNow] = useState(false)

  const runNow = async () => {
    setRunningNow(true)
    try {
      await axios.post('/api/agent/run-now')
      toast?.('Cycle triggered — decisions will appear shortly', 'success')
    } catch (e) {
      toast?.(e.response?.data?.detail || 'Failed to trigger cycle', 'error')
    } finally {
      setTimeout(() => setRunningNow(false), 3000)
    }
  }

  useEffect(() => {
    axios.get('/api/performance').then(({ data }) => setWinRate(data.stats?.win_rate ?? null))
  }, [trades.length])

  // Format equity curve data
  const chartData = portfolioHistory.map((s) => ({
    time: new Date(s.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    value: s.total_value,
    date: new Date(s.timestamp).toLocaleDateString(),
  }))

  const firstVal = chartData[0]?.value
  const lastVal = chartData[chartData.length - 1]?.value
  const equityUp = firstVal && lastVal ? lastVal >= firstVal : null

  const pv = portfolio?.portfolio_value ?? 0
  const cash = portfolio?.cash ?? 0
  const pnl = portfolio?.pnl ?? 0
  const pnlPct = portfolio?.pnl_pct ?? 0

  const recentTrades = trades.slice(0, 8)

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {tradingMode === 'paper' ? '📄 Paper Trading Mode' : '⚡ LIVE Trading Mode'}
          </p>
        </div>

        {/* Agent status indicator */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border
            ${agentRunning
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-slate-700/30 border-slate-600/30 text-slate-500'}`}>
            {agentRunning ? (
              <><span className="live-dot" /> Agent Active</>
            ) : (
              <><span className="offline-dot" /> Agent Idle</>
            )}
          </div>
          {agentRunning ? (
            <>
              <button
                onClick={runNow}
                disabled={runningNow}
                className="btn-secondary text-sm"
                title="Force an immediate analysis cycle"
              >
                <Activity size={15} /> {runningNow ? 'Running…' : 'Run Now'}
              </button>
              <button onClick={stopAgent} disabled={agentLoading} className="btn-danger text-sm">
                <ZapOff size={15} /> Stop Agent
              </button>
            </>
          ) : (
            <button onClick={startAgent} disabled={agentLoading} className="btn-primary text-sm">
              <Zap size={15} /> {agentLoading ? 'Starting…' : 'Start Agent'}
            </button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Portfolio Value"
          value={fmt$(pv)}
          icon={DollarSign}
        />
        <StatCard
          label="Daily P&L"
          value={fmt$(pnl)}
          subValue={fmtPct(pnlPct)}
          icon={pnl >= 0 ? TrendingUp : TrendingDown}
          positive={pnl > 0 ? true : pnl < 0 ? false : undefined}
        />
        <StatCard
          label="Win Rate"
          value={winRate !== null ? `${winRate.toFixed(1)}%` : '—'}
          subValue={`${trades.length} trades`}
          icon={Activity}
          positive={winRate !== null ? winRate >= 50 : undefined}
        />
        <StatCard
          label="Open Positions"
          value={positions.length}
          subValue={fmt$(cash)}
          subLabel="cash"
          icon={Briefcase}
        />
      </div>

      {/* Equity curve */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Equity Curve</h2>
            <p className="text-xs text-slate-500 mt-0.5">Portfolio value over time</p>
          </div>
          {equityUp !== null && (
            <div className={`flex items-center gap-1 text-xs font-mono font-semibold
              ${equityUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {equityUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {fmt$(lastVal - firstVal)}
            </div>
          )}
        </div>

        {chartData.length < 2 ? (
          <div className="h-48 flex items-center justify-center">
            <div className="text-center text-slate-500">
              <Activity size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No equity data yet — start the agent to begin tracking</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => '$' + (v / 1000).toFixed(1) + 'k'}
                width={60}
              />
              <Tooltip content={<ChartTooltip />} />
              {firstVal && <ReferenceLine y={firstVal} stroke="rgba(148,163,184,0.15)" strokeDasharray="4 4" />}
              <Line
                type="monotone"
                dataKey="value"
                stroke={equityUp ? '#34d399' : '#f87171'}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: equityUp ? '#34d399' : '#f87171' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Open Positions */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Open Positions</h2>
          {positions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Briefcase size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No open positions</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700/50">
                    <th className="text-left pb-2 font-medium">Ticker</th>
                    <th className="text-right pb-2 font-medium">Qty</th>
                    <th className="text-right pb-2 font-medium">Entry</th>
                    <th className="text-right pb-2 font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.ticker} className="table-row">
                      <td className="py-2 font-mono font-semibold text-slate-200">{p.ticker}</td>
                      <td className="py-2 text-right font-mono text-slate-300">{p.quantity.toFixed(4)}</td>
                      <td className="py-2 text-right font-mono text-slate-400">{fmt$(p.avg_entry_price)}</td>
                      <td className={`py-2 text-right font-mono font-semibold ${p.unrealized_pl >= 0 ? 'gain' : 'loss'}`}>
                        {fmt$(p.unrealized_pl)}
                        <span className="text-xs ml-1 opacity-70">({fmtPct(p.unrealized_plpc)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Recent Trades</h2>
          {recentTrades.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Activity size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No trades yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTrades.map((t, i) => (
                <div key={t.id ?? i}
                  className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
                  <div className="flex items-center gap-2">
                    <ActionBadge action={t.action} />
                    <span className="font-mono text-sm font-semibold text-slate-200">{t.ticker}</span>
                    <span className="text-xs text-slate-500">{t.quantity?.toFixed(4)}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-slate-300">{fmt$(t.price)}</div>
                    <div className="text-xs text-slate-500">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* No API keys warning */}
      {!portfolio && (
        <div className="card p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-3 text-amber-400">
            <AlertCircle size={18} />
            <div>
              <p className="text-sm font-medium">Broker not connected</p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                Add your Alpaca API keys in <a href="/settings" className="underline">Settings</a> to connect.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
