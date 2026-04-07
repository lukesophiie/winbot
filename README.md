# WinBot — AI Algorithmic Trading Agent

WinBot is a full-stack algorithmic trading terminal powered by Claude AI. It analyses technical indicators (RSI, MACD, EMA) for stocks and crypto, then autonomously places paper or live trades via Alpaca Markets.

---

## Architecture

```
winbot/
├── backend/
│   ├── main.py          FastAPI server + WebSocket
│   ├── agent.py         Claude AI trading loop
│   ├── broker.py        Alpaca API wrapper
│   ├── data.py          Market data (yfinance)
│   ├── indicators.py    RSI, MACD, EMA calculations
│   ├── risk.py          Risk management rules
│   ├── database.py      SQLite trade logging
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── components/  Dashboard, TradeLog, Settings, …
├── .env.example
└── README.md
```

---

## Quick Start

### 1 — Get a free Alpaca paper trading account

1. Go to **https://app.alpaca.markets** and sign up (free, no credit card needed)
2. In the left sidebar click **Paper Trading**
3. Click **API Keys** → **Generate New Key**
4. Copy the **API Key** and **Secret Key** — you only see the secret once!

### 2 — Get your Claude API key

1. Go to **https://console.anthropic.com** and sign in / create an account
2. Click **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-`)

### 3 — Clone & install backend

```bash
cd winbot/backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 4 — Install frontend

```bash
cd winbot/frontend
npm install
```

### 5 — Configure environment (optional)

```bash
cp .env.example .env
# Edit .env with your keys
```

> You can also enter all keys directly in the **Settings** page of the UI — they are stored in the local SQLite database.

### 6 — Run the backend

```bash
cd winbot/backend
source venv/bin/activate
python main.py
# Backend starts on http://localhost:8000
```

### 7 — Run the frontend

```bash
cd winbot/frontend
npm run dev
# Frontend starts on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## First-time Setup Checklist

- [ ] Enter your **Alpaca Paper Key + Secret** in Settings → Alpaca Paper Trading
- [ ] Enter your **Claude API Key** in Settings → Claude AI
- [ ] Confirm **Trading Mode** is set to **PAPER** (default)
- [ ] Add tickers to your **Watchlist** (e.g. AAPL, TSLA, BTC/USD)
- [ ] Review **Risk Parameters** (stop-loss %, max position size, etc.)
- [ ] Click **Start** on the Dashboard or Navbar — the agent will run its first cycle immediately

---

## How It Works

1. Every N minutes (configurable), the agent loops over the watchlist
2. For each ticker it fetches 60 days of 1-hour OHLCV data via yfinance
3. It calculates: RSI (14), MACD (12/26/9), EMA 20, EMA 50, volume ratio
4. It sends all this to Claude with a structured prompt asking for a JSON decision
5. Claude responds with `{ action, confidence, sizing, reasoning }`
6. If `confidence >= min_confidence` **and** all risk rules pass, the order is placed via Alpaca
7. Every decision (executed or blocked) is logged and shown in the AI Log
8. Stop-losses are checked before every cycle and trigger automatic position closes

### Claude's JSON response format

```json
{
  "action": "BUY",
  "confidence": 0.82,
  "sizing": "medium",
  "reasoning": "RSI at 28 indicates oversold conditions. Price is above EMA 50 maintaining the uptrend. MACD histogram turning positive — momentum reversal confirmed."
}
```

Only trades where `confidence >= 0.7` (configurable) are executed.

---

## Risk Management Rules

| Rule | Default | Description |
|------|---------|-------------|
| Stop-loss | 2% | Auto-close position if unrealised loss exceeds this |
| Max position size | 10% | Max % of portfolio per single trade |
| Max open trades | 5 | Agent won't open new positions beyond this |
| Daily loss limit | 5% | Agent pauses trading if daily P&L loss hits this |
| Min confidence | 0.7 | Claude must score ≥ this to execute |

All parameters are configurable from the Settings page.

---

## Switching to Live Trading

> ⚠️ **Live trading uses real money. Understand the risks before enabling.**

1. Enter your Alpaca **Live** API keys in Settings
2. Stop the agent if running
3. Toggle the **PAPER / LIVE** switch in the top navbar to **LIVE**
4. Review all risk parameters
5. Start the agent

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/portfolio` | Account + positions |
| GET | `/api/portfolio/history` | Equity curve data |
| GET | `/api/trades` | Trade history |
| GET | `/api/reasoning` | AI decision log |
| GET/PUT | `/api/settings` | App settings |
| GET/POST/DELETE | `/api/watchlist` | Manage watchlist |
| POST | `/api/agent/start` | Start the trading agent |
| POST | `/api/agent/stop` | Stop the trading agent |
| GET | `/api/agent/status` | Agent status |
| GET | `/api/performance` | Performance statistics |
| WebSocket | `/ws` | Real-time updates |

---

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, uvicorn, asyncio
- **AI**: Anthropic Claude (`claude-sonnet-4-20250514`)
- **Broker**: Alpaca Markets (`alpaca-py`)
- **Market Data**: yfinance
- **Indicators**: pandas, numpy (no TA-Lib dependency)
- **Database**: SQLite (zero config)
- **Frontend**: React 18, Vite, Tailwind CSS v3
- **Charts**: Recharts
- **Icons**: Lucide React

---

## Troubleshooting

**"Claude API key not configured"** — Enter your `sk-ant-...` key in Settings

**"Could not connect to Alpaca"** — Double-check paper keys are from the Paper Trading section (not Live)

**"Insufficient data"** — yfinance needs at least 52 candles. Less liquid tickers or very new listings may fail

**Frontend can't reach backend** — Make sure the backend is running on port 8000. The Vite proxy is pre-configured

**No trades being executed** — Check the AI Log page. Common reasons: confidence below threshold, max trades reached, daily loss limit hit, or HOLD decision

---

## Deploying to Railway (backend) + Vercel (frontend)

### Backend → Railway

1. Push this repo to GitHub (see below)
2. Go to **railway.app** → New Project → Deploy from GitHub repo
3. Select the repo, set **Root Directory** to `backend/`
4. In the service **Variables** tab, add:

```
ALPACA_PAPER_KEY=your_key
ALPACA_PAPER_SECRET=your_secret
CLAUDE_API_KEY=your_claude_key
DB_PATH=/data/winbot.db
FRONTEND_URL=https://your-app.vercel.app
```

5. In the service **Volumes** tab → Add Volume → mount at `/data`
6. Railway auto-deploys — copy your public URL (e.g. `https://winbot-backend.up.railway.app`)

### Frontend → Vercel

1. Go to **vercel.com** → New Project → Import your GitHub repo
2. Set **Root Directory** to `frontend/`
3. Add environment variable:

```
VITE_API_URL=https://winbot-backend.up.railway.app
```

4. Deploy — Vercel gives you a URL like `https://winbot.vercel.app`
5. Paste that URL back into Railway as `FRONTEND_URL` and redeploy
