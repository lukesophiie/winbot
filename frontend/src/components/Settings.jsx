import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  Save, Eye, EyeOff, AlertTriangle, CheckCircle, Info, RefreshCw,
} from 'lucide-react'

function Section({ title, description, children }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, name, value, onChange, type = 'text', placeholder, hint, secret }) {
  const [show, setShow] = useState(false)
  const inputType = secret ? (show ? 'text' : 'password') : type

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <div className="relative">
        <input
          name={name}
          type={inputType}
          value={value || ''}
          onChange={onChange}
          placeholder={placeholder}
          className="input pr-10"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
    </div>
  )
}

function RangeField({ label, name, value, onChange, min, max, step = 0.5, unit = '' }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-400">{label}</label>
        <span className="text-xs font-mono text-cyan-400">{value}{unit}</span>
      </div>
      <input
        type="range"
        name={name}
        min={min}
        max={max}
        step={step}
        value={value || 0}
        onChange={onChange}
        className="w-full h-1.5 rounded-full accent-cyan-400 bg-slate-700 outline-none"
      />
      <div className="flex justify-between text-xs text-slate-600 mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

export default function Settings({ toast, agentRunning }) {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [agentStatus, setAgentStatus] = useState(null)

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/settings')
      setSettings(data.settings || {})
    } catch (e) {
      toast?.('Failed to load settings', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchStatus = async () => {
    try {
      const { data } = await axios.get('/api/agent/status')
      setAgentStatus(data)
    } catch (e) {}
  }

  useEffect(() => {
    fetchSettings()
    fetchStatus()
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setSettings((prev) => ({ ...prev, [name]: value }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await axios.put('/api/settings', { settings })
      setSaved(true)
      toast?.('Settings saved', 'success')
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      toast?.(e.response?.data?.detail || 'Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  const g = (key) => settings[key] || ''

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">Configure API keys and trading parameters</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchSettings} disabled={loading} className="btn-icon" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm">
            {saved ? <CheckCircle size={15} /> : <Save size={15} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      {agentRunning && (
        <div className="card p-4 border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300">
            The agent is currently running. Stop it before changing API keys or risk parameters.
          </p>
        </div>
      )}

      {/* Alpaca Paper */}
      <Section
        title="Alpaca Paper Trading"
        description="Free paper trading account — get keys at alpaca.markets/paper"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Paper API Key"
            name="alpaca_paper_key"
            value={g('alpaca_paper_key')}
            onChange={handleChange}
            placeholder="PK…"
            secret
          />
          <Field
            label="Paper Secret Key"
            name="alpaca_paper_secret"
            value={g('alpaca_paper_secret')}
            onChange={handleChange}
            placeholder="••••••••"
            secret
          />
        </div>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-navy-900/60 border border-slate-700/40">
          <Info size={13} className="text-cyan-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-400">
            Paper trading uses virtual money — no real funds at risk.
            Get free keys at <strong className="text-slate-300">app.alpaca.markets</strong> → Paper Trading → API Keys.
          </p>
        </div>
      </Section>

      {/* Alpaca Live */}
      <Section
        title="Alpaca Live Trading"
        description="Real money trading — only configure if you intend to trade live"
      >
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-3">
          <p className="text-xs text-red-300 flex items-center gap-2">
            <AlertTriangle size={12} />
            <strong>Warning:</strong> Live trading uses real funds. Double-check all risk parameters before enabling.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Live API Key"
            name="alpaca_live_key"
            value={g('alpaca_live_key')}
            onChange={handleChange}
            placeholder="AK…"
            secret
          />
          <Field
            label="Live Secret Key"
            name="alpaca_live_secret"
            value={g('alpaca_live_secret')}
            onChange={handleChange}
            placeholder="••••••••"
            secret
          />
        </div>
      </Section>

      {/* Claude */}
      <Section
        title="Claude AI"
        description="Anthropic API key for trade decision making"
      >
        <Field
          label="Claude API Key"
          name="claude_api_key"
          value={g('claude_api_key')}
          onChange={handleChange}
          placeholder="sk-ant-…"
          hint="Get your key at console.anthropic.com"
          secret
        />
        <div className="p-3 rounded-lg bg-navy-900/60 border border-slate-700/40">
          <p className="text-xs text-slate-400">
            WinBot uses <strong className="text-slate-300">claude-sonnet-4-20250514</strong> for trade analysis.
            Each analysis cycle calls the API once per watchlist ticker.
          </p>
        </div>
      </Section>

      {/* Agent settings */}
      <Section
        title="Agent Configuration"
        description="How often the agent runs and its confidence threshold"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Crypto Scalp Interval (minutes)
            </label>
            <select
              name="crypto_interval"
              value={g('crypto_interval') || '1'}
              onChange={handleChange}
              className="input"
            >
              {[1, 2, 3, 5].map((v) => (
                <option key={v} value={v}>{v} {v === 1 ? 'minute' : 'minutes'}</option>
              ))}
            </select>
            <p className="text-xs text-slate-600 mt-1">How often crypto is scalped (stocks run every 5th cycle)</p>
          </div>

          <RangeField
            label="Minimum Confidence Threshold"
            name="min_confidence"
            value={g('min_confidence') || '0.7'}
            onChange={handleChange}
            min={0.5}
            max={0.95}
            step={0.05}
          />
        </div>
      </Section>

      {/* Risk Management */}
      <Section
        title="Risk Management"
        description="These rules are enforced before every trade — the agent cannot bypass them"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <RangeField
            label="Stop-Loss %"
            name="stop_loss_pct"
            value={g('stop_loss_pct') || '2'}
            onChange={handleChange}
            min={0.5}
            max={10}
            step={0.5}
            unit="%"
          />
          <RangeField
            label="Max Position Size %"
            name="max_position_size_pct"
            value={g('max_position_size_pct') || '10'}
            onChange={handleChange}
            min={1}
            max={50}
            step={1}
            unit="%"
          />
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Max Open Trades
            </label>
            <select
              name="max_open_trades"
              value={g('max_open_trades') || '5'}
              onChange={handleChange}
              className="input"
            >
              {[1, 2, 3, 4, 5, 7, 10, 15, 20].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <RangeField
            label="Daily Loss Limit %"
            name="daily_loss_limit_pct"
            value={g('daily_loss_limit_pct') || '5'}
            onChange={handleChange}
            min={1}
            max={20}
            step={0.5}
            unit="%"
          />
        </div>

        <div className="p-3 rounded-lg bg-navy-900/60 border border-slate-700/40">
          <p className="text-xs text-slate-400">
            <strong className="text-slate-300">Position sizing:</strong> small = 25% of max,
            medium = 50% of max, large = 100% of max.
            Claude chooses sizing based on signal strength.
          </p>
        </div>
      </Section>

      {/* Connection status */}
      {agentStatus && (
        <Section title="Connection Status">
          <div className="space-y-2">
            {[
              ['Broker', agentStatus.broker_connected],
              ['Agent',  agentStatus.running],
            ].map(([label, ok]) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
                <span className="text-sm text-slate-400">{label}</span>
                <span className={`flex items-center gap-1.5 text-xs font-medium
                  ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {ok ? <><CheckCircle size={12} /> Connected</> : '— Disconnected'}
                </span>
              </div>
            ))}
            {agentStatus.last_error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                <strong>Last error:</strong> {agentStatus.last_error}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Save button at bottom */}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saved ? <CheckCircle size={16} /> : <Save size={16} />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Settings'}
        </button>
      </div>
    </div>
  )
}
