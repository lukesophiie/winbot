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
    db.init_db()
    logger.info("WinBot backend ready")
    yield
    if _agent:
        _agent.stop()
    logger.info("WinBot backend shutdown")


app = FastAPI(title="WinBot API", version="1.0.0", lifespan=lifespan)

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
    return {
        "running": _agent_running,
        "mode": db.get_setting("trading_mode"),
        "interval": db.get_setting("trading_interval"),
        "broker_connected": broker.is_connected(),
        "last_error": _agent.last_error if _agent else None,
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

    logger.info("Agent stopped via API")
    return {"status": "stopped"}


# ══════════════════════════════════════════════════════════════════════════════
#  Performance
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/performance")
async def get_performance():
    return {"stats": db.get_performance_stats()}


# ══════════════════════════════════════════════════════════════════════════════
#  Run
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
