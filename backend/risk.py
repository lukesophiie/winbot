import logging
from database import get_setting

logger = logging.getLogger(__name__)


class RiskManager:
    def reload(self):
        self.stop_loss_pct = float(get_setting("stop_loss_pct") or 2.0)
        self.max_position_size_pct = float(get_setting("max_position_size_pct") or 10.0)
        self.max_open_trades = int(get_setting("max_open_trades") or 5)
        self.daily_loss_limit_pct = float(get_setting("daily_loss_limit_pct") or 5.0)
        self.min_confidence = float(get_setting("min_confidence") or 0.7)

    def __init__(self):
        self.reload()

    def size_pct(self, sizing: str) -> float:
        self.reload()
        mapping = {
            "small": self.max_position_size_pct * 0.25,
            "medium": self.max_position_size_pct * 0.5,
            "large": self.max_position_size_pct,
        }
        return mapping.get(sizing.lower(), mapping["medium"])

    def check(self, ticker: str, action: str, confidence: float,
              positions: list, account: dict) -> tuple[bool, str]:
        """Return (allowed, reason)."""
        self.reload()

        if confidence < self.min_confidence:
            return False, f"Confidence {confidence:.2f} < threshold {self.min_confidence}"

        if action.upper() == "HOLD":
            return False, "HOLD — no trade needed"

        # Daily loss cap
        pv = account.get("portfolio_value", 0)
        if pv > 0:
            daily_pnl = account.get("pnl", 0)
            if daily_pnl < 0:
                loss_pct = abs(daily_pnl / pv * 100)
                if loss_pct >= self.daily_loss_limit_pct:
                    return False, f"Daily loss limit hit ({loss_pct:.2f}% >= {self.daily_loss_limit_pct}%)"

        # Max open trades (only for new entries)
        if action.upper() in ("BUY", "LONG"):
            already_in = any(p["ticker"] == ticker for p in positions)
            if not already_in and len(positions) >= self.max_open_trades:
                return False, f"Max open trades reached ({self.max_open_trades})"

        # Cannot sell what you don't own
        if action.upper() in ("SELL", "SHORT"):
            if not any(p["ticker"] == ticker for p in positions):
                return False, f"No position in {ticker} to sell"

        return True, "Risk checks passed"

    def should_stop_loss(self, position: dict) -> tuple[bool, str]:
        self.reload()
        plpc = position.get("unrealized_plpc", 0)
        if plpc <= -self.stop_loss_pct:
            return True, f"Stop-loss triggered: {plpc:.2f}% (limit -{self.stop_loss_pct}%)"
        return False, ""
