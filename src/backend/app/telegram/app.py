"""Telegram application setup and handler registration."""

import asyncio
import contextlib
import logging
import os

from telegram import MenuButtonWebApp, WebAppInfo
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from app.telegram.auth import handle_auth, start
from app.telegram.capture import (
    handle_expense_image,
    handle_expense_image_callback,
    handle_voice_message,
)
from app.telegram.confirm_handlers import (
    cancel,
    cancel_callback,
    handle_confirm,
    handle_event_confirm,
)
from app.telegram.constants import (
    WAITING_AUTH,
    WAITING_CONFIRM,
    WAITING_EDIT_CONFIRM,
    WAITING_EDIT_FIELD,
    WAITING_EDIT_SELECT,
    WAITING_EDIT_VALUE,
    WAITING_EVENT_CONFIRM,
    WAITING_INSTALLMENT_NUMBER,
    WAITING_INSTALLMENT_QUESTION,
)
from app.telegram.edit_handlers import (
    cmd_deshacer,
    cmd_editar,
    handle_edit_confirm,
    handle_edit_field,
    handle_edit_quick,
    handle_edit_select,
    handle_edit_value,
    handle_undo,
    handle_undo_batch,
)
from app.telegram.payment_handlers import (
    handle_installment_number,
    handle_installment_question,
)
from app.telegram.report_handlers import (
    cmd_ayuda,
    cmd_cuotas,
    cmd_gastos,
    cmd_presupuesto,
    cmd_suscripciones,
    handle_report_callback,
    handle_reportimg_callback,
)
from app.telegram.runtime import bot_module, logger
from app.telegram.text_handlers import handle_message, handle_unsupported_message


def start_bot(token: str) -> None:
    """Run the bot synchronously in its own event loop (called from a daemon thread)."""
    logging.getLogger("telegram").setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run_bot(token))
    except Exception as e:
        logger.error("Bot fatal error: %s", e, exc_info=True)
        raise
    finally:
        loop.close()


async def _post_init(app: Application) -> None:
    """Set menu button, bot commands, and other post-init config."""
    frontend_url = os.getenv("FRONTEND_URL", "")
    if frontend_url:
        try:
            await app.bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Abrir Oikonomia",
                    web_app=WebAppInfo(url=frontend_url),
                )
            )
            logger.info("Set chat menu button to WebApp: %s", frontend_url)
        except Exception as e:
            logger.warning("Failed to set menu button: %s", e)

    commands = [
        ("start", "Iniciar o reconectar tu cuenta"),
        ("gastos", "Ver gastos del mes"),
        ("presupuesto", "Ver presupuestos"),
        ("editar", "Editar un gasto reciente"),
        ("deshacer", "Deshacer el último gasto guardado"),
        ("suscripciones", "Ver suscripciones recurrentes"),
        ("inversiones", "Ver inversiones"),
        ("cuotas", "Ver cuotas pendientes"),
        ("cancelar", "Cancelar operación actual"),
        ("ayuda", "Ver ayuda y comandos"),
    ]
    try:
        await app.bot.set_my_commands(commands)
        logger.info("Bot commands registered")
    except Exception as e:
        logger.warning("Failed to set bot commands: %s", e)


async def _run_bot(token: str) -> None:
    app = Application.builder().token(token).post_init(_post_init).build()
    bot_module()._bot_app = app

    conv_handler = ConversationHandler(
        entry_points=[
            CommandHandler("start", start),
            CommandHandler("editar", cmd_editar),
            MessageHandler(filters.VOICE | filters.AUDIO, handle_voice_message),
            MessageHandler(filters.PHOTO | filters.Document.IMAGE, handle_expense_image),
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message),
        ],
        states={
            WAITING_AUTH: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_auth)],
            WAITING_CONFIRM: [CallbackQueryHandler(handle_confirm, pattern=r"^confirm:")],
            WAITING_INSTALLMENT_QUESTION: [
                CallbackQueryHandler(handle_installment_question, pattern=r"^installment:")
            ],
            WAITING_INSTALLMENT_NUMBER: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_installment_number)
            ],
            WAITING_EVENT_CONFIRM: [
                CallbackQueryHandler(handle_event_confirm, pattern=r"^event_link:")
            ],
            WAITING_EDIT_SELECT: [CallbackQueryHandler(handle_edit_select, pattern=r"^edit:")],
            WAITING_EDIT_FIELD: [
                CallbackQueryHandler(handle_edit_field, pattern=r"^efield:"),
                CallbackQueryHandler(handle_edit_quick, pattern=r"^quickedit:"),
            ],
            WAITING_EDIT_VALUE: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_edit_value)
            ],
            WAITING_EDIT_CONFIRM: [CallbackQueryHandler(handle_edit_confirm, pattern=r"^econf:")],
        },
        fallbacks=[
            MessageHandler(filters.COMMAND, cancel),
            CallbackQueryHandler(cancel_callback, pattern=r"^cancel$"),
            MessageHandler(filters.VOICE | filters.AUDIO, handle_voice_message),
            MessageHandler(filters.PHOTO | filters.Document.IMAGE, handle_expense_image),
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message),
        ],
        per_message=False,
    )

    app.add_handler(CommandHandler("presupuesto", cmd_presupuesto))
    app.add_handler(CommandHandler("gastos", cmd_gastos))
    app.add_handler(CommandHandler("deshacer", cmd_deshacer))
    app.add_handler(CommandHandler("cuotas", cmd_cuotas))
    app.add_handler(CommandHandler("suscripciones", cmd_suscripciones))
    app.add_handler(CommandHandler("ayuda", cmd_ayuda))
    app.add_handler(CallbackQueryHandler(handle_report_callback, pattern=r"^report:"))
    app.add_handler(CallbackQueryHandler(handle_reportimg_callback, pattern=r"^reportimg:"))
    app.add_handler(CallbackQueryHandler(handle_expense_image_callback, pattern=r"^expenseimg:"))
    app.add_handler(CallbackQueryHandler(handle_undo, pattern=r"^undo:"))
    app.add_handler(CallbackQueryHandler(handle_undo_batch, pattern=r"^undobatch:"))

    app.add_handler(conv_handler)
    app.add_handler(MessageHandler(~filters.TEXT & ~filters.COMMAND, handle_unsupported_message))

    logger.info("Telegram bot started (polling)")
    await app.initialize()
    await app.start()
    await app.updater.start_polling(drop_pending_updates=True)

    # Write heartbeat to Redis so backend can check bot liveness
    async def _heartbeat():
        import redis.asyncio as aioredis

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        r = aioredis.from_url(redis_url)
        while True:
            with contextlib.suppress(Exception):
                await r.set("bot:heartbeat", "1", ex=60)
            await asyncio.sleep(30)

    heartbeat_task = asyncio.create_task(_heartbeat())

    # Keep running until the process dies
    try:
        await asyncio.Event().wait()
    finally:
        heartbeat_task.cancel()
        await app.updater.stop()
        await app.stop()
        await app.shutdown()
