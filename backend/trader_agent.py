import asyncio
import json
import logging
from datetime import datetime
from typing import Callable, Optional

import anthropic
import pandas as pd

import database as db
from data import fetch_ohlcv, fetch_current_price
from indicators import calculate_all_indicators

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-20250514"

CRYPTO_TICKERS = set()  # populated dynamically by checking "/" in ticker


class TraderAgent:
    def __init__(self, trader: dict, broadcast: Optional[Callable] = None):
        self.trader = trader          # full trader row from DB
        self.name = trader["name"]
        self._broadcast = broadcast
        self.running = False
        self.last_error: Optional[str] = None

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _emit(self, msg: dict):
        if self._broadcast:
            try:
                await self._broadcast(msg)
            except Exception:
                pass

    def _claude(self):
        key = db.get_setting("claude_api_key")
        if not key:
            raise ValueError("Claude API key not configured")
        return anthropic.Anthropic(api_key=key)

    # ── Prompt ────────────────────────────────────────────────────────────────

    def _build_prompt(self, ticker: str, ind: dict, positions: dict, cash: float) -> str:
        t = self.trader
        is_crypto = "/" in ticker
        no_short_note = " (crypto cannot be shorted)" if is_crypto else ""

        position = positions.get(ticker)
        if position:
            side_label = position["side"].upper()
            pos_info = (
                f"OPEN {side_label} position: "
                f"{position['qty']:.4f} units @ avg ${position['avg_price']:.4f}"
            )
        else:
            pos_info = "No current position in this ticker."

        allocation = float(t["allocation"])
        portfolio_value = cash + sum(
            pos["qty"] * pos["avg_price"] for pos in positions.values()
        )
        pnl = portfolio_value - allocation
        pnl_pct = (pnl / allocation * 100) if allocation > 0 else 0.0

        pa = ind.get("price_action", [])
        pa_lines = "\n".join(
            f"  [{i+1}] O={c['open']} H={c['high']} L={c['low']} C={c['close']} V={c['volume']:,}"
            for i, c in enumerate(pa)
        )

        return f"""You are {t['display_name']} {t['emoji']}, a {t['personality']} virtual trader with a {t['style']} trading style.
Your confidence threshold is {t['confidence_threshold']} — only return actions you rate at or above this confidence.
Your stop-loss is {t['stop_loss_pct']}% and your max position size is {t['max_position_size_pct']}% of your portfolio.

Analyse the data below and return a trade decision.

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
Allocation    : ${allocation:,.2f}
Cash          : ${cash:,.2f}
Portfolio Value: ${portfolio_value:,.2f}
P&L           : ${pnl:+.2f} ({pnl_pct:+.2f}%)
Open Positions: {len(positions)}

═══ RISK PARAMETERS ═══
Stop-Loss       : {t['stop_loss_pct']}%
Max Position    : {t['max_position_size_pct']}% of portfolio
Min Confidence  : {t['confidence_threshold']}

═══ TRADER STYLE NOTES ═══
{_trader_style_notes(t)}

═══ VALID ACTIONS BASED ON POSITION ═══
- BUY   : Enter LONG — only when NO position or a SHORT position exists to close
- SELL  : Exit LONG  — only when you hold a LONG position
- SHORT : Enter SHORT (profit when price falls) — only when NO position AND NOT crypto{no_short_note}
- COVER : Exit SHORT — only when you hold a SHORT position
- HOLD  : Do nothing — use when signals are mixed, weak, or no valid action applies

Return ONLY a JSON object — no markdown, no explanation outside the JSON:
{{"action": "BUY|SELL|SHORT|COVER|HOLD", "confidence": 0.0-1.0, "sizing": "small|medium|large", "reasoning": "2-3 sentences citing specific indicator values and why this direction"}}

confidence: your probability estimate this trade is profitable (0.0–1.0). Must be >= {t['confidence_threshold']} to execute.
sizing    : small=25%, medium=50%, large=100% of max position size — scale up for stronger signals"""

    # ── Analysis ──────────────────────────────────────────────────────────────

    async def analyse(self, ticker: str) -> Optional[dict]:
        logger.info(f"[trader:{self.name}] Analysing {ticker} …")
        try:
            df = pd.DataFrame()
            for period in ("30d", "14d", "7d"):
                df = fetch_ohlcv(ticker, period=period, interval="1h")
                if not df.empty and len(df) >= 52:
                    break
                logger.warning(
                    f"[trader:{self.name}] {ticker}: only {len(df)} candles for "
                    f"period={period}, trying shorter"
                )

            if df.empty or len(df) < 52:
                logger.warning(
                    f"[trader:{self.name}] Insufficient data for {ticker} "
                    f"({len(df)} candles) — skipping"
                )
                return None

            ind = calculate_all_indicators(df)
            positions = db.get_trader_positions(self.name)
            cash = db.get_trader_cash(self.name)

            prompt = self._build_prompt(ticker, ind, positions, cash)
            client = self._claude()

            resp = client.messages.create(
                model=MODEL,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()

            # Strip markdown fences
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
                f"[trader:{self.name}] {ticker}: {decision['action']} "
                f"(conf={decision['confidence']:.2f})"
            )
            return {
                "decision": decision,
                "indicators": ind,
                "positions": positions,
                "cash": cash,
            }

        except json.JSONDecodeError as e:
            logger.error(f"[trader:{self.name}] JSON parse error for {ticker}: {e}")
        except Exception as e:
            logger.error(f"[trader:{self.name}] Analysis error for {ticker}: {e}")
        return None

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute(self, ticker: str, analysis: dict) -> bool:
        d = analysis["decision"]
        ind = analysis["indicators"]
        positions = analysis["positions"]
        cash = analysis["cash"]

        action = d["action"].upper()
        confidence = float(d["confidence"])
        sizing = d.get("sizing", "medium")
        reasoning = d["reasoning"]
        price = ind["current_price"]

        t = self.trader
        is_crypto = "/" in ticker
        position = positions.get(ticker)

        # ── Validate action against position state ────────────────────────────
        blocked_reason = None
        if action == "BUY":
            if position and position["side"] == "long":
                blocked_reason = "Already hold a LONG position"
        elif action == "SELL":
            if not position or position["side"] != "long":
                blocked_reason = "No LONG position to sell"
        elif action == "SHORT":
            if position:
                blocked_reason = "Already have an open position"
            elif is_crypto:
                blocked_reason = "Cannot short crypto"
        elif action == "COVER":
            if not position or position["side"] != "short":
                blocked_reason = "No SHORT position to cover"
        elif action == "HOLD":
            pass

        # ── Confidence threshold check ────────────────────────────────────────
        if blocked_reason is None and action != "HOLD":
            if confidence < float(t["confidence_threshold"]):
                blocked_reason = (
                    f"Confidence {confidence:.2f} below threshold "
                    f"{t['confidence_threshold']}"
                )

        # ── Daily loss limit check ────────────────────────────────────────────
        if blocked_reason is None and action in ("BUY", "SHORT"):
            daily_pnl = db.get_trader_daily_pnl(self.name)
            allocation = float(t["allocation"])
            daily_loss_limit = allocation * float(t["daily_loss_limit_pct"]) / 100
            if daily_pnl < -daily_loss_limit:
                blocked_reason = (
                    f"Daily loss limit hit: ${daily_pnl:.2f} exceeds "
                    f"-${daily_loss_limit:.2f}"
                )

        executed = (blocked_reason is None) and (action != "HOLD")

        # ── Log decision ──────────────────────────────────────────────────────
        db.log_trader_decision(
            trader_name=self.name,
            ticker=ticker,
            action=action,
            confidence=confidence,
            sizing=sizing,
            reasoning=reasoning,
            executed=executed,
            blocked_reason=blocked_reason,
            rsi=ind.get("rsi"),
            macd=ind["macd"]["histogram"],
            ema20=ind.get("ema20"),
            ema50=ind.get("ema50"),
            current_price=price,
        )

        await self._emit({
            "type": "trader_decision",
            "data": {
                "trader": self.name,
                "ticker": ticker,
                "action": action,
                "confidence": confidence,
                "sizing": sizing,
                "reasoning": reasoning,
                "executed": executed,
                "blocked_reason": blocked_reason,
                "timestamp": datetime.utcnow().isoformat(),
            },
        })

        if not executed:
            if blocked_reason:
                logger.info(f"[trader:{self.name}] {ticker} blocked: {blocked_reason}")
            return False

        # ── Calculate quantity ────────────────────────────────────────────────
        current_cash = db.get_trader_cash(self.name)
        allocation = float(t["allocation"])
        max_pos_pct = float(t["max_position_size_pct"]) / 100
        size_factors = {"small": 0.25, "medium": 0.50, "large": 1.00}
        size_factor = size_factors.get(sizing, 0.50)

        portfolio_value = current_cash  # simplified: cash only for sizing
        dollar_amount = portfolio_value * max_pos_pct * size_factor

        if action in ("BUY",):
            dollar_amount = min(dollar_amount, current_cash * 0.95)  # keep 5% reserve
            qty = round(dollar_amount / price, 4) if price > 0 else 0
        elif action == "SELL":
            qty = position["qty"] if position else 0
        elif action == "SHORT":
            dollar_amount = min(dollar_amount, current_cash * 0.95)
            qty = round(dollar_amount / price, 4) if price > 0 else 0
        elif action == "COVER":
            qty = position["qty"] if position else 0
        else:
            return False

        if qty <= 0:
            logger.warning(f"[trader:{self.name}] {ticker} zero qty — skipping")
            return False

        # ── Virtual execution ─────────────────────────────────────────────────
        if action == "BUY":
            db.trader_virtual_buy(self.name, ticker, qty, price)
        elif action == "SELL":
            avg_price = position["avg_price"] if position else price
            pnl = (price - avg_price) * qty
            db.trader_virtual_sell(self.name, ticker, qty, price, pnl)
        elif action == "SHORT":
            db.trader_virtual_short(self.name, ticker, qty, price)
        elif action == "COVER":
            avg_price = position["avg_price"] if position else price
            pnl = (avg_price - price) * qty  # profit when price falls
            db.trader_virtual_cover(self.name, ticker, qty, price, pnl)

        logger.info(
            f"[trader:{self.name}] EXECUTED {action} {qty:.4f} {ticker} @ ${price:.4f}"
        )
        await self._emit({
            "type": "trader_trade",
            "data": {
                "trader": self.name,
                "ticker": ticker,
                "action": action,
                "quantity": qty,
                "price": price,
                "timestamp": datetime.utcnow().isoformat(),
            },
        })
        return True

    # ── Stop-loss sweep ───────────────────────────────────────────────────────

    async def check_stop_losses(self):
        positions = db.get_trader_positions(self.name)
        stop_loss_pct = float(self.trader["stop_loss_pct"]) / 100

        for ticker, pos in positions.items():
            try:
                current_price = fetch_current_price(ticker)
                if current_price <= 0:
                    continue

                avg_price = pos["avg_price"]
                side = pos["side"]
                qty = pos["qty"]

                if side == "long":
                    loss_pct = (avg_price - current_price) / avg_price
                    if loss_pct >= stop_loss_pct:
                        pnl = (current_price - avg_price) * qty
                        db.trader_virtual_sell(self.name, ticker, qty, current_price, pnl)
                        logger.warning(
                            f"[trader:{self.name}] Stop-loss SELL {ticker} "
                            f"(loss={loss_pct*100:.2f}%)"
                        )
                        await self._emit({
                            "type": "trader_stop_loss",
                            "data": {
                                "trader": self.name,
                                "ticker": ticker,
                                "side": "long",
                                "price": current_price,
                                "pnl": pnl,
                                "timestamp": datetime.utcnow().isoformat(),
                            },
                        })
                elif side == "short":
                    loss_pct = (current_price - avg_price) / avg_price
                    if loss_pct >= stop_loss_pct:
                        pnl = (avg_price - current_price) * qty
                        db.trader_virtual_cover(self.name, ticker, qty, current_price, pnl)
                        logger.warning(
                            f"[trader:{self.name}] Stop-loss COVER {ticker} "
                            f"(loss={loss_pct*100:.2f}%)"
                        )
                        await self._emit({
                            "type": "trader_stop_loss",
                            "data": {
                                "trader": self.name,
                                "ticker": ticker,
                                "side": "short",
                                "price": current_price,
                                "pnl": pnl,
                                "timestamp": datetime.utcnow().isoformat(),
                            },
                        })
            except Exception as e:
                logger.error(
                    f"[trader:{self.name}] Stop-loss check error for {ticker}: {e}"
                )

    # ── Cycle ─────────────────────────────────────────────────────────────────

    async def run_cycle(self):
        watchlist_raw = db.get_setting("watchlist") or "[]"
        try:
            watchlist = json.loads(watchlist_raw)
        except Exception:
            watchlist = []

        if not watchlist:
            logger.info(f"[trader:{self.name}] Watchlist empty — skipping cycle")
            return

        logger.info(
            f"[trader:{self.name}] Starting cycle ({len(watchlist)} tickers)"
        )

        await self.check_stop_losses()

        for ticker in watchlist:
            if not self.running:
                break
            analysis = await self.analyse(ticker)
            if analysis:
                await self.execute(ticker, analysis)
            await asyncio.sleep(2)

    # ── Main run loop ─────────────────────────────────────────────────────────

    async def run(self):
        self.running = True
        db.set_trader_active(self.name, True)
        logger.info(f"[trader:{self.name}] Started")
        await self._emit({
            "type": "trader_status",
            "data": {
                "trader": self.name,
                "status": "running",
                "timestamp": datetime.utcnow().isoformat(),
            },
        })

        interval = int(self.trader.get("trading_interval", 5))

        while self.running:
            try:
                await self.run_cycle()
                logger.info(
                    f"[trader:{self.name}] Cycle done. Sleeping {interval}m …"
                )
                for _ in range(interval * 6):
                    if not self.running:
                        break
                    await asyncio.sleep(10)
            except Exception as e:
                self.last_error = str(e)
                logger.error(f"[trader:{self.name}] Cycle error: {e}")
                await asyncio.sleep(30)

        db.set_trader_active(self.name, False)
        logger.info(f"[trader:{self.name}] Stopped")
        await self._emit({
            "type": "trader_status",
            "data": {
                "trader": self.name,
                "status": "stopped",
                "timestamp": datetime.utcnow().isoformat(),
            },
        })

    def stop(self):
        self.running = False


# ── Trader-specific style notes ───────────────────────────────────────────────

def _trader_style_notes(t: dict) -> str:
    name = t["name"]
    if name == "luke":
        return (
            "You are an aggressive scalper. React fast to short-term momentum. "
            "Accept higher risk for higher reward. Prefer frequent small wins."
        )
    elif name == "aiden":
        return (
            "You are a momentum trader. Look for strong trends with volume confirmation. "
            "Enter on breakouts and ride the wave. Cut losses quickly."
        )
    elif name == "mitchell":
        return (
            "You are a swing trader. Look for multi-day setups with clear support/resistance. "
            "Be patient and wait for high-probability entries. Balance risk and reward."
        )
    elif name == "michaela":
        return (
            "You are a conservative position trader. Only enter on very strong confirmed signals. "
            "Protect capital above all else. Prefer fewer, higher-confidence trades."
        )
    elif name == "billy":
        return (
            "You are a value-focused, ultra-conservative trader. Only enter when indicators "
            "are extremely clear. Avoid volatility. Preservation of capital is paramount."
        )
    return "Trade according to your risk profile."
