import { useState, useEffect } from 'react'
import axios from 'axios'
import { Plus, Trash2, RefreshCw, TrendingUp } from 'lucide-react'
import TickerChart from './TickerChart.jsx'

const POPULAR = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'BTC/USD', 'ETH/USD', 'SPY', 'QQQ']

export default function Watchlist({ toast, trades = [], reasoning = [] }) {
  const [watchlist, setWatchlist]   = useState([])
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState(null)

  const fetchWatchlist = async () => {
    try {
      const { data } = await axios.get('/api/watchlist')
      const wl = data.watchlist || []
      setWatchlist(wl)
      if (!selected && wl.length > 0) setSelected(wl[0])
    } catch {
      toast?.('Failed to load watchlist', 'error')
    }
  }

  useEffect(() => { fetchWatchlist() }, []) // eslint-disable-line

  const addTicker = async (ticker) => {
    const t = (ticker || input).toUpperCase().trim()
    if (!t) return
    setLoading(true)
    try {
      const { data } = await axios.post('/api/watchlist', { ticker: t })
      setWatchlist(data.watchlist || [])
      setInput('')
      setSelected(t)
      toast?.(`Added ${t} to watchlist`, 'success')
    } catch (e) {
      toast?.(e.response?.data?.detail || 'Failed to add ticker', 'error')
    } finally {
      setLoading(false)
    }
  }

  const removeTicker = async (ticker) => {
    try {
      const { data } = await axios.delete(`/api/watchlist/${encodeURIComponent(ticker)}`)
      const wl = data.watchlist || []
      setWatchlist(wl)
      if (selected === ticker) setSelected(wl[0] || null)
      toast?.(`Removed ${ticker}`, 'info')
    } catch {
      toast?.('Failed to remove ticker', 'error')
    }
  }

  const notInList = POPULAR.filter(t => !watchlist.includes(t))

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Watchlist</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          The agent only trades tickers on this list. Click a ticker to view its live chart.
        </p>
      </div>

      {/* ── Ticker list + add ── */}
      <div className="flex gap-4 flex-col lg:flex-row">

        {/* Left panel: list */}
        <div className="lg:w-72 shrink-0 space-y-4">

          {/* Add ticker */}
          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">Add Ticker</h2>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && addTicker()}
                placeholder="e.g. AAPL"
                className="input flex-1 text-sm"
              />
              <button
                onClick={() => addTicker()}
                disabled={loading || !input.trim()}
                className="btn-primary px-3 text-sm"
              >
                <Plus size={15} />
                Add
              </button>
            </div>
            {notInList.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Quick add:</p>
                <div className="flex flex-wrap gap-1.5">
                  {notInList.slice(0, 8).map(t => (
                    <button
                      key={t}
                      onClick={() => addTicker(t)}
                      className="px-2 py-0.5 text-xs font-mono rounded border border-slate-600
                        text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-all"
                    >
                      +{t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Watchlist */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
              <span className="text-sm font-semibold text-slate-200">
                Active
                <span className="ml-1.5 text-xs text-slate-500 font-normal">({watchlist.length})</span>
              </span>
              <button onClick={fetchWatchlist} className="btn-icon">
                <RefreshCw size={13} />
              </button>
            </div>

            {watchlist.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <TrendingUp size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">Watchlist empty — add a ticker above</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {watchlist.map(ticker => (
                  <div
                    key={ticker}
                    onClick={() => setSelected(ticker)}
                    className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors
                      ${selected === ticker
                        ? 'bg-cyan-500/10 border-l-2 border-l-cyan-500'
                        : 'hover:bg-navy-700/30 border-l-2 border-l-transparent'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold
                        ${selected === ticker ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400' : 'bg-navy-900 border-slate-700 text-slate-400'}`}>
                        {ticker.slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-mono font-semibold text-sm text-slate-200">{ticker}</p>
                        <p className="text-[10px] text-slate-600">{ticker.includes('/') ? 'Crypto' : 'US Stock'}</p>
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); removeTicker(ticker) }}
                      className="p-1.5 rounded text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="card p-3 border-cyan-500/20 bg-cyan-500/5">
            <p className="text-xs text-cyan-300/80 leading-relaxed">
              <strong className="text-cyan-300">Crypto:</strong> use <span className="font-mono">BTC/USD</span> format.
              <br />
              <strong className="text-cyan-300">Stocks:</strong> standard symbols like <span className="font-mono">AAPL</span>.
              <br />
              The agent analyses each ticker every cycle and only trades when confidence ≥ threshold.
            </p>
          </div>
        </div>

        {/* Right panel: chart */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <TickerChart
              key={selected}
              ticker={selected}
              trades={trades}
              reasoning={reasoning}
              toast={toast}
            />
          ) : (
            <div className="card h-64 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a ticker to view its chart</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
