import { useState, useEffect } from 'react'
import axios from 'axios'
import { Plus, Trash2, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'

const POPULAR = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'BTC/USD', 'ETH/USD', 'SPY', 'QQQ']

export default function Watchlist({ toast }) {
  const [watchlist, setWatchlist] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [prices, setPrices] = useState({})
  const [fetchingPrices, setFetchingPrices] = useState(false)

  const fetchWatchlist = async () => {
    try {
      const { data } = await axios.get('/api/watchlist')
      setWatchlist(data.watchlist || [])
    } catch (e) {
      toast?.('Failed to load watchlist', 'error')
    }
  }

  useEffect(() => { fetchWatchlist() }, [])

  const addTicker = async (ticker) => {
    const t = (ticker || input).toUpperCase().trim()
    if (!t) return
    setLoading(true)
    try {
      const { data } = await axios.post('/api/watchlist', { ticker: t })
      setWatchlist(data.watchlist || [])
      setInput('')
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
      setWatchlist(data.watchlist || [])
      toast?.(`Removed ${ticker}`, 'info')
    } catch (e) {
      toast?.('Failed to remove ticker', 'error')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') addTicker()
  }

  const notInList = POPULAR.filter((t) => !watchlist.includes(t))

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Watchlist</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          The agent only trades tickers on this list.
        </p>
      </div>

      {/* Add ticker */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">Add Ticker</h2>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="e.g. AAPL or BTC/USD"
            className="input flex-1"
          />
          <button
            onClick={() => addTicker()}
            disabled={loading || !input.trim()}
            className="btn-primary px-4"
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {/* Quick-add popular tickers */}
        {notInList.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-slate-500 mb-2">Quick add:</p>
            <div className="flex flex-wrap gap-2">
              {notInList.slice(0, 8).map((t) => (
                <button
                  key={t}
                  onClick={() => addTicker(t)}
                  className="px-2.5 py-1 text-xs font-mono rounded-md bg-navy-900
                    border border-slate-600 text-slate-400 hover:text-cyan-300
                    hover:border-cyan-500/40 transition-all"
                >
                  + {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Watchlist */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-sm font-semibold text-slate-200">
            Active Watchlist
            <span className="ml-2 text-xs text-slate-500 font-normal">({watchlist.length} tickers)</span>
          </h2>
          <button
            onClick={fetchWatchlist}
            className="btn-icon"
            title="Refresh"
          >
            <RefreshCw size={14} className={fetchingPrices ? 'animate-spin' : ''} />
          </button>
        </div>

        {watchlist.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Your watchlist is empty</p>
            <p className="text-xs text-slate-600 mt-1">Add tickers above to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {watchlist.map((ticker) => {
              const price = prices[ticker]
              return (
                <div
                  key={ticker}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-navy-700/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-navy-900 border border-slate-700
                      flex items-center justify-center">
                      <span className="text-xs font-bold text-cyan-400">
                        {ticker.slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <p className="font-mono font-semibold text-slate-200 text-sm">{ticker}</p>
                      <p className="text-xs text-slate-500">
                        {ticker.includes('/') ? 'Crypto' : 'Stock'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {price !== undefined && (
                      <div className="text-right">
                        <p className="font-mono text-sm text-slate-200">
                          ${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => removeTicker(ticker)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400
                        hover:bg-red-500/10 transition-all"
                      title={`Remove ${ticker}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="card p-4 border-cyan-500/20 bg-cyan-500/5">
        <p className="text-xs text-cyan-300/80">
          <strong className="text-cyan-300">Tip:</strong> Use <span className="font-mono">TICKER/USD</span> format for crypto
          (e.g. <span className="font-mono">BTC/USD</span>, <span className="font-mono">ETH/USD</span>).
          Stocks use standard symbols (e.g. <span className="font-mono">AAPL</span>, <span className="font-mono">TSLA</span>).
          The agent analyses each ticker every cycle and will only trade ones where
          confidence ≥ the threshold in Settings.
        </p>
      </div>
    </div>
  )
}
