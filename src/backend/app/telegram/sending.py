"""Outbound Telegram messages: in-process bot with Bot API fallback."""

import asyncio

from app.telegram.runtime import bot_module, logger


def send_disconnect_notification(chat_id: str) -> None:
    """Send a disconnect notification to a Telegram chat. Safe to call from any thread."""

    if not bot_module()._bot_app or not bot_module()._bot_app.bot:
        logger.warning("[TELEGRAM] Bot app not available, cannot send disconnect notification")
        return

    async def _send():
        try:
            await bot_module()._bot_app.bot.send_message(
                chat_id=chat_id,
                text="🔒 Tu sesión fue desconectada desde la web.\nUsá /start para reconectarte.",
            )
        except Exception as e:
            logger.warning(f"[TELEGRAM] Could not send disconnect notification: {e}")

    loop = (
        bot_module()._bot_app.bot._local._loop
        if hasattr(bot_module()._bot_app.bot, "_local")
        else None
    )
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(_send(), loop)
    else:
        logger.warning("[TELEGRAM] Bot event loop not available")


def send_message_to_chat(chat_id: str, text: str) -> bool:
    """Send an arbitrary message to a Telegram chat. Safe to call from any thread.

    Returns True when the message was queued on the bot loop or accepted by the
    Bot API. Production runs the bot in its own container with
    TELEGRAM_BOT_ENABLED=false on the backend, so the HTTP fallback is the only
    path that works from scripts and Celery workers there.
    """
    from app.metrics import TELEGRAM_MESSAGES

    TELEGRAM_MESSAGES.labels(direction="outbound").inc()
    if bot_module()._bot_app and bot_module()._bot_app.bot:

        async def _send():
            try:
                await bot_module()._bot_app.bot.send_message(
                    chat_id=chat_id, text=text, parse_mode="HTML"
                )
            except Exception as e:
                logger.warning(f"[TELEGRAM] Could not send message to {chat_id}: {e}")

        loop = (
            bot_module()._bot_app.bot._local._loop
            if hasattr(bot_module()._bot_app.bot, "_local")
            else None
        )
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(_send(), loop)
            return True
        logger.warning("[TELEGRAM] Bot event loop not available; using the Bot API")

    return _send_message_via_api(chat_id, text)


def _send_message_via_api(chat_id: str, text: str) -> bool:
    """Send a text message with the direct Bot API. Returns True on success."""
    import os

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.warning("[TELEGRAM] No bot token available, cannot send message")
        return False

    try:
        import httpx

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                url,
                data={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
        if resp.status_code != 200:
            logger.warning(f"[TELEGRAM] API error {resp.status_code}: {resp.text[:200]}")
            return False
        logger.info(f"[TELEGRAM] Message sent to {chat_id}")
        return True
    except Exception as e:
        logger.warning(f"[TELEGRAM] Could not send message via API to {chat_id}: {e}")
        return False


def send_photo_to_chat(chat_id: str, image_bytes: bytes, caption: str = None) -> bool:
    """Send an image to a Telegram chat. Returns True on success."""
    # Try using bot instance first
    if bot_module()._bot_app and bot_module()._bot_app.bot:

        async def _send():
            try:
                from io import BytesIO

                photo = BytesIO(image_bytes)
                photo.name = "report.png"
                await bot_module()._bot_app.bot.send_photo(
                    chat_id=chat_id, photo=photo, caption=caption, parse_mode="HTML"
                )
                return True
            except Exception as e:
                logger.warning(f"[TELEGRAM] Could not send photo to {chat_id}: {e}")
                return False

        loop = (
            bot_module()._bot_app.bot._local._loop
            if hasattr(bot_module()._bot_app.bot, "_local")
            else None
        )
        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(_send(), loop)
            try:
                return future.result(timeout=30)
            except Exception:
                return False

    # Fallback: use direct Telegram Bot API (for celery workers)
    return _send_photo_via_api(chat_id, image_bytes, caption)


def _send_photo_via_api(chat_id: str, image_bytes: bytes, caption: str = None) -> bool:
    """Send photo using direct Telegram Bot API HTTP call. Returns True on success."""
    import os

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.warning("[TELEGRAM] No bot token available, cannot send photo")
        return False

    try:
        from io import BytesIO

        import httpx

        url = f"https://api.telegram.org/bot{token}/sendPhoto"

        files = {"photo": ("report.png", BytesIO(image_bytes), "image/png")}
        data = {"chat_id": chat_id, "parse_mode": "HTML"}
        if caption:
            data["caption"] = caption[:1024]

        with httpx.Client(timeout=30) as client:
            resp = client.post(url, files=files, data=data)
            if resp.status_code != 200:
                logger.warning(f"[TELEGRAM] API error {resp.status_code}: {resp.text[:200]}")
                return False
            logger.info(f"[TELEGRAM] Photo sent to {chat_id}")
            return True
    except Exception as e:
        logger.warning(f"[TELEGRAM] Could not send photo via API to {chat_id}: {e}")
        return False
