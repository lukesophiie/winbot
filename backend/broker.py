import logging
from typing import Optional

logger = logging.getLogger(__name__)


class AlpacaBroker:
    """Wrapper around alpaca-py TradingClient."""

    def __init__(self, api_key: str, secret_key: str, paper: bool = True):
        self.api_key = api_key
        self.secret_key = secret_key
        self.paper = paper
        self._client = None
        self._connected = False

        if api_key and secret_key:
            self._init_client()

    # ── Initialisation ────────────────────────────────────────────────────────

    def _init_client(self):
        try:
            from alpaca.trading.client import TradingClient
            self._client = TradingClient(
                api_key=self.api_key,
                secret_key=self.secret_key,
                paper=self.paper,
            )
            # Quick connectivity check
            self._client.get_account()
            self._connected = True
            mode = "paper" if self.paper else "LIVE"
            logger.info(f"[broker] Alpaca connected ({mode})")
        except Exception as e:
            logger.error(f"[broker] Alpaca init failed: {e}")
            self._connected = False

    def is_connected(self) -> bool:
        return self._connected

    # ── Account ───────────────────────────────────────────────────────────────

    def get_account(self) -> dict:
        if not self._client:
            return {}
        try:
            a = self._client.get_account()
            equity = float(a.equity)
            last_eq = float(a.last_equity)
            pnl = equity - last_eq
            pnl_pct = (pnl / last_eq * 100) if last_eq > 0 else 0.0
            return {
                "id": str(a.id),
                "cash": round(float(a.cash), 2),
                "portfolio_value": round(float(a.portfolio_value), 2),
                "buying_power": round(float(a.buying_power), 2),
                "equity": round(equity, 2),
                "last_equity": round(last_eq, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
                "status": str(a.status),
                "pattern_day_trader": bool(a.pattern_day_trader),
            }
        except Exception as e:
            logger.error(f"[broker] get_account: {e}")
            return {}

    # ── Positions ─────────────────────────────────────────────────────────────

    def get_positions(self) -> list:
        if not self._client:
            return []
        try:
            positions = self._client.get_all_positions()
            result = []
            for p in positions:
                result.append({
                    "ticker": p.symbol,
                    "quantity": float(p.qty),
                    "avg_entry_price": float(p.avg_entry_price),
                    "current_price": float(p.current_price),
                    "market_value": float(p.market_value),
                    "unrealized_pl": float(p.unrealized_pl),
                    "unrealized_plpc": round(float(p.unrealized_plpc) * 100, 2),
                    "side": str(p.side),
                })
            return result
        except Exception as e:
            logger.error(f"[broker] get_positions: {e}")
            return []

    def get_position(self, ticker: str) -> Optional[dict]:
        if not self._client:
            return None
        try:
            clean = ticker.replace("/", "")
            p = self._client.get_open_position(clean)
            return {
                "ticker": p.symbol,
                "quantity": float(p.qty),
                "avg_entry_price": float(p.avg_entry_price),
                "current_price": float(p.current_price),
                "market_value": float(p.market_value),
                "unrealized_pl": float(p.unrealized_pl),
                "unrealized_plpc": round(float(p.unrealized_plpc) * 100, 2),
                "side": str(p.side),
            }
        except Exception:
            return None

    # ── Orders ────────────────────────────────────────────────────────────────

    def place_market_order(self, ticker: str, side: str, quantity: float) -> Optional[dict]:
        if not self._client:
            logger.error("[broker] Client not initialised")
            return None
        try:
            from alpaca.trading.requests import MarketOrderRequest
            from alpaca.trading.enums import OrderSide, TimeInForce

            clean = ticker.replace("/", "")
            req = MarketOrderRequest(
                symbol=clean,
                qty=quantity,
                side=OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL,
                time_in_force=TimeInForce.GTC,
            )
            order = self._client.submit_order(req)
            filled_price = float(order.filled_avg_price) if order.filled_avg_price else 0.0
            logger.info(f"[broker] Order submitted: {side.upper()} {quantity} {ticker} | id={order.id}")
            return {
                "order_id": str(order.id),
                "ticker": ticker,
                "side": side,
                "quantity": float(quantity),
                "status": str(order.status),
                "filled_avg_price": filled_price,
                "created_at": str(order.created_at),
            }
        except Exception as e:
            logger.error(f"[broker] place_market_order {ticker}: {e}")
            return None

    def close_position(self, ticker: str) -> Optional[dict]:
        if not self._client:
            return None
        try:
            clean = ticker.replace("/", "")
            order = self._client.close_position(clean)
            return {"order_id": str(order.id), "ticker": ticker, "status": str(order.status)}
        except Exception as e:
            logger.error(f"[broker] close_position {ticker}: {e}")
            return None

    def get_orders(self, limit: int = 20) -> list:
        if not self._client:
            return []
        try:
            from alpaca.trading.requests import GetOrdersRequest
            from alpaca.trading.enums import QueryOrderStatus

            req = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=limit)
            orders = self._client.get_orders(req)
            result = []
            for o in orders:
                result.append({
                    "id": str(o.id),
                    "ticker": o.symbol,
                    "side": str(o.side),
                    "quantity": float(o.qty) if o.qty else 0,
                    "filled_qty": float(o.filled_qty) if o.filled_qty else 0,
                    "filled_avg_price": float(o.filled_avg_price) if o.filled_avg_price else 0,
                    "status": str(o.status),
                    "created_at": str(o.created_at),
                })
            return result
        except Exception as e:
            logger.error(f"[broker] get_orders: {e}")
            return []

    # ── Helpers ───────────────────────────────────────────────────────────────

    def calculate_quantity(self, ticker: str, price: float,
                           portfolio_value: float, size_pct: float) -> float:
        if price <= 0:
            return 0.0
        dollar_amount = portfolio_value * (size_pct / 100)
        qty = dollar_amount / price
        if "/" in ticker or any(c in ticker for c in ["BTC", "ETH", "SOL"]):
            return round(qty, 6)
        return round(max(qty, 0.01), 2)
