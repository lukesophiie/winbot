import logging
import pandas as pd

logger = logging.getLogger(__name__)


def _to_yf(ticker: str) -> str:
    return ticker.replace("/", "-")


def _alpaca_keys():
    """Return (key, secret) — prefers paper, falls back to live."""
    from database import get_setting
    key    = get_setting("alpaca_paper_key")    or get_setting("alpaca_live_key")    or ""
    secret = get_setting("alpaca_paper_secret") or get_setting("alpaca_live_secret") or ""
    return key, secret


def _interval_to_alpaca_tf(interval: str):
    from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
    mapping = {
        "1m":  (1,  TimeFrameUnit.Minute),
        "5m":  (5,  TimeFrameUnit.Minute),
        "15m": (15, TimeFrameUnit.Minute),
        "30m": (30, TimeFrameUnit.Minute),
        "1h":  (1,  TimeFrameUnit.Hour),
        "1d":  (1,  TimeFrameUnit.Day),
    }
    mult, unit = mapping.get(interval, (1, TimeFrameUnit.Hour))
    return TimeFrame(mult, unit)


def _period_to_days(period: str) -> int:
    mapping = {"1d": 2, "5d": 7, "1mo": 35, "3mo": 95, "60d": 65}
    try:
        if period.endswith("d"):
            return int(period[:-1]) + 2
        if period.endswith("mo"):
            return int(period[:-2]) * 31 + 5
    except Exception:
        pass
    return mapping.get(period, 65)


def fetch_ohlcv(ticker: str, period: str = "60d", interval: str = "1h") -> pd.DataFrame:
    """
    Fetch OHLCV data. Tries Alpaca market data first (reliable on Railway),
    falls back to yfinance if Alpaca keys aren't set.
    Returns DataFrame with lowercase columns: open, high, low, close, volume.
    """
    # ── Alpaca path ───────────────────────────────────────────────────────────
    try:
        df = _fetch_alpaca(ticker, period, interval)
        if df is not None and not df.empty and len(df) >= 10:
            logger.info(f"[data] {ticker}: {len(df)} candles via Alpaca")
            return df
    except Exception as e:
        logger.warning(f"[data] Alpaca fetch failed for {ticker}: {e}")

    # ── yfinance fallback ─────────────────────────────────────────────────────
    logger.info(f"[data] Falling back to yfinance for {ticker}")
    return _fetch_yfinance(ticker, period, interval)


def _fetch_alpaca(ticker: str, period: str, interval: str) -> pd.DataFrame | None:
    from datetime import datetime, timedelta, timezone
    key, secret = _alpaca_keys()
    if not key or not secret:
        return None

    tf   = _interval_to_alpaca_tf(interval)
    days = _period_to_days(period)
    end  = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    is_crypto = "/" in ticker
    clean     = ticker.replace("/", "")

    if is_crypto:
        from alpaca.data.historical import CryptoHistoricalDataClient
        from alpaca.data.requests   import CryptoBarsRequest
        client = CryptoHistoricalDataClient(key, secret)
        # Alpaca crypto API requires the slash format: BTC/USD not BTCUSD
        req    = CryptoBarsRequest(symbol_or_symbols=ticker, timeframe=tf, start=start, end=end)
        bars   = client.get_crypto_bars(req)
    else:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests   import StockBarsRequest
        from alpaca.data.enums      import DataFeed
        client = StockHistoricalDataClient(key, secret)
        # Free Alpaca accounts can only access IEX feed, not SIP
        req    = StockBarsRequest(symbol_or_symbols=ticker, timeframe=tf, start=start, end=end, feed=DataFeed.IEX)
        bars   = client.get_stock_bars(req)

    df = bars.df
    if df.empty:
        return None

    # Alpaca returns MultiIndex (symbol, timestamp) — drop symbol level
    if isinstance(df.index, pd.MultiIndex):
        df = df.droplevel(0)

    # Ensure tz-naive UTC index (tz_convert(None) removes timezone cleanly)
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    if df.index.tz is not None:
        df.index = df.index.tz_convert(None)

    df.columns = [c.lower() for c in df.columns]

    required = ["open", "high", "low", "close", "volume"]
    missing  = [c for c in required if c not in df.columns]
    if missing:
        logger.warning(f"[data] Alpaca response missing columns: {missing}")
        return None

    return df[required].dropna()


def _fetch_yfinance(ticker: str, period: str, interval: str) -> pd.DataFrame:
    import requests as req_lib
    import yfinance as yf

    session = req_lib.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    })

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
                session=session,
            )
            if raw.empty:
                logger.warning(f"[data] yfinance: no data for {ticker} (attempt {attempt+1})")
                continue

            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = [col[0].lower() for col in raw.columns]
            else:
                raw.columns = [c.lower() for c in raw.columns]

            required = ["open", "high", "low", "close", "volume"]
            missing  = [c for c in required if c not in raw.columns]
            if missing:
                logger.error(f"[data] yfinance missing columns {missing} for {ticker}")
                return pd.DataFrame()

            df = raw[required].dropna()
            logger.info(f"[data] {ticker}: {len(df)} candles via yfinance")
            return df

        except Exception as e:
            logger.error(f"[data] yfinance error for {ticker} (attempt {attempt+1}): {e}")

    return pd.DataFrame()


def fetch_current_price(ticker: str) -> float:
    """Fetch the latest price. Uses Alpaca first, then yfinance."""
    try:
        key, secret = _alpaca_keys()
        if key and secret:
            is_crypto = "/" in ticker
            clean     = ticker.replace("/", "")
            if is_crypto:
                from alpaca.data.historical import CryptoHistoricalDataClient
                from alpaca.data.requests   import LatestCryptoBarRequest
                client = CryptoHistoricalDataClient(key, secret)
                req    = LatestCryptoBarRequest(symbol_or_symbols=ticker)  # keep BTC/USD format
                bar    = client.get_crypto_latest_bar(req)
                if bar and ticker in bar:
                    return round(float(bar[ticker].close), 4)
            else:
                from alpaca.data.historical import StockHistoricalDataClient
                from alpaca.data.requests   import LatestStockBarRequest
                from alpaca.data.enums      import DataFeed
                client = StockHistoricalDataClient(key, secret)
                req    = LatestStockBarRequest(symbol_or_symbols=ticker, feed=DataFeed.IEX)
                bar    = client.get_stock_latest_bar(req)
                if bar and ticker in bar:
                    return round(float(bar[ticker].close), 4)
    except Exception as e:
        logger.warning(f"[data] Alpaca price fetch failed for {ticker}: {e}")

    # yfinance fallback
    try:
        import yfinance as yf
        t    = yf.Ticker(_to_yf(ticker))
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
