"""Entrypoint for running the Telegram bot as an independent container.

Usage: python bot_entrypoint.py
Requires: TELEGRAM_BOT_TOKEN, DATABASE_URL, REDIS_URL, SECRET_KEY (env vars)
"""

import logging
import os
import time

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MAX_RETRIES = 5
RETRY_DELAY = 10  # seconds


def _wait_for_db(max_wait: int = 60) -> bool:
    """Wait for database to be reachable."""
    from sqlalchemy import text

    from app.database import engine

    start = time.time()
    while time.time() - start < max_wait:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database is ready")
            return True
        except Exception as e:
            logger.info("Waiting for database... (%s)", e)
            time.sleep(3)
    logger.error("Database not ready after %ds", max_wait)
    return False


def _wait_for_redis(max_wait: int = 30) -> bool:
    """Wait for Redis to be reachable."""
    import redis

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    start = time.time()
    while time.time() - start < max_wait:
        try:
            r = redis.from_url(redis_url)
            r.ping()
            r.close()
            logger.info("Redis is ready")
            return True
        except Exception as e:
            logger.info("Waiting for Redis... (%s)", e)
            time.sleep(2)
    logger.error("Redis not ready after %ds", max_wait)
    return False


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN is not set. Exiting.")
        raise SystemExit(1)

    secret_key = os.getenv("SECRET_KEY", "")
    if len(secret_key) < 32:
        logger.error("SECRET_KEY must be at least 32 characters. Exiting.")
        raise SystemExit(1)

    # Wait for dependencies
    if not _wait_for_db():
        raise SystemExit(1)
    if not _wait_for_redis():
        raise SystemExit(1)

    # Ensure tables exist (same as main.py lifespan)
    from app.database import Base, engine

    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ensured")

    # Start bot with retry logic
    from app.telegram_bot import start_bot

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("Starting Telegram bot (attempt %d/%d)...", attempt, MAX_RETRIES)
            start_bot(token)
        except KeyboardInterrupt:
            logger.info("Bot stopped by user")
            break
        except Exception as e:
            logger.error("Bot crashed: %s", e, exc_info=True)
            if attempt < MAX_RETRIES:
                logger.info("Retrying in %ds...", RETRY_DELAY)
                time.sleep(RETRY_DELAY)
            else:
                logger.error("Max retries reached. Exiting.")
                raise SystemExit(1)


if __name__ == "__main__":
    main()
