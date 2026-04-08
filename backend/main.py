import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import database as db
from agent import TradingAgent
from broker import AlpacaBroker

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Global state ──────────────────────────────────────────────────────────────
_ws_clients: Set[WebSocket] = set()
_agent: TradingAgent | None = None
_agent_task: asyncio.Task | None = None
_agent_running: bool = False

_trader_agents: dict = {}
_trader_tasks:  dict = {}


# ── WebSocket broadcast ───────────────────────────────────────────────────────
async def broadcast(message: dict):
    if not _ws_clients:
        return
    text = json.dumps(message)
    dead = set()
    for ws in _ws_clients.copy():
        try:
            await ws.send_text(text)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


# ── Broker factory ────────────────────────────────────────────────────────────
def _make_broker() -> AlpacaBroker:
    mode = db.get_setting("trading_mode") or "paper"
    paper = mode == "paper"
    if paper:
        key = db.get_setting("alpaca_paper_key") or ""
        secret = db.get_setting("alpaca_paper_secret") or ""
    else:
        key = db.get_setting("alpaca_live_key") or ""
        secret = db.get_setting("alpaca_live_secret") or ""
    return AlpacaBroker(key, secret, paper=paper)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent, _agent_task, _agent_running
    db.init_db()
    logger.info("WinBot backend ready")

    # Auto-restart agent if it was running before a container restart
    if db.get_setting("agent_autostart") == "true":
        try:
            broker = _make_broker()
            if broker.is_connected():
                _agent = TradingAgent(broker=broker, broadcast=broadcast)
                _agent_task = asyncio.create_task(_agent.run())
                _agent_running = True
                logger.info("Agent auto-restarted from persisted state")
            else:
                db.set_setting("agent_autostart", "false")
                logger.warning("Auto-restart skipped: broker not connected")
        except Exception as e:
            logger.error(f"Auto-restart failed: {e}")
            db.set_setting("agent_autostart", "false")

    # Auto-restart active trader agents
    for t in db.get_traders():
        if t["active"]:
            try:
                from trader_agent import TraderAgent as TA
                ta = TA(t, broadcast=broadcast)
                _trader_agents[t["name"]] = ta
                _trader_tasks[t["name"]] = asyncio.create_task(ta.run())
                logger.info(f"Trader {t['name']} auto-restarted")
            except Exception as e:
                logger.error(f"Trader {t['name']} auto-restart failed: {e}")

    yield

    for ta in _trader_agents.values():
        ta.stop()
    if _agent:
        _agent.stop()
    logger.info("WinBot backend shutdown")


app = FastAPI(title="WinBot API", version="1.1.0", lifespan=lifespan)

# FRONTEND_URL env var lets you whitelist your Vercel domain in production
_extra_origin = os.environ.get("FRONTEND_URL", "")
_origins = ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"]
if _extra_origin:
    _origins.append(_extra_origin.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
#  WebSocket
# ══════════════════════════════════════════════════════════════════════════════
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    logger.info(f"WS client connected ({len(_ws_clients)} total)")
    try:
        await websocket.send_text(json.dumps({
            "type": "connected",
            "data": {"agent_running": _agent_running,
                     "timestamp": datetime.utcnow().isoformat()},
        }))
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)
        logger.info(f"WS client disconnected ({len(_ws_clients)} total)")


# ══════════════════════════════════════════════════════════════════════════════
#  Portfolio
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/portfolio")
async def get_portfolio():
    broker = _make_broker()
    if not broker.is_connected():
        return {
            "connected": False,
            "mode": db.get_setting("trading_mode"),
            "account": {"portfolio_value": 0, "cash": 0, "equity": 0,
                        "pnl": 0, "pnl_pct": 0, "buying_power": 0},
            "positions": [],
        }
    return {
        "connected": True,
        "mode": db.get_setting("trading_mode"),
        "account": broker.get_account(),
        "positions": broker.get_positions(),
    }


@app.get("/api/portfolio/history")
async def get_portfolio_history():
    return {"history": db.get_portfolio_history(200)}


# ══════════════════════════════════════════════════════════════════════════════
#  Trades
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/trades")
async def get_trades(limit: int = 50):
    return {"trades": db.get_trades(limit)}


# ══════════════════════════════════════════════════════════════════════════════
#  Reasoning / Decisions
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/reasoning")
async def get_reasoning(limit: int = 50):
    return {"decisions": db.get_decisions(limit)}


# ══════════════════════════════════════════════════════════════════════════════
#  Watchlist
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/watchlist")
async def get_watchlist():
    raw = db.get_setting("watchlist") or "[]"
    try:
        wl = json.loads(raw)
    except Exception:
        wl = []
    return {"watchlist": wl}


class TickerBody(BaseModel):
    ticker: str


@app.post("/api/watchlist")
async def add_ticker(body: TickerBody):
    raw = db.get_setting("watchlist") or "[]"
    try:
        wl = json.loads(raw)
    except Exception:
        wl = []
    t = body.ticker.upper().strip()
    if t and t not in wl:
        wl.append(t)
        db.set_setting("watchlist", json.dumps(wl))
    return {"watchlist": wl}


@app.delete("/api/watchlist/{ticker}")
async def remove_ticker(ticker: str):
    raw = db.get_setting("watchlist") or "[]"
    try:
        wl = json.loads(raw)
    except Exception:
        wl = []
    t = ticker.upper()
    if t in wl:
        wl.remove(t)
        db.set_setting("watchlist", json.dumps(wl))
    return {"watchlist": wl}


# ══════════════════════════════════════════════════════════════════════════════
#  Settings
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/settings")
async def get_settings():
    raw = db.get_all_settings()
    # Overlay env vars (Railway env vars take priority — show them even if DB is empty)
    for db_key, env_key in db._ENV_MAP.items():
        env_val = os.environ.get(env_key)
        if env_val:
            raw[db_key] = env_val
    masked = {}
    for k, v in raw.items():
        if ("key" in k.lower() or "secret" in k.lower()) and v:
            masked[k] = "••••" + v[-4:] if len(v) > 4 else "••••"
        else:
            masked[k] = v
    return {"settings": masked}


class SettingsBody(BaseModel):
    settings: dict


@app.put("/api/settings")
async def update_settings(body: SettingsBody):
    for k, v in body.settings.items():
        val = str(v)
        # Skip masked placeholder values
        if val.startswith("••••") or val.startswith("***"):
            continue
        db.set_setting(k, val)
    return {"status": "ok"}


# ══════════════════════════════════════════════════════════════════════════════
#  Trading Mode
# ══════════════════════════════════════════════════════════════════════════════
class ModeBody(BaseModel):
    mode: str


@app.post("/api/mode")
async def set_mode(body: ModeBody):
    global _agent_running
    if _agent_running:
        raise HTTPException(400, "Stop the agent before switching modes")
    if body.mode not in ("paper", "live"):
        raise HTTPException(400, "mode must be 'paper' or 'live'")
    db.set_setting("trading_mode", body.mode)
    return {"mode": body.mode}


# ══════════════════════════════════════════════════════════════════════════════
#  Agent Control
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/agent/status")
async def agent_status():
    broker = _make_broker()
    broker_error = broker.last_error if not broker.is_connected() else None
    return {
        "running": _agent_running,
        "mode": db.get_setting("trading_mode"),
        "interval": db.get_setting("trading_interval"),
        "broker_connected": broker.is_connected(),
        "last_error": (_agent.last_error if _agent else None) or broker_error,
    }


@app.post("/api/agent/start")
async def start_agent():
    global _agent, _agent_task, _agent_running

    if _agent_running:
        return {"status": "already_running"}

    if not db.get_setting("claude_api_key"):
        raise HTTPException(400, "Claude API key not configured in Settings")

    mode = db.get_setting("trading_mode") or "paper"
    if mode == "paper":
        if not db.get_setting("alpaca_paper_key") or not db.get_setting("alpaca_paper_secret"):
            raise HTTPException(400, "Alpaca paper API keys not configured in Settings")
    else:
        if not db.get_setting("alpaca_live_key") or not db.get_setting("alpaca_live_secret"):
            raise HTTPException(400, "Alpaca live API keys not configured in Settings")

    broker = _make_broker()
    if not broker.is_connected():
        raise HTTPException(400, "Could not connect to Alpaca — check API keys")

    _agent = TradingAgent(broker=broker, broadcast=broadcast)
    _agent_task = asyncio.create_task(_agent.run())
    _agent_running = True
    db.set_setting("agent_autostart", "true")   # persist so container restart resumes it

    logger.info("Agent started via API")
    return {"status": "started"}


@app.post("/api/agent/stop")
async def stop_agent():
    global _agent, _agent_task, _agent_running

    if not _agent_running:
        return {"status": "not_running"}

    if _agent:
        _agent.stop()
    if _agent_task:
        _agent_task.cancel()
        try:
            await _agent_task
        except (asyncio.CancelledError, Exception):
            pass

    _agent_running = False
    _agent = None
    _agent_task = None
    db.set_setting("agent_autostart", "false")  # don't restart on next boot

    logger.info("Agent stopped via API")
    return {"status": "stopped"}


@app.post("/api/agent/run-now")
async def run_agent_now():
    """Trigger an immediate analysis cycle without waiting for the timer."""
    if not _agent_running or not _agent:
        raise HTTPException(400, "Agent is not running")
    asyncio.create_task(_agent.run_cycle())
    return {"status": "cycle_triggered"}


# ══════════════════════════════════════════════════════════════════════════════
#  Performance
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/performance")
async def get_performance():
    return {"stats": db.get_performance_stats()}


# ══════════════════════════════════════════════════════════════════════════════
#  Signal forecast — buy/sell triggers, trade sizes, frequency
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/forecast/{ticker}")
async def get_forecast(ticker: str):
    from data import fetch_ohlcv
    from indicators import calculate_all_indicators

    df = fetch_ohlcv(ticker, period="60d", interval="1h")
    if df.empty:
        raise HTTPException(404, f"No data for {ticker}")

    ind = calculate_all_indicators(df)
    price     = ind["current_price"]
    rsi       = ind["rsi"]
    ema20     = ind["ema20"]
    ema50     = ind["ema50"]
    macd_hist = ind["macd"]["histogram"]

    # Portfolio value
    broker = _make_broker()
    portfolio_value = 100_000.0
    position = None
    if broker.is_connected():
        acct = broker.get_account()
        portfolio_value = float(acct.get("portfolio_value") or 100_000)
        position = broker.get_position(ticker)

    # Settings
    max_pos_pct   = float(db.get_setting("max_position_size_pct") or 10)
    stop_loss_pct = float(db.get_setting("stop_loss_pct") or 2)
    interval_min  = int(db.get_setting("trading_interval") or 5)

    # ── Signal score (-100 to +100) based on 5 indicator checks ──────────────
    score = 0
    score += 2  if rsi < 30 else (1 if rsi < 45 else (-1 if rsi > 55 else (-2 if rsi > 70 else 0)))
    score += 1  if price > ema20 else -1
    score += 1  if price > ema50 else -1
    score += 1  if macd_hist > 0 else -1
    signal_pct = round(score / 5 * 100)           # -100 to +100
    signal     = "BUY" if signal_pct >= 40 else ("SELL" if signal_pct <= -40 else "HOLD")

    # ── Distance to triggers ──────────────────────────────────────────────────
    rsi_to_buy  = round(rsi - 30, 1)    # how many RSI points until oversold
    rsi_to_sell = round(70 - rsi, 1)    # how many RSI points until overbought

    # Rough price estimate for RSI triggers (uses recent volatility as proxy)
    closes      = df["close"].astype(float)
    vol_14      = float(closes.tail(14).pct_change().std() * 100)  # % std
    # Approx: each 1% price drop moves RSI ~(100/vol_factor) points
    pct_per_rsi_point = vol_14 / 10 if vol_14 > 0 else 0.15
    buy_price   = round(price * (1 - rsi_to_buy  * pct_per_rsi_point / 100), 2) if rsi_to_buy  > 0 else price
    sell_price  = round(price * (1 + rsi_to_sell * pct_per_rsi_point / 100), 2) if rsi_to_sell > 0 else price

    # Stop-loss from current price (or open position entry)
    entry_price = price
    if position:
        entry_price = float(position.get("avg_entry_price") or price)
    stop_price  = round(entry_price * (1 - stop_loss_pct / 100), 2)

    # ── Trade sizes ───────────────────────────────────────────────────────────
    def sz(factor: float):
        dollars = round(portfolio_value * max_pos_pct * factor / 100, 2)
        units   = round(dollars / price, 4) if price > 0 else 0
        return {"dollars": dollars, "units": units}

    return {
        "ticker":          ticker,
        "current_price":   price,
        "signal":          signal,
        "signal_pct":      signal_pct,
        "indicators": {
            "rsi":            rsi,
            "rsi_to_buy":     rsi_to_buy,
            "rsi_to_sell":    rsi_to_sell,
            "ema20":          ema20,
            "ema50":          ema50,
            "price_vs_ema20": round(price - ema20, 2),
            "price_vs_ema50": round(price - ema50, 2),
            "macd_hist":      macd_hist,
        },
        "triggers": {
            "buy_price":           buy_price,
            "sell_price":          sell_price,
            "stop_loss_price":     stop_price,
            "stop_loss_pct":       stop_loss_pct,
            "buy_drop_pct":        round((price - buy_price) / price * 100, 1) if buy_price < price else 0,
            "sell_rise_pct":       round((sell_price - price) / price * 100, 1) if sell_price > price else 0,
        },
        "trade_sizes": {
            "small":  sz(0.25),
            "medium": sz(0.50),
            "large":  sz(1.00),
        },
        "position":        position,
        "frequency": {
            "interval_minutes":   interval_min,
            "analyses_per_day":   int(24 * 60 / interval_min),
            "watchlist_size":     len(json.loads(db.get_setting("watchlist") or "[]")),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Chart data  (OHLCV + indicator series for the frontend chart)
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/chart/{ticker}")
async def get_chart_data(ticker: str, period: str = "5d"):
    import numpy as np
    import pandas as pd
    from data import fetch_ohlcv

    interval = "1d" if period in ("1mo", "3mo") else "1h"
    df = fetch_ohlcv(ticker, period=period, interval=interval)
    if df.empty:
        raise HTTPException(404, f"No data available for {ticker}")

    closes = df["close"].astype(float)

    # EMA series
    ema20_s = closes.ewm(span=20, adjust=False).mean()
    ema50_s = closes.ewm(span=50, adjust=False).mean()

    # RSI series
    delta = closes.diff()
    avg_gain = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
    avg_loss = (-delta).clip(lower=0).ewm(com=13, adjust=False).mean()
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi_s = (100 - (100 / (1 + rs))).fillna(50)

    # MACD series
    ema12_s = closes.ewm(span=12, adjust=False).mean()
    ema26_s = closes.ewm(span=26, adjust=False).mean()
    macd_s = ema12_s - ema26_s
    signal_s = macd_s.ewm(span=9, adjust=False).mean()
    hist_s = macd_s - signal_s

    candles = []
    for i, (ts, row) in enumerate(df.iterrows()):
        ts_str = str(ts)[:19]  # trim to seconds, no tz
        candles.append({
            "time": ts_str,
            "open":  round(float(row["open"]),  2),
            "high":  round(float(row["high"]),  2),
            "low":   round(float(row["low"]),   2),
            "close": round(float(row["close"]), 2),
            "volume": int(row["volume"]) if not pd.isna(row["volume"]) else 0,
            "ema20":       round(float(ema20_s.iloc[i]),  2),
            "ema50":       round(float(ema50_s.iloc[i]),  2),
            "rsi":         round(float(rsi_s.iloc[i]),    1),
            "macd":        round(float(macd_s.iloc[i]),   4),
            "macd_signal": round(float(signal_s.iloc[i]), 4),
            "macd_hist":   round(float(hist_s.iloc[i]),   4),
        })

    ticker_clean = ticker.replace("/", "")
    all_trades    = db.get_trades(500)
    all_decisions = db.get_decisions(500)
    ticker_trades    = [t for t in all_trades    if t["ticker"] in (ticker, ticker_clean)]
    ticker_decisions = [d for d in all_decisions if d["ticker"] in (ticker, ticker_clean)]

    return {
        "ticker":    ticker,
        "candles":   candles[-200:],
        "trades":    ticker_trades[:50],
        "decisions": ticker_decisions[:50],
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Traders
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/traders")
async def get_traders():
    from data import fetch_current_price
    traders = db.get_traders()
    result = []
    for t in traders:
        positions = db.get_trader_positions(t["name"])
        cash = float(t["cash"])
        # Calculate live portfolio value
        positions_value = 0.0
        for ticker, pos in positions.items():
            try:
                price = fetch_current_price(ticker)
                positions_value += pos["qty"] * (price if price > 0 else pos["avg_price"])
            except Exception:
                positions_value += pos["qty"] * pos["avg_price"]
        portfolio_value = cash + positions_value
        allocation = float(t["allocation"])
        pnl = portfolio_value - allocation
        pnl_pct = (pnl / allocation * 100) if allocation > 0 else 0.0
        result.append({
            **t,
            "portfolio_value": round(portfolio_value, 2),
            "positions_value": round(positions_value, 2),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "is_running": t["name"] in _trader_agents and _trader_agents[t["name"]].running,
        })
    return {"traders": result}


@app.get("/api/traders/{name}")
async def get_trader_detail(name: str):
    from data import fetch_current_price
    t = db.get_trader(name)
    if not t:
        raise HTTPException(404, f"Trader '{name}' not found")
    positions = db.get_trader_positions(name)
    cash = float(t["cash"])
    positions_with_prices = {}
    positions_value = 0.0
    for ticker, pos in positions.items():
        try:
            price = fetch_current_price(ticker)
        except Exception:
            price = pos["avg_price"]
        live_value = pos["qty"] * (price if price > 0 else pos["avg_price"])
        pnl_pos = (
            (price - pos["avg_price"]) * pos["qty"] if pos["side"] == "long"
            else (pos["avg_price"] - price) * pos["qty"]
        )
        positions_with_prices[ticker] = {
            **pos,
            "current_price": price,
            "live_value": round(live_value, 2),
            "unrealized_pnl": round(pnl_pos, 2),
        }
        positions_value += live_value
    portfolio_value = cash + positions_value
    allocation = float(t["allocation"])
    pnl = portfolio_value - allocation
    pnl_pct = (pnl / allocation * 100) if allocation > 0 else 0.0
    all_trades = db.get_trader_trades(name, limit=10000)
    trade_pnls = [tr["pnl"] for tr in all_trades if tr.get("pnl")]
    winning = [p for p in trade_pnls if p > 0]
    return {
        **t,
        "portfolio_value": round(portfolio_value, 2),
        "positions_value": round(positions_value, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
        "is_running": name in _trader_agents and _trader_agents[name].running,
        "positions": positions_with_prices,
        "total_trades": len(all_trades),
        "winning_trades": len(winning),
        "win_rate": round(len(winning) / len(all_trades) * 100, 1) if all_trades else 0.0,
    }


@app.post("/api/traders/{name}/run-now")
async def run_trader_now(name: str):
    """Trigger an immediate cycle for a trader."""
    if name not in _trader_agents or not _trader_agents[name].running:
        raise HTTPException(400, f"Trader '{name}' is not running")
    asyncio.create_task(_trader_agents[name].run_cycle())
    return {"status": "cycle_triggered"}


@app.post("/api/traders/{name}/start")
async def start_trader(name: str):
    global _trader_agents, _trader_tasks

    if not db.get_setting("claude_api_key"):
        raise HTTPException(400, "Claude API key not configured in Settings")

    t = db.get_trader(name)
    if not t:
        raise HTTPException(404, f"Trader '{name}' not found")

    if name in _trader_agents and _trader_agents[name].running:
        return {"status": "already_running"}

    from trader_agent import TraderAgent as TA
    ta = TA(t, broadcast=broadcast)
    _trader_agents[name] = ta
    _trader_tasks[name] = asyncio.create_task(ta.run())
    logger.info(f"Trader {name} started via API")
    return {"status": "started"}


@app.post("/api/traders/{name}/stop")
async def stop_trader(name: str):
    global _trader_agents, _trader_tasks

    if name not in _trader_agents or not _trader_agents[name].running:
        return {"status": "not_running"}

    _trader_agents[name].stop()
    if name in _trader_tasks:
        _trader_tasks[name].cancel()
        try:
            await _trader_tasks[name]
        except (asyncio.CancelledError, Exception):
            pass
        del _trader_tasks[name]
    del _trader_agents[name]
    db.set_trader_active(name, False)
    logger.info(f"Trader {name} stopped via API")
    return {"status": "stopped"}


@app.post("/api/traders/{name}/reset")
async def reset_trader(name: str):
    if name in _trader_agents and _trader_agents[name].running:
        raise HTTPException(400, "Stop the trader before resetting")
    t = db.get_trader(name)
    if not t:
        raise HTTPException(404, f"Trader '{name}' not found")
    db.reset_trader(name)
    logger.info(f"Trader {name} reset via API")
    return {"status": "reset"}


@app.get("/api/traders/{name}/trades")
async def get_trader_trades(name: str, limit: int = 50):
    t = db.get_trader(name)
    if not t:
        raise HTTPException(404, f"Trader '{name}' not found")
    return {"trades": db.get_trader_trades(name, limit)}


@app.get("/api/traders/{name}/decisions")
async def get_trader_decisions(name: str, limit: int = 50):
    t = db.get_trader(name)
    if not t:
        raise HTTPException(404, f"Trader '{name}' not found")
    return {"decisions": db.get_trader_decisions(name, limit)}


# ══════════════════════════════════════════════════════════════════════════════
#  Debug
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/debug/data")
async def debug_data(ticker: str = "AAPL"):
    from data import fetch_ohlcv, fetch_current_price
    df = fetch_ohlcv(ticker, period="7d", interval="1h")
    price = fetch_current_price(ticker)
    return {
        "ticker": ticker,
        "candles": len(df),
        "current_price": price,
        "columns": list(df.columns) if not df.empty else [],
        "sample": df.tail(3).to_dict("records") if not df.empty else [],
    }


@app.get("/api/debug/analyse")
async def debug_analyse(ticker: str = "AAPL"):
    """Run a single full analysis cycle and return the result or error — for diagnosing why no decisions are logged."""
    import traceback
    import pandas as pd
    from data import fetch_ohlcv
    from indicators import calculate_all_indicators
    import anthropic

    steps = {}

    # Step 1: data fetch
    try:
        df = pd.DataFrame()
        for period in ("60d", "30d", "14d", "7d"):
            df = fetch_ohlcv(ticker, period=period, interval="1h")
            if not df.empty and len(df) >= 52:
                break
        steps["data"] = {"candles": len(df), "sufficient": len(df) >= 52}
        if df.empty or len(df) < 52:
            return {"ok": False, "failed_at": "data", "steps": steps}
    except Exception as e:
        return {"ok": False, "failed_at": "data", "error": str(e), "steps": steps}

    # Step 2: indicators
    try:
        ind = calculate_all_indicators(df)
        steps["indicators"] = {"rsi": ind.get("rsi"), "price": ind.get("current_price")}
    except Exception as e:
        return {"ok": False, "failed_at": "indicators", "error": str(e), "steps": steps}

    # Step 3: broker
    try:
        broker = _make_broker()
        account = broker.get_account()
        positions = broker.get_positions()
        steps["broker"] = {"connected": broker.is_connected(), "portfolio_value": account.get("portfolio_value")}
    except Exception as e:
        return {"ok": False, "failed_at": "broker", "error": str(e), "steps": steps}

    # Step 4: Claude API
    try:
        claude_key = db.get_setting("claude_api_key")
        if not claude_key:
            return {"ok": False, "failed_at": "claude_key", "error": "claude_api_key not set", "steps": steps}
        client = anthropic.Anthropic(api_key=claude_key)
        steps["claude_key"] = "set (last 4: " + claude_key[-4:] + ")"

        # Build a minimal prompt
        agent_tmp = TradingAgent(broker=broker, broadcast=None)
        position = broker.get_position(ticker)
        prompt = agent_tmp._build_prompt(ticker, ind, position, account, positions)

        resp = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        steps["claude_raw"] = raw[:500]
    except Exception as e:
        return {"ok": False, "failed_at": "claude_api", "error": str(e), "traceback": traceback.format_exc()[-1000:], "steps": steps}

    # Step 5: JSON parse
    try:
        import json as _json
        for fence in ("```json", "```"):
            if fence in raw:
                raw = raw.split(fence)[-1].split("```")[0].strip()
                break
        decision = _json.loads(raw)
        steps["decision"] = decision
    except Exception as e:
        return {"ok": False, "failed_at": "json_parse", "error": str(e), "raw": raw[:500], "steps": steps}

    return {"ok": True, "steps": steps, "decision": decision}


# ══════════════════════════════════════════════════════════════════════════════
#  Run
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
