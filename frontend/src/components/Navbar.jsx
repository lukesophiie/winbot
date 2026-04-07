import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, History, Brain, List,
  BarChart2, Settings, Zap, ZapOff, Wifi, WifiOff,
} from 'lucide-react'

const NAV_LINKS = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/trades',      icon: History,          label: 'Trades'      },
  { to: '/reasoning',   icon: Brain,            label: 'AI Log'      },
  { to: '/watchlist',   icon: List,             label: 'Watchlist'   },
  { to: '/performance', icon: BarChart2,        label: 'Performance' },
  { to: '/settings',    icon: Settings,         label: 'Settings'    },
]

export default function Navbar({
  agentRunning, agentLoading, startAgent, stopAgent,
  tradingMode, toggleMode, wsConnected, portfolio,
}) {
  const pv = portfolio?.portfolio_value ?? 0
  const pnl = portfolio?.pnl ?? 0
  const pnlPct = portfolio?.pnl_pct ?? 0

  return (
    <header className="sticky top-0 z-40 bg-navy-900/95 backdrop-blur-md border-b border-slate-700/60">
      <div className="max-w-screen-2xl mx-auto px-4 md:px-6">
        <div className="flex items-center h-14 gap-4">

          {/* Logo */}
          <div className="flex items-center gap-2 mr-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center">
              <span className="text-navy-950 font-bold text-xs">W</span>
            </div>
            <span className="font-bold text-slate-100 tracking-tight hidden sm:block">WinBot</span>
          </div>

          {/* Nav links */}
          <nav className="flex items-center gap-0.5 overflow-x-auto flex-1">
            {NAV_LINKS.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                   transition-all duration-150 whitespace-nowrap
                   ${isActive
                     ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                     : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
                   }`
                }
              >
                <Icon size={14} />
                <span className="hidden md:inline">{label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Portfolio value mini display */}
            {pv > 0 && (
              <div className="hidden lg:flex flex-col items-end">
                <span className="text-slate-200 font-mono text-sm font-semibold">
                  ${pv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className={`text-xs font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                </span>
              </div>
            )}

            {/* Mode toggle */}
            <div className="flex items-center bg-navy-800 border border-slate-700 rounded-lg p-0.5 text-xs font-semibold">
              <button
                onClick={() => !agentRunning && toggleMode('paper')}
                disabled={agentRunning}
                className={`px-2.5 py-1 rounded-md transition-all duration-150
                  ${tradingMode === 'paper'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-500 hover:text-slate-300'}
                  ${agentRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                PAPER
              </button>
              <button
                onClick={() => !agentRunning && toggleMode('live')}
                disabled={agentRunning}
                className={`px-2.5 py-1 rounded-md transition-all duration-150
                  ${tradingMode === 'live'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : 'text-slate-500 hover:text-slate-300'}
                  ${agentRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                LIVE
              </button>
            </div>

            {/* WS status */}
            <span title={wsConnected ? 'Backend connected' : 'Backend disconnected'}>
              {wsConnected
                ? <Wifi size={15} className="text-emerald-400" />
                : <WifiOff size={15} className="text-slate-500" />
              }
            </span>

            {/* Start / Stop */}
            {agentRunning ? (
              <button
                onClick={stopAgent}
                disabled={agentLoading}
                className="btn-danger text-xs py-2 px-4"
              >
                <ZapOff size={13} />
                Stop
              </button>
            ) : (
              <button
                onClick={startAgent}
                disabled={agentLoading}
                className="btn-primary text-xs py-2 px-4"
              >
                <Zap size={13} />
                {agentLoading ? 'Starting…' : 'Start'}
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
