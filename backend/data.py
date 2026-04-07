import logging
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


def _to_yf(ticker: str) -> str:
    """Convert Alpaca-style ticker to yfinance format (BTC/USD -> BTC-USD)."""
    return ticker.replace("/", "-")


def fetch_ohlcv(ticker: str, period: str = "60d", interval: str = "1h") -> pd.DataFrame:
    """
    Fetch OHLCV data via yfinance.
    Returns DataFrame with lowercase columns: open, high, low, close, volume.
    """
    yf_ticker = _to_yf(ticker)
    for attempt in range(3):
        try:
            raw = yf.download(
                yf_ticker,
                period=period,
                interval=interval,
                progress=False,
                auto_adjust=True,
                threads=False,
            )
            if raw.empty:
                logger.warning(f"[data] No data for {ticker} (attempt {attempt+1})")
                continue

            # Flatten multi-level columns if present
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = [col[0].lower() for col in raw.columns]
            else:
                raw.columns = [c.lower() for c in raw.columns]

            required = ["open", "high", "low", "close", "volume"]
            missing = [c for c in required if c not in raw.columns]
            if missing:
                logger.error(f"[data] Missing columns {missing} for {ticker}")
                return pd.DataFrame()

            df = raw[required].dropna()
            logger.info(f"[data] {ticker}: {len(df)} candles fetched")
            return df

        except Exception as e:
            logger.error(f"[data] Error fetching {ticker} (attempt {attempt+1}): {e}")

    return pd.DataFrame()


def fetch_current_price(ticker: str) -> float:
    """Fetch the latest price for a ticker."""
    yf_ticker = _to_yf(ticker)
    try:
        t = yf.Ticker(yf_ticker)
        info = t.fast_info
        price = getattr(info, "last_price", None)
        if not price:
            hist = t.history(period="1d", interval="1m")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
        return round(float(price), 4) if price else 0.0
    except Exception as e:
        logger.error(f"[data] Price fetch failed for {ticker}: {e}")
        return 0.0


def fetch_multiple_prices(tickers: list) -> dict:
    return {t: fetch_current_price(t) for t in tickers}
