"""Entrypoint for running the Telegram bot as an independent container.

Usage: python bot_entrypoint.py
Requires: TELEGRAM_BOT_TOKEN, DATABASE_URL, REDIS_URL, SECRET_KEY (env vars)
"""

import logging
import os

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN is not set. Exiting.")
        raise SystemExit(1)

    secret_key = os.getenv("SECRET_KEY", "")
    if len(secret_key) < 32:
        logger.error("SECRET_KEY must be at least 32 characters. Exiting.")
        raise SystemExit(1)

    from app.telegram_bot import start_bot

    logger.info("Starting Telegram bot (standalone container)...")
    start_bot(token)


if __name__ == "__main__":
    main()
