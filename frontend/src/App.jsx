import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import axios from 'axios'
import Navbar from './components/Navbar.jsx'
import Dashboard from './components/Dashboard.jsx'
import TradeLog from './components/TradeLog.jsx'
import AgentReasoning from './components/AgentReasoning.jsx'
import Watchlist from './components/Watchlist.jsx'
import PerformanceStats from './components/PerformanceStats.jsx'
import Settings from './components/Settings.jsx'

// In production, VITE_API_URL points to Railway backend (e.g. https://winbot.up.railway.app)
const BACKEND = import.meta.env.VITE_API_URL || ''
const API = `${BACKEND}/api`
if (BACKEND) axios.defaults.baseURL = BACKEND
const WS_URL = BACKEND
  ? BACKEND.replace(/^http/, 'ws') + '/ws'
  : `ws://${window.location.host}/ws`

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`
            pointer-events-auto animate-slide-in px-4 py-3 rounded-lg shadow-xl
            border text-sm font-medium cursor-pointer max-w-sm
            ${t.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-200' : ''}
            ${t.type === 'error'   ? 'bg-red-900/90 border-red-500/40 text-red-200' : ''}
            ${t.type === 'info'    ? 'bg-navy-800/90 border-cyan-500/40 text-cyan-200' : ''}
            ${t.type === 'trade'   ? 'bg-emerald-900/90 border-emerald-400/40 text-emerald-100' : ''}
          `}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentLoading, setAgentLoading] = useState(false)
  const [portfolio, setPortfolio] = useState(null)
  const [positions, setPositions] = useState([])
  const [trades, setTrades] = useState([])
  const [reasoning, setReasoning] = useState([])
  const [portfolioHistory, setPortfolioHistory] = useState([])
  const [wsConnected, setWsConnected] = useState(false)
  const [toasts, setToasts] = useState([])
  const [tradingMode, setTradingMode] = useState('paper')

  const wsRef = useRef(null)
  const toastId = useRef(0)

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const toast = useCallback((message, type = 'info') => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchPortfolio = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/portfolio`)
      setPortfolio(data.account)
      setPositions(data.positions || [])
      setTradingMode(data.mode || 'paper')
    } catch (e) {
      console.error('Portfolio fetch failed:', e)
    }
  }, [])

  const fetchTrades = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/trades?limit=100`)
      setTrades(data.trades || [])
    } catch (e) {
      console.error('Trades fetch failed:', e)
    }
  }, [])

  const fetchReasoning = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/reasoning?limit=50`)
      setReasoning(data.decisions || [])
    } catch (e) {
      console.error('Reasoning fetch failed:', e)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/portfolio/history`)
      setPortfolioHistory(data.history || [])
    } catch (e) {
      console.error('History fetch failed:', e)
    }
  }, [])

  const fetchAgentStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/agent/status`)
      setAgentRunning(data.running)
      setTradingMode(data.mode || 'paper')
    } catch (e) {
      console.error('Agent status fetch failed:', e)
    }
  }, [])

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setWsConnected(true)
      console.log('[ws] Connected')
    }

    ws.onclose = () => {
      setWsConnected(false)
      console.log('[ws] Disconnected — reconnecting in 3s')
      setTimeout(connectWs, 3000)
    }

    ws.onerror = () => ws.close()

    ws.onmessage = ({ data: raw }) => {
      try {
        const msg = JSON.parse(raw)
        switch (msg.type) {
          case 'connected':
            setAgentRunning(msg.data.agent_running)
            break

          case 'portfolio_update':
            setPortfolio(msg.data.account)
            setPositions(msg.data.positions || [])
            fetchHistory()
            break

          case 'trade_executed': {
            const d = msg.data
            setTrades((prev) => [{
              ticker: d.ticker, action: d.action, quantity: d.quantity,
              price: d.price, timestamp: d.timestamp, status: 'filled', pnl: 0,
            }, ...prev].slice(0, 100))
            toast(`${d.action} ${d.quantity.toFixed(4)} ${d.ticker} @ $${d.price.toFixed(2)}`, 'trade')
            fetchPortfolio()
            break
          }

          case 'reasoning':
            setReasoning((prev) => [msg.data, ...prev].slice(0, 50))
            break

          case 'stop_loss':
            toast(`Stop-loss: ${msg.data.ticker} closed (P&L: $${msg.data.pnl?.toFixed(2)})`, 'error')
            fetchPortfolio()
            fetchTrades()
            break

          case 'agent_status':
            setAgentRunning(msg.data.status === 'running')
            break
        }
      } catch (e) {
        console.error('[ws] Parse error:', e)
      }
    }

    // Heartbeat
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 20000)
    ws.addEventListener('close', () => clearInterval(ping))
  }, [fetchHistory, fetchPortfolio, fetchTrades, toast])

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPortfolio()
    fetchTrades()
    fetchReasoning()
    fetchHistory()
    fetchAgentStatus()
    connectWs()
  }, []) // eslint-disable-line

  // ── Poll every 30s as backup ───────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPortfolio()
      fetchTrades()
    }, 30_000)
    return () => clearInterval(interval)
  }, [fetchPortfolio, fetchTrades])

  // ── Agent control ──────────────────────────────────────────────────────────
  const startAgent = async () => {
    setAgentLoading(true)
    try {
      await axios.post(`${API}/agent/start`)
      setAgentRunning(true)
      toast('Agent started — WinBot is live', 'success')
    } catch (e) {
      toast(e.response?.data?.detail || 'Failed to start agent', 'error')
    } finally {
      setAgentLoading(false)
    }
  }

  const stopAgent = async () => {
    setAgentLoading(true)
    try {
      await axios.post(`${API}/agent/stop`)
      setAgentRunning(false)
      toast('Agent stopped', 'info')
    } catch (e) {
      toast(e.response?.data?.detail || 'Failed to stop agent', 'error')
    } finally {
      setAgentLoading(false)
    }
  }

  const toggleMode = async (mode) => {
    try {
      await axios.post(`${API}/mode`, { mode })
      setTradingMode(mode)
      toast(`Switched to ${mode} trading`, 'info')
    } catch (e) {
      toast(e.response?.data?.detail || 'Could not switch mode', 'error')
    }
  }

  // ── Shared props ───────────────────────────────────────────────────────────
  const shared = {
    agentRunning, agentLoading, startAgent, stopAgent,
    portfolio, positions, trades, reasoning, portfolioHistory,
    tradingMode, toggleMode, wsConnected, toast,
    refetch: { fetchPortfolio, fetchTrades, fetchReasoning, fetchHistory },
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Navbar {...shared} />
        <main className="flex-1 p-4 md:p-6 max-w-screen-2xl mx-auto w-full">
          <Routes>
            <Route path="/"            element={<Dashboard      {...shared} />} />
            <Route path="/trades"      element={<TradeLog        {...shared} />} />
            <Route path="/reasoning"   element={<AgentReasoning  {...shared} />} />
            <Route path="/watchlist"   element={<Watchlist       {...shared} />} />
            <Route path="/performance" element={<PerformanceStats {...shared} />} />
            <Route path="/settings"    element={<Settings        {...shared} />} />
            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </BrowserRouter>
  )
}
