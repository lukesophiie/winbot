import pandas as pd
import numpy as np


def calculate_rsi(prices: pd.Series, period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return round(float(val), 2) if not np.isnan(val) else 50.0


def calculate_macd(prices: pd.Series, fast=12, slow=26, signal=9) -> dict:
    if len(prices) < slow:
        return {"macd": 0.0, "signal": 0.0, "histogram": 0.0}
    ema_fast = prices.ewm(span=fast, adjust=False).mean()
    ema_slow = prices.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return {
        "macd": round(float(macd_line.iloc[-1]), 4),
        "signal": round(float(signal_line.iloc[-1]), 4),
        "histogram": round(float(histogram.iloc[-1]), 4),
    }


def calculate_ema(prices: pd.Series, period: int) -> float:
    if len(prices) < period:
        return round(float(prices.iloc[-1]), 4)
    ema = prices.ewm(span=period, adjust=False).mean()
    return round(float(ema.iloc[-1]), 4)


def calculate_volume_ratio(volumes: pd.Series, period: int = 20) -> float:
    if len(volumes) < period:
        return 1.0
    avg = volumes.rolling(window=period).mean().iloc[-1]
    current = volumes.iloc[-1]
    if avg == 0:
        return 1.0
    return round(float(current / avg), 2)


def get_price_action(df: pd.DataFrame, candles: int = 5) -> list:
    recent = df.tail(candles)
    result = []
    for _, row in recent.iterrows():
        result.append({
            "open": round(float(row["open"]), 4),
            "high": round(float(row["high"]), 4),
            "low": round(float(row["low"]), 4),
            "close": round(float(row["close"]), 4),
            "volume": int(row["volume"]) if not pd.isna(row["volume"]) else 0,
        })
    return result


def calculate_all_indicators(df: pd.DataFrame) -> dict:
    closes = df["close"].astype(float)
    volumes = df["volume"].astype(float)

    rsi = calculate_rsi(closes)
    macd = calculate_macd(closes)
    ema20 = calculate_ema(closes, 20)
    ema50 = calculate_ema(closes, 50)
    volume_ratio = calculate_volume_ratio(volumes)
    price_action = get_price_action(df)
    current_price = round(float(closes.iloc[-1]), 4)

    # Price change metrics
    pct_change_1h = 0.0
    pct_change_24h = 0.0
    if len(closes) >= 2:
        pct_change_1h = round((closes.iloc[-1] - closes.iloc[-2]) / closes.iloc[-2] * 100, 2)
    if len(closes) >= 24:
        pct_change_24h = round((closes.iloc[-1] - closes.iloc[-24]) / closes.iloc[-24] * 100, 2)

    return {
        "current_price": current_price,
        "rsi": rsi,
        "macd": macd,
        "ema20": ema20,
        "ema50": ema50,
        "volume_ratio": volume_ratio,
        "price_action": price_action,
        "pct_change_1h": pct_change_1h,
        "pct_change_24h": pct_change_24h,
    }
