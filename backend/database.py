import sqlite3
import json
import os
import numpy as np
from datetime import datetime
from threading import Lock

# On Railway, mount a volume at /data and set DB_PATH=/data/winbot.db
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "winbot.db"))

# Ensure the parent directory exists (important for Railway volume mounts)
_db_dir = os.path.dirname(DB_PATH)
if _db_dir:
    os.makedirs(_db_dir, exist_ok=True)

# Env vars take priority over DB-stored settings (safe for cloud deployments)
_ENV_MAP = {
    "alpaca_paper_key":    "ALPACA_PAPER_KEY",
    "alpaca_paper_secret": "ALPACA_PAPER_SECRET",
    "alpaca_live_key":     "ALPACA_LIVE_KEY",
    "alpaca_live_secret":  "ALPACA_LIVE_SECRET",
    "claude_api_key":      "CLAUDE_API_KEY",
    "trading_mode":        "TRADING_MODE",
    "trading_interval":    "TRADING_INTERVAL",
}
_lock = Lock()


def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _lock:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.executescript("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                action TEXT NOT NULL,
                quantity REAL NOT NULL,
                price REAL NOT NULL,
                total_value REAL NOT NULL,
                timestamp TEXT NOT NULL,
                order_id TEXT,
                status TEXT DEFAULT 'filled',
                pnl REAL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                action TEXT NOT NULL,
                confidence REAL NOT NULL,
                sizing TEXT NOT NULL,
                reasoning TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                executed INTEGER DEFAULT 0,
                blocked_reason TEXT,
                rsi REAL,
                macd REAL,
                ema20 REAL,
                ema50 REAL,
                current_price REAL
            );

            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                total_value REAL NOT NULL,
                cash REAL NOT NULL,
                positions_value REAL NOT NULL,
                daily_pnl REAL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)

        defaults = {
            "alpaca_paper_key": "",
            "alpaca_paper_secret": "",
            "alpaca_live_key": "",
            "alpaca_live_secret": "",
            "claude_api_key": "",
            "trading_mode": "paper",
            "trading_interval": "5",
            "crypto_interval": "1",
            "stop_loss_pct": "2.0",
            "max_position_size_pct": "10.0",
            "max_open_trades": "5",
            "daily_loss_limit_pct": "5.0",
            "min_confidence": "0.7",
            "watchlist": '["BTC/USD", "ETH/USD", "AAPL", "TSLA", "NVDA"]',
        }
        for key, value in defaults.items():
            cursor.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

        # Trader tables
        cursor.executescript("""
            CREATE TABLE IF NOT EXISTS traders (
                name TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                personality TEXT NOT NULL,
                style TEXT NOT NULL,
                color TEXT NOT NULL,
                confidence_threshold REAL NOT NULL,
                max_position_size_pct REAL NOT NULL,
                stop_loss_pct REAL NOT NULL,
                daily_loss_limit_pct REAL NOT NULL,
                trading_interval INTEGER NOT NULL,
                allocation REAL NOT NULL DEFAULT 10000.0,
                cash REAL NOT NULL DEFAULT 10000.0,
                active INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS trader_positions (
                trader_name TEXT NOT NULL,
                ticker TEXT NOT NULL,
                qty REAL NOT NULL,
                avg_price REAL NOT NULL,
                side TEXT NOT NULL DEFAULT 'long',
                opened_at TEXT NOT NULL,
                PRIMARY KEY (trader_name, ticker)
            );
            CREATE TABLE IF NOT EXISTS trader_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trader_name TEXT NOT NULL,
                ticker TEXT NOT NULL,
                action TEXT NOT NULL,
                quantity REAL NOT NULL,
                price REAL NOT NULL,
                total_value REAL NOT NULL,
                timestamp TEXT NOT NULL,
                pnl REAL DEFAULT 0.0
            );
            CREATE TABLE IF NOT EXISTS trader_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trader_name TEXT NOT NULL,
                ticker TEXT NOT NULL,
                action TEXT NOT NULL,
                confidence REAL NOT NULL,
                sizing TEXT NOT NULL,
                reasoning TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                executed INTEGER DEFAULT 0,
                blocked_reason TEXT,
                rsi REAL,
                macd REAL,
                ema20 REAL,
                ema50 REAL,
                current_price REAL
            );
        """)

        # Migration: add follow_mode if not present
        try:
            cursor.execute("ALTER TABLE traders ADD COLUMN follow_mode TEXT DEFAULT 'off'")
        except Exception:
            pass

        _now = datetime.utcnow().isoformat()
        _traders = [
            ("luke",     "Luke",     "🔥", "most aggressive", "Scalper",  "red",    0.50, 15.0, 3.0,  15.0, 5),
            ("aiden",    "Aiden",    "⚡", "aggressive",      "Momentum", "orange", 0.58, 12.0, 2.5,  10.0, 5),
            ("mitchell", "Mitchell", "⚖️", "balanced",        "Swing",    "blue",   0.65, 10.0, 2.0,   5.0, 10),
            ("michaela", "Michaela", "🛡️", "conservative",    "Position", "green",  0.75,  7.0, 1.5,   3.0, 10),
            ("billy",    "Billy",    "🧊", "most conservative","Value",   "slate",  0.85,  5.0, 1.0,   2.0, 15),
        ]
        for (name, display_name, emoji, personality, style, color,
             conf, pos_pct, sl_pct, dl_pct, interval) in _traders:
            cursor.execute(
                """INSERT OR IGNORE INTO traders
                   (name, display_name, emoji, personality, style, color,
                    confidence_threshold, max_position_size_pct, stop_loss_pct,
                    daily_loss_limit_pct, trading_interval,
                    allocation, cash, active, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10000.0, 10000.0, 0, ?)""",
                (name, display_name, emoji, personality, style, color,
                 conf, pos_pct, sl_pct, dl_pct, interval, _now),
            )

        conn.commit()
        conn.close()


def get_setting(key: str) -> str:
    # Environment variables always win (Railway / production)
    env_key = _ENV_MAP.get(key)
    if env_key:
        env_val = os.environ.get(env_key)
        if env_val:
            return env_val
    with _lock:
        conn = get_connection()
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        conn.close()
        return row["value"] if row else None


def set_setting(key: str, value: str):
    with _lock:
        conn = get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value)
        )
        conn.commit()
        conn.close()


def get_all_settings() -> dict:
    with _lock:
        conn = get_connection()
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        conn.close()
        return {r["key"]: r["value"] for r in rows}


def log_trade(ticker, action, quantity, price, order_id=None, status="filled", pnl=0.0):
    with _lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO trades (ticker, action, quantity, price, total_value,
               timestamp, order_id, status, pnl)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticker, action, quantity, price, quantity * price,
             datetime.utcnow().isoformat(), order_id, status, pnl),
        )
        conn.commit()
        conn.close()


def log_decision(ticker, action, confidence, sizing, reasoning, executed=False,
                 blocked_reason=None, rsi=None, macd=None, ema20=None, ema50=None,
                 current_price=None):
    with _lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO decisions (ticker, action, confidence, sizing, reasoning,
               timestamp, executed, blocked_reason, rsi, macd, ema20, ema50, current_price)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticker, action, confidence, sizing, reasoning,
             datetime.utcnow().isoformat(), 1 if executed else 0, blocked_reason,
             rsi, macd, ema20, ema50, current_price),
        )
        conn.commit()
        conn.close()


def log_portfolio_snapshot(total_value, cash, positions_value, daily_pnl=0.0):
    with _lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO portfolio_snapshots (timestamp, total_value, cash,
               positions_value, daily_pnl) VALUES (?, ?, ?, ?, ?)""",
            (datetime.utcnow().isoformat(), total_value, cash, positions_value, daily_pnl),
        )
        conn.commit()
        conn.close()


def get_trades(limit=50) -> list:
    with _lock:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]


def get_decisions(limit=50) -> list:
    with _lock:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]


def get_portfolio_history(limit=200) -> list:
    with _lock:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM portfolio_snapshots ORDER BY timestamp ASC LIMIT ?", (limit,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]


def get_performance_stats() -> dict:
    with _lock:
        conn = get_connection()
        trades = [dict(r) for r in conn.execute(
            "SELECT * FROM trades WHERE status = 'filled'"
        ).fetchall()]

        first_snap = conn.execute(
            "SELECT total_value FROM portfolio_snapshots ORDER BY timestamp ASC LIMIT 1"
        ).fetchone()
        last_snap = conn.execute(
            "SELECT total_value FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()
        conn.close()

    if not trades:
        return {
            "total_trades": 0, "winning_trades": 0, "losing_trades": 0,
            "win_rate": 0.0, "total_pnl": 0.0, "total_return_pct": 0.0,
            "sharpe_ratio": 0.0, "best_trade": 0.0, "worst_trade": 0.0,
        }

    pnls = [t["pnl"] for t in trades if t["pnl"] != 0]
    winning = [p for p in pnls if p > 0]
    losing = [p for p in pnls if p < 0]
    total_pnl = sum(pnls) if pnls else 0.0
    win_rate = len(winning) / len(pnls) * 100 if pnls else 0.0

    sharpe = 0.0
    if len(pnls) > 1:
        arr = np.array(pnls)
        std = np.std(arr)
        if std != 0:
            sharpe = float(np.mean(arr) / std * np.sqrt(252))

    total_return_pct = 0.0
    if first_snap and last_snap:
        fv = first_snap["total_value"]
        lv = last_snap["total_value"]
        if fv > 0:
            total_return_pct = (lv - fv) / fv * 100

    return {
        "total_trades": len(trades),
        "winning_trades": len(winning),
        "losing_trades": len(losing),
        "win_rate": round(win_rate, 2),
        "total_pnl": round(total_pnl, 2),
        "total_return_pct": round(total_return_pct, 2),
        "sharpe_ratio": round(sharpe, 3),
        "best_trade": round(max(pnls), 2) if pnls else 0.0,
        "worst_trade": round(min(pnls), 2) if pnls else 0.0,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Trader functions
# ══════════════════════════════════════════════════════════════════════════════

def get_traders() -> list:
    with _lock:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM traders ORDER BY name").fetchall()
        traders = []
        for r in rows:
            t = dict(r)
            # Trade count and win rate
            trades_rows = conn.execute(
                "SELECT pnl FROM trader_trades WHERE trader_name = ?", (t["name"],)
            ).fetchall()
            pnls = [tr["pnl"] for tr in trades_rows]
            winning = [p for p in pnls if p > 0]
            losing  = [p for p in pnls if p < 0]
            t["total_trades"]   = len(pnls)
            t["winning_trades"] = len(winning)
            t["losing_trades"]  = len(losing)
            t["win_rate"]       = round(len(winning) / len(pnls) * 100, 1) if pnls else 0.0
            t["total_pnl"]      = round(sum(pnls), 2) if pnls else 0.0
            traders.append(t)
        conn.close()
        return traders


def get_trader(name: str) -> dict | None:
    with _lock:
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM traders WHERE name = ?", (name,)
        ).fetchone()
        conn.close()
        return dict(row) if row else None


def get_trader_positions(name: str) -> dict:
    """Returns {ticker: {qty, avg_price, side, opened_at}}"""
    with _lock:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM trader_positions WHERE trader_name = ?", (name,)
        ).fetchall()
        conn.close()
        return {
            r["ticker"]: {
                "qty": r["qty"],
                "avg_price": r["avg_price"],
                "side": r["side"],
                "opened_at": r["opened_at"],
            }
            for r in rows
        }


def get_trader_cash(name: str) -> float:
    with _lock:
        conn = get_connection()
        row = conn.execute(
            "SELECT cash FROM traders WHERE name = ?", (name,)
        ).fetchone()
        conn.close()
        return float(row["cash"]) if row else 0.0


def trader_virtual_buy(name: str, ticker: str, qty: float, price: float):
    cost = qty * price
    now = datetime.utcnow().isoformat()
    with _lock:
        conn = get_connection()
        conn.execute(
            "UPDATE traders SET cash = cash - ? WHERE name = ?", (cost, name)
        )
        # Upsert position (average in if adding to existing long)
        existing = conn.execute(
            "SELECT qty, avg_price FROM trader_positions WHERE trader_name = ? AND ticker = ?",
            (name, ticker),
        ).fetchone()
        if existing:
            old_qty = existing["qty"]
            old_avg = existing["avg_price"]
            new_qty = old_qty + qty
            new_avg = (old_avg * old_qty + price * qty) / new_qty
            conn.execute(
                "UPDATE trader_positions SET qty = ?, avg_price = ? "
                "WHERE trader_name = ? AND ticker = ?",
                (new_qty, new_avg, name, ticker),
            )
        else:
            conn.execute(
                "INSERT INTO trader_positions (trader_name, ticker, qty, avg_price, side, opened_at) "
                "VALUES (?, ?, ?, ?, 'long', ?)",
                (name, ticker, qty, price, now),
            )
        conn.execute(
            "INSERT INTO trader_trades (trader_name, ticker, action, quantity, price, total_value, timestamp, pnl) "
            "VALUES (?, ?, 'BUY', ?, ?, ?, ?, 0.0)",
            (name, ticker, qty, price, cost, now),
        )
        conn.commit()
        conn.close()


def trader_virtual_sell(name: str, ticker: str, qty: float, price: float, pnl: float):
    proceeds = qty * price
    now = datetime.utcnow().isoformat()
    with _lock:
        conn = get_connection()
        conn.execute(
            "UPDATE traders SET cash = cash + ? WHERE name = ?", (proceeds, name)
        )
        existing = conn.execute(
            "SELECT qty FROM trader_positions WHERE trader_name = ? AND ticker = ?",
            (name, ticker),
        ).fetchone()
        if existing:
            remaining = existing["qty"] - qty
            if remaining <= 0.0001:
                conn.execute(
                    "DELETE FROM trader_positions WHERE trader_name = ? AND ticker = ?",
                    (name, ticker),
                )
            else:
                conn.execute(
                    "UPDATE trader_positions SET qty = ? WHERE trader_name = ? AND ticker = ?",
                    (remaining, name, ticker),
                )
        conn.execute(
            "INSERT INTO trader_trades (trader_name, ticker, action, quantity, price, total_value, timestamp, pnl) "
            "VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)",
            (name, ticker, qty, price, proceeds, now, pnl),
        )
        conn.commit()
        conn.close()


def trader_virtual_short(name: str, ticker: str, qty: float, price: float):
    """Sell borrowed shares: add proceeds to cash, insert short position."""
    proceeds = qty * price
    now = datetime.utcnow().isoformat()
    with _lock:
        conn = get_connection()
        conn.execute(
            "UPDATE traders SET cash = cash + ? WHERE name = ?", (proceeds, name)
        )
        conn.execute(
            "INSERT OR REPLACE INTO trader_positions "
            "(trader_name, ticker, qty, avg_price, side, opened_at) "
            "VALUES (?, ?, ?, ?, 'short', ?)",
            (name, ticker, qty, price, now),
        )
        conn.execute(
            "INSERT INTO trader_trades (trader_name, ticker, action, quantity, price, total_value, timestamp, pnl) "
            "VALUES (?, ?, 'SHORT', ?, ?, ?, ?, 0.0)",
            (name, ticker, qty, price, proceeds, now),
        )
        conn.commit()
        conn.close()


def trader_virtual_cover(name: str, ticker: str, qty: float, price: float, pnl: float):
    """Buy back shorted shares: deduct buyback cost from cash, close position, record pnl.
    On short open we added proceeds to cash; on cover we subtract the buyback cost.
    The net effect is pnl = (entry_price - cover_price) * qty already computed by caller.
    We adjust cash by pnl (simpler and equivalent when proceeds were already added).
    """
    cost = qty * price
    now = datetime.utcnow().isoformat()
    with _lock:
        conn = get_connection()
        # We already have the short proceeds in cash from the SHORT operation.
        # Subtract the buyback cost — the net effect on cash is pnl.
        conn.execute(
            "UPDATE traders SET cash = cash - ? WHERE name = ?",
            (cost, name),
        )
        conn.execute(
            "DELETE FROM trader_positions WHERE trader_name = ? AND ticker = ?",
            (name, ticker),
        )
        conn.execute(
            "INSERT INTO trader_trades (trader_name, ticker, action, quantity, price, total_value, timestamp, pnl) "
            "VALUES (?, ?, 'COVER', ?, ?, ?, ?, ?)",
            (name, ticker, qty, price, cost, now, pnl),
        )
        conn.commit()
        conn.close()


def log_trader_decision(trader_name: str, ticker: str, action: str, confidence: float,
                        sizing: str, reasoning: str, executed: bool = False,
                        blocked_reason: str = None, rsi: float = None,
                        macd: float = None, ema20: float = None, ema50: float = None,
                        current_price: float = None):
    with _lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO trader_decisions
               (trader_name, ticker, action, confidence, sizing, reasoning,
                timestamp, executed, blocked_reason, rsi, macd, ema20, ema50, current_price)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (trader_name, ticker, action, confidence, sizing, reasoning,
             datetime.utcnow().isoformat(), 1 if executed else 0,
             blocked_reason, rsi, macd, ema20, ema50, current_price),
        )
        conn.commit()
        conn.close()


def get_trader_trades(name: str, limit: int = 50) -> list:
    with _lock:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM trader_trades WHERE trader_name = ? ORDER BY timestamp DESC LIMIT ?",
            (name, limit),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]


def get_trader_decisions(name: str, limit: int = 50) -> list:
    with _lock:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM trader_decisions WHERE trader_name = ? ORDER BY timestamp DESC LIMIT ?",
            (name, limit),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]


def get_trader_daily_pnl(name: str) -> float:
    today = datetime.utcnow().date().isoformat()
    with _lock:
        conn = get_connection()
        row = conn.execute(
            "SELECT COALESCE(SUM(pnl), 0.0) AS total FROM trader_trades "
            "WHERE trader_name = ? AND timestamp >= ?",
            (name, today),
        ).fetchone()
        conn.close()
        return float(row["total"]) if row else 0.0


def reset_trader(name: str):
    with _lock:
        conn = get_connection()
        alloc_row = conn.execute(
            "SELECT allocation FROM traders WHERE name = ?", (name,)
        ).fetchone()
        alloc = float(alloc_row["allocation"]) if alloc_row else 10000.0
        conn.execute(
            "UPDATE traders SET cash = ?, active = 0 WHERE name = ?", (alloc, name)
        )
        conn.execute(
            "DELETE FROM trader_positions WHERE trader_name = ?", (name,)
        )
        conn.execute(
            "DELETE FROM trader_trades WHERE trader_name = ?", (name,)
        )
        conn.execute(
            "DELETE FROM trader_decisions WHERE trader_name = ?", (name,)
        )
        conn.commit()
        conn.close()


def set_trader_follow(name: str, mode: str):
    """mode: 'off' | 'paper' | 'live'"""
    with _lock:
        conn = get_connection()
        try:
            conn.execute("ALTER TABLE traders ADD COLUMN follow_mode TEXT DEFAULT 'off'")
        except Exception:
            pass  # column already exists
        conn.execute(
            "UPDATE traders SET follow_mode = ? WHERE name = ?",
            (mode, name),
        )
        conn.commit()
        conn.close()


def set_trader_active(name: str, active: bool):
    with _lock:
        conn = get_connection()
        conn.execute(
            "UPDATE traders SET active = ? WHERE name = ?",
            (1 if active else 0, name),
        )
        conn.commit()
        conn.close()
