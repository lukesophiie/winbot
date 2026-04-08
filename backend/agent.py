import asyncio
import json
import logging
from datetime import datetime
from typing import Callable, Optional

import anthropic
import pandas as pd

import database as db
from data import fetch_ohlcv
from indicators import calculate_all_indicators
from risk import RiskManager

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-5"


class TradingAgent:
    def __init__(self, broker, broadcast: Optional[Callable] = None):
        self.broker = broker
        self._broadcast = broadcast
        self.risk = RiskManager()
        self.running = False
        self.last_error: Optional[str] = None
        self._stock_cycle = 0   # used to run stocks less frequently than crypto

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _emit(self, msg: dict):
        if self._broadcast:
            await self._broadcast(msg)

    def _claude(self):
        key = db.get_setting("claude_api_key")
        if not key:
            raise ValueError("Claude API key not configured")
        return anthropic.Anthropic(api_key=key)

    # ── Prompt construction ───────────────────────────────────────────────────

    def _build_prompt(self, ticker: str, ind: dict, position: Optional[dict],
                      account: dict, positions: list) -> str:
        pv = account.get("portfolio_value", 0)
        max_trades = int(db.get_setting("max_open_trades") or 5)
        exposure_pct = (len(positions) / max(max_trades, 1)) * 100

        is_crypto = "/" in ticker
        if position:
            side_label = position['side'].upper()  # LONG or SHORT
            pos_info = (
                f"OPEN {side_label} position: "
                f"{position['quantity']:.4f} units @ avg ${position['avg_entry_price']:.4f} | "
                f"Unrealised P&L: ${position['unrealized_pl']:.2f} "
                f"({position['unrealized_plpc']:.2f}%)"
            )
        else:
            pos_info = "No current position in this ticker."

        pa = ind.get("price_action", [])
        pa_lines = "\n".join(
            f"  [{i+1}] O={c['open']} H={c['high']} L={c['low']} C={c['close']} V={c['volume']:,}"
            for i, c in enumerate(pa)
        )

        no_short_note = " (crypto cannot be shorted on Alpaca)" if is_crypto else ""
        return f"""You are WinBot, an algorithmic trading AI. Analyse the data below and return a trade decision.

═══ MARKET SNAPSHOT ═══
Ticker        : {ticker}
Timestamp     : {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
Current Price : ${ind['current_price']:.4f}
1h Change     : {ind.get('pct_change_1h', 0):+.2f}%
24h Change    : {ind.get('pct_change_24h', 0):+.2f}%

═══ TECHNICAL INDICATORS ═══
RSI (14)      : {ind['rsi']:.2f}  [<30 oversold | >70 overbought]
MACD Histogram: {ind['macd']['histogram']:+.4f}
MACD Line     : {ind['macd']['macd']:+.4f}
Signal Line   : {ind['macd']['signal']:+.4f}
EMA 20        : ${ind['ema20']:.4f}
EMA 50        : ${ind['ema50']:.4f}
Volume Ratio  : {ind['volume_ratio']:.2f}x (vs 20-period avg)

═══ RECENT PRICE ACTION (last 5 candles, 1h) ═══
{pa_lines}

═══ POSITION STATUS ═══
{pos_info}

═══ PORTFOLIO CONTEXT ═══
Portfolio Value : ${pv:,.2f}
Open Positions  : {len(positions)}/{max_trades}
Portfolio Exp.  : {exposure_pct:.1f}%
Daily P&L       : ${account.get('pnl', 0):+.2f} ({account.get('pnl_pct', 0):+.2f}%)

═══ RISK PARAMETERS ═══
Stop-Loss       : {db.get_setting('stop_loss_pct')}%
Max Position    : {db.get_setting('max_position_size_pct')}% of portfolio
Min Confidence  : {db.get_setting('min_confidence')}

═══ TRADING RULES ═══
- RSI < 30 → oversold → BUY or COVER signal
- RSI > 70 → overbought → SELL or SHORT signal
- Price above both EMAs = bullish bias; below both EMAs = bearish bias
- MACD histogram crossing zero from below = bullish; from above = bearish
- High volume (ratio > 1.5) confirms trend strength

═══ VALID ACTIONS BASED ON POSITION ═══
- BUY   : Enter LONG — only valid when you have NO position or a SHORT position to close
- SELL  : Exit LONG  — only valid when you hold a LONG position
- SHORT : Enter SHORT (profit when price falls) — only valid when NO position exists AND this is NOT crypto{no_short_note}
- COVER : Exit SHORT — only valid when you hold a SHORT position
- HOLD  : Do nothing — use when signals are mixed, weak, or no valid action applies

Return ONLY a JSON object — no markdown, no explanation outside the JSON:
{{"action": "BUY|SELL|SHORT|COVER|HOLD", "confidence": 0.0-1.0, "sizing": "small|medium|large", "reasoning": "2-3 sentences citing specific indicator values and why this direction"}}

confidence: your probability estimate this trade is profitable (0.0–1.0). Must be ≥ 0.70 to execute.
sizing    : small=25%, medium=50%, large=100% of max position size — scale up for stronger signals"""

    # ── Crypto scalping prompt ────────────────────────────────────────────────

    def _build_scalping_prompt(self, ticker: str, ind: dict, position: Optional[dict],
                               account: dict, positions: list) -> str:
        pv = account.get("portfolio_value", 0)
        max_trades = int(db.get_setting("max_open_trades") or 5)

        if position:
            side_label = position['side'].upper()
            pos_info = (
                f"OPEN {side_label} position: "
                f"{position['quantity']:.4f} units @ avg ${position['avg_entry_price']:.4f} | "
                f"Unrealised P&L: ${position['unrealized_pl']:.2f} "
                f"({position['unrealized_plpc']:.2f}%)"
            )
        else:
            pos_info = "No current position."

        pa = ind.get("price_action", [])
        pa_lines = "\n".join(
            f"  [{i+1}] O={c['open']} H={c['high']} L={c['low']} C={c['close']} V={c['volume']:,}"
            for i, c in enumerate(pa)
        )

        return f"""You are WinBot, a high-frequency crypto scalping AI. Your goal is to capture small, rapid price moves.

═══ CRYPTO SCALP SNAPSHOT (5-min candles) ═══
Ticker        : {ticker}
Timestamp     : {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
Current Price : ${ind['current_price']:.4f}
1h Change     : {ind.get('pct_change_1h', 0):+.2f}%

═══ INDICATORS ═══
RSI (14)      : {ind['rsi']:.2f}  [<35 oversold | >65 overbought for scalping]
MACD Histogram: {ind['macd']['histogram']:+.6f}  [positive=bullish momentum]
MACD Line     : {ind['macd']['macd']:+.6f}
Signal Line   : {ind['macd']['signal']:+.6f}
EMA 20        : ${ind['ema20']:.4f}
EMA 50        : ${ind['ema50']:.4f}
Volume Ratio  : {ind['volume_ratio']:.2f}x  [>1.2 = elevated, confirms move]

═══ RECENT 5-MIN PRICE ACTION (last 10 candles) ═══
{pa_lines}

═══ POSITION STATUS ═══
{pos_info}

═══ PORTFOLIO CONTEXT ═══
Portfolio Value : ${pv:,.2f}
Open Positions  : {len(positions)}/{max_trades}

═══ SCALPING RULES — BE DECISIVE ═══
Crypto trades 24/7. You should find a reason to act in most cycles.

IF NO POSITION:
- BUY if MACD histogram is positive, OR RSI < 45, OR price >= EMA20 with volume >= 1.0x
- HOLD only if MACD is negative AND RSI is between 50-65 AND price is clearly falling

IF LONG POSITION:
- SELL if MACD histogram turned negative, OR RSI > 55, OR price dropped below EMA20
- SELL to lock in any gain — do not wait for perfect overbought conditions
- HOLD only if all indicators still strongly bullish

Confidence 0.60 is enough to act. Do NOT be paralysed by uncertainty.
HOLD should be rare — only when signals are truly flat in all directions.

═══ VALID ACTIONS ═══
BUY: Enter long | SELL: Exit long | HOLD: No signal at all

Return ONLY JSON: {{"action":"BUY|SELL|HOLD","confidence":0.0-1.0,"sizing":"small|medium|large","reasoning":"1 sentence"}}
sizing: small=25%, medium=50%, large=100% of max position"""

    # ── Analysis ──────────────────────────────────────────────────────────────

    async def analyse(self, ticker: str, scalping: bool = False) -> Optional[dict]:
        logger.info(f"[agent] Analysing {ticker} {'(scalp)' if scalping else ''}…")
        try:
            if scalping:
                # 5-minute candles for crypto — only need last 2 days
                df = pd.DataFrame()
                for period in ("2d", "1d"):
                    df = fetch_ohlcv(ticker, period=period, interval="5m")
                    if not df.empty and len(df) >= 26:
                        break
                min_candles = 26
            else:
                df = pd.DataFrame()
                for period in ("60d", "30d", "14d", "7d"):
                    df = fetch_ohlcv(ticker, period=period, interval="1h")
                    if not df.empty and len(df) >= 52:
                        break
                min_candles = 52

            if df.empty or len(df) < min_candles:
                logger.warning(f"[agent] Insufficient data for {ticker} ({len(df)} candles) — skipping")
                return None

            ind = calculate_all_indicators(df)
            account = self.broker.get_account()
            positions = self.broker.get_positions()
            position = self.broker.get_position(ticker)

            if scalping:
                prompt = self._build_scalping_prompt(ticker, ind, position, account, positions)
            else:
                prompt = self._build_prompt(ticker, ind, position, account, positions)
            client = self._claude()

            resp = client.messages.create(
                model=MODEL,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()

            # Strip markdown code fences if present
            for fence in ("```json", "```"):
                if fence in raw:
                    raw = raw.split(fence)[-1].split("```")[0].strip()
                    break

            decision = json.loads(raw)
            for field in ("action", "confidence", "sizing", "reasoning"):
                if field not in decision:
                    raise ValueError(f"Missing field: {field}")

            decision["ticker"] = ticker
            decision["timestamp"] = datetime.utcnow().isoformat()
            logger.info(
                f"[agent] {ticker}: {decision['action']} "
                f"(conf={decision['confidence']:.2f})"
            )
            return {
                "decision": decision,
                "indicators": ind,
                "account": account,
                "positions": positions,
                "position": position,
            }

        except json.JSONDecodeError as e:
            logger.error(f"[agent] JSON parse error for {ticker}: {e}")
        except Exception as e:
            logger.error(f"[agent] Analysis error for {ticker}: {e}")
        return None

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute(self, ticker: str, analysis: dict) -> bool:
        d = analysis["decision"]
        ind = analysis["indicators"]
        account = analysis["account"]
        positions = analysis["positions"]
        position = analysis["position"]

        action = d["action"].upper()
        confidence = float(d["confidence"])
        sizing = d.get("sizing", "medium")
        reasoning = d["reasoning"]

        allowed, reason = self.risk.check(ticker, action, confidence, positions, account)
        executed = allowed and action != "HOLD"

        db.log_decision(
            ticker=ticker, action=action, confidence=confidence,
            sizing=sizing, reasoning=reasoning, executed=executed,
            blocked_reason=None if allowed else reason,
            rsi=ind.get("rsi"), macd=ind["macd"]["histogram"],
            ema20=ind.get("ema20"), ema50=ind.get("ema50"),
            current_price=ind.get("current_price"),
        )

        await self._emit({
            "type": "reasoning",
            "data": {
                "ticker": ticker, "action": action,
                "confidence": confidence, "sizing": sizing,
                "reasoning": reasoning, "executed": executed,
                "blocked_reason": None if allowed else reason,
                "timestamp": datetime.utcnow().isoformat(),
                "indicators": {
                    "rsi": ind.get("rsi"),
                    "macd_hist": ind["macd"]["histogram"],
                    "ema20": ind.get("ema20"),
                    "ema50": ind.get("ema50"),
                    "price": ind.get("current_price"),
                },
            },
        })

        if not allowed:
            logger.info(f"[agent] {ticker} blocked: {reason}")
            return False
        if action == "HOLD":
            return False

        price = ind["current_price"]
        pv = account.get("portfolio_value", 100_000)
        size_pct = self.risk.size_pct(sizing)
        qty = self.broker.calculate_quantity(ticker, price, pv, size_pct)

        if qty <= 0:
            logger.error(f"[agent] Zero quantity for {ticker}")
            return False

        if action == "SELL" and position:
            qty = abs(position["quantity"])   # sell entire long position
        elif action == "COVER" and position:
            qty = abs(position["quantity"])   # buy back entire short position
        elif action == "SHORT":
            pass                              # sell qty shares short (no existing position)

        order_side = "buy" if action in ("BUY", "LONG", "COVER") else "sell"
        order = self.broker.place_market_order(ticker, order_side, qty)

        if order:
            fill_price = order.get("filled_avg_price") or price
            db.log_trade(
                ticker=ticker, action=action, quantity=qty,
                price=fill_price, order_id=order.get("order_id"),
                status="filled",
            )
            await self._emit({
                "type": "trade_executed",
                "data": {
                    "ticker": ticker, "action": action, "quantity": qty,
                    "price": fill_price, "order_id": order.get("order_id"),
                    "reasoning": reasoning,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            })
            return True

        return False

    # ── Stop-loss sweep ───────────────────────────────────────────────────────

    async def check_stop_losses(self):
        for pos in self.broker.get_positions():
            hit, reason = self.risk.should_stop_loss(pos)
            if not hit:
                continue
            ticker = pos["ticker"]
            logger.warning(f"[agent] Stop-loss: {ticker} — {reason}")
            order = self.broker.close_position(ticker)
            if order:
                db.log_trade(
                    ticker=ticker, action="SELL_SL",
                    quantity=pos["quantity"], price=pos["current_price"],
                    order_id=order.get("order_id"), status="filled",
                    pnl=pos["unrealized_pl"],
                )
                await self._emit({
                    "type": "stop_loss",
                    "data": {
                        "ticker": ticker, "reason": reason,
                        "price": pos["current_price"], "pnl": pos["unrealized_pl"],
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                })

    # ── Main loop ─────────────────────────────────────────────────────────────

    async def run_cycle(self):
        watchlist_raw = db.get_setting("watchlist") or '[]'
        try:
            watchlist = json.loads(watchlist_raw)
        except Exception:
            watchlist = []

        if not watchlist:
            logger.info("[agent] Watchlist empty — skipping cycle")
            return

        crypto  = [t for t in watchlist if "/" in t]
        stocks  = [t for t in watchlist if "/" not in t]

        await self.check_stop_losses()

        # ── Crypto: scalp every cycle ─────────────────────────────────────────
        if crypto:
            logger.info(f"[agent] Crypto scalp cycle ({len(crypto)} tickers)")
            for ticker in crypto:
                if not self.running:
                    return
                analysis = await self.analyse(ticker, scalping=True)
                if analysis:
                    await self.execute(ticker, analysis)
                await asyncio.sleep(1)

        # ── Stocks: analyse every 5th cycle to avoid API overuse ─────────────
        if stocks:
            self._stock_cycle += 1
            stock_skip = 5
            if self._stock_cycle >= stock_skip:
                self._stock_cycle = 0
                logger.info(f"[agent] Stock cycle ({len(stocks)} tickers)")
                for ticker in stocks:
                    if not self.running:
                        return
                    analysis = await self.analyse(ticker)
                    if analysis:
                        await self.execute(ticker, analysis)
                    await asyncio.sleep(2)

        # Portfolio snapshot
        account = self.broker.get_account()
        if account:
            positions_val = account.get("portfolio_value", 0) - account.get("cash", 0)
            db.log_portfolio_snapshot(
                total_value=account["portfolio_value"],
                cash=account["cash"],
                positions_value=positions_val,
                daily_pnl=account.get("pnl", 0),
            )
            await self._emit({
                "type": "portfolio_update",
                "data": {
                    "account": account,
                    "positions": self.broker.get_positions(),
                    "timestamp": datetime.utcnow().isoformat(),
                },
            })

    async def run(self):
        self.running = True
        logger.info("[agent] Agent started")
        await self._emit({"type": "agent_status", "data": {"status": "running",
                          "timestamp": datetime.utcnow().isoformat()}})
        while self.running:
            try:
                # Use crypto_interval (default 1 min) as the base loop speed
                interval = int(db.get_setting("crypto_interval") or 1)
                await self.run_cycle()
                logger.info(f"[agent] Cycle done. Sleeping {interval}m …")
                for _ in range(interval * 6):
                    if not self.running:
                        break
                    await asyncio.sleep(10)
            except Exception as e:
                self.last_error = str(e)
                logger.error(f"[agent] Cycle error: {e}")
                await asyncio.sleep(30)

        logger.info("[agent] Agent stopped")
        await self._emit({"type": "agent_status", "data": {"status": "stopped",
                          "timestamp": datetime.utcnow().isoformat()}})

    def stop(self):
        self.running = False
