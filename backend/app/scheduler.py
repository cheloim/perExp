"""
Background price refresh scheduler.
Runs every 15 minutes during BYMA trading hours (Mon–Fri 11:00–17:00 ARS).
Skips weekends and Argentine public holidays.
"""
import asyncio
import logging
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")

MARKET_OPEN  = time(11, 0)
MARKET_CLOSE = time(17, 0)
REFRESH_INTERVAL_SECONDS = 15 * 60  # 15 minutes

# Argentine public holidays that close BYMA
_HOLIDAYS: set[date] = {
    # 2025
    date(2025, 1, 1),
    date(2025, 3, 3), date(2025, 3, 4),   # Carnaval
    date(2025, 3, 24),                     # Día de la Memoria
    date(2025, 4, 2),                      # Malvinas
    date(2025, 4, 17), date(2025, 4, 18), # Semana Santa
    date(2025, 5, 1),
    date(2025, 5, 25),
    date(2025, 6, 16),                     # Güemes
    date(2025, 6, 20),                     # Belgrano
    date(2025, 7, 9),
    date(2025, 8, 18),                     # San Martín
    date(2025, 10, 12),
    date(2025, 11, 24),                    # Soberanía Nacional
    date(2025, 12, 8),
    date(2025, 12, 25),
    date(2025, 12, 31),                    # BYMA cierra
    # 2026
    date(2026, 1, 1),
    date(2026, 2, 16), date(2026, 2, 17), # Carnaval
    date(2026, 3, 24),
    date(2026, 4, 2),
    date(2026, 4, 3), date(2026, 4, 4),   # Semana Santa
    date(2026, 5, 1),
    date(2026, 5, 25),
    date(2026, 6, 15),                     # Güemes
    date(2026, 6, 20),
    date(2026, 7, 9),
    date(2026, 8, 17),                     # San Martín
    date(2026, 10, 12),
    date(2026, 11, 23),                    # Soberanía Nacional
    date(2026, 12, 8),
    date(2026, 12, 25),
    date(2026, 12, 31),
}


def is_trading_now() -> bool:
    now = datetime.now(BUE)
    if now.weekday() >= 5:          # sábado=5, domingo=6
        return False
    if now.date() in _HOLIDAYS:
        return False
    return MARKET_OPEN <= now.time() <= MARKET_CLOSE


async def _do_refresh():
    from app.database import SessionLocal
    from app.services.price_refresh import refresh_iol_prices, refresh_ppi_prices

    db = SessionLocal()
    try:
        iol_updated = await asyncio.to_thread(refresh_iol_prices, db)
        ppi_updated = await asyncio.to_thread(refresh_ppi_prices, db)
        logger.info(f"Price refresh done — IOL: {iol_updated} tickers, PPI: {ppi_updated} tickers")
    except Exception as e:
        logger.error(f"Price refresh failed: {e}")
    finally:
        db.close()


async def price_refresh_loop():
    """
    Runs forever. Ticks every 60 s to check if we're in trading hours.
    When inside trading hours, refreshes prices and sleeps REFRESH_INTERVAL_SECONDS.
    """
    last_refresh: datetime | None = None

    while True:
        await asyncio.sleep(60)

        if not is_trading_now():
            continue

        now = datetime.now(BUE)
        seconds_since_refresh = (
            (now - last_refresh).total_seconds() if last_refresh else REFRESH_INTERVAL_SECONDS + 1
        )

        if seconds_since_refresh >= REFRESH_INTERVAL_SECONDS:
            logger.info("Market is open — refreshing investment prices...")
            await _do_refresh()
            last_refresh = datetime.now(BUE)
