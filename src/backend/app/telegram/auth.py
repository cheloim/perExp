"""Authentication, session validation and the /start flow."""

import os
from datetime import datetime

from telegram import KeyboardButton, ReplyKeyboardMarkup, Update, WebAppInfo
from telegram.ext import ContextTypes, ConversationHandler

from app.models import User
from app.telegram.constants import WAITING_AUTH
from app.telegram.runtime import bot_module, logger


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = str(update.effective_chat.id)

    # Handle deep link: /start CODIGO (auto-linking from web)
    if context.args and len(context.args) == 1:
        key = context.args[0].strip()
        db = bot_module().SessionLocal()
        try:
            user = db.query(User).filter(User.telegram_key == key).first()
            if user:
                from app.services.encryption import compute_hmac

                # Check if key has expired (2 minutes)
                if user.telegram_key_expires and datetime.utcnow() > user.telegram_key_expires:
                    await update.message.reply_text(
                        "⏰ El código expiró. Generá uno nuevo desde la plataforma.",
                        parse_mode="HTML",
                    )
                    return ConversationHandler.END

                user.telegram_chat_id = chat_id
                user.telegram_chat_hash = compute_hmac(chat_id)
                user.telegram_key = None
                user.telegram_key_expires = None
                db.commit()
                db.refresh(user)

                frontend_url = os.getenv("FRONTEND_URL", "")
                reply_markup = None
                if frontend_url:
                    reply_markup = ReplyKeyboardMarkup(
                        [
                            [
                                KeyboardButton(
                                    "📱 Abrir Oikonomia", web_app=WebAppInfo(url=frontend_url)
                                )
                            ]
                        ],
                        resize_keyboard=True,
                    )
                await update.message.reply_text(
                    f"🎉 ¡Listo, <b>{user.full_name}</b>! Tu cuenta está conectada.\n\n"
                    "Ahora podés:\n"
                    "• Mandarme gastos directamente\n"
                    "• Usar el botón de abajo para abrir Oikonomia\n"
                    "• Escribir /ayuda para ver todos los comandos",
                    parse_mode="HTML",
                    reply_markup=reply_markup,
                )
                return ConversationHandler.END
            else:
                await update.message.reply_text(
                    "❌ Código inválido o ya usado. Generá uno nuevo desde la plataforma.",
                    parse_mode="HTML",
                )
                return ConversationHandler.END
        finally:
            db.close()

    # No deep link argument — existing behavior
    db = bot_module().SessionLocal()
    try:
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
        if user:
            frontend_url = os.getenv("FRONTEND_URL", "")
            reply_markup = None
            if frontend_url:
                reply_markup = ReplyKeyboardMarkup(
                    [[KeyboardButton("📱 Abrir Oikonomia", web_app=WebAppInfo(url=frontend_url))]],
                    resize_keyboard=True,
                )
            await update.message.reply_text(
                f"¡Hola <b>{user.full_name}</b>! 👋 ¿Qué gastaste hoy?\n\n"
                "💡 Mandame un gasto o usá /ayuda para ver los comandos disponibles.",
                parse_mode="HTML",
                reply_markup=reply_markup,
            )
            return ConversationHandler.END
    finally:
        db.close()

    await update.message.reply_text(
        "👋 ¡Hola! Soy *NikoFin*, tu asistente de finanzas personales.\n\n"
        "¿Qué puedo hacer?\n"
        "• Registrá gastos con lenguaje natural\n"
        "• Te muestro resúmenes semanales y mensuales\n"
        "• Te aviso de suscripciones y vencimientos\n"
        "• Categorizo automáticamente con IA\n\n"
        "Para empezar, ingresá tu clave de 12 caracteres.\n"
        "La encontrás en la app → Configuración → Telegram Bot.",
        parse_mode="HTML",
    )
    return WAITING_AUTH


async def handle_auth(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    key = update.message.text.strip()
    chat_id = str(update.effective_chat.id)
    db = bot_module().SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_key == key).first()
        if not user:
            await update.message.reply_text("Clave incorrecta. Intentá de nuevo.")
            return WAITING_AUTH
        user.telegram_chat_id = chat_id
        from app.services.encryption import compute_hmac

        user.telegram_chat_hash = compute_hmac(chat_id)
        logger.info(
            "Telegram link: user_id=%s, chat_id=%s (type=%s), hash_prefix=%s",
            user.id,
            chat_id,
            type(chat_id).__name__,
            user.telegram_chat_hash[:16],
        )
        user.telegram_key = None  # Invalidate key after use
        db.commit()
        db.refresh(user)
        frontend_url = os.getenv("FRONTEND_URL", "")
        reply_markup = None
        if frontend_url:
            reply_markup = ReplyKeyboardMarkup(
                [[KeyboardButton("📱 Abrir Oikonomia", web_app=WebAppInfo(url=frontend_url))]],
                resize_keyboard=True,
            )
        await update.message.reply_text(
            f"🎉 ¡Listo, <b>{user.full_name}</b>! Tu cuenta está conectada.\n\n"
            "Mandame un gasto como le dirías a un amigo:\n"
            '• _"gasté 1500 en farmacity"_\n'
            '• _"uber 3200 ayer"_\n'
            '• _"Netflix U$S 5"_\n\n'
            "📌 <b>Comandos disponibles:</b>\n"
            "/gastos — Ver gastos del mes\n"
            "/presupuesto — Ver presupuestos\n"
            "/deshacer — Deshacer el último gasto\n"
            "/suscripciones — Ver suscripciones\n"
            "/inversiones — Ver inversiones\n"
            "/cuotas — Ver cuotas pendientes\n"
            "/ayuda — Ver todos los comandos",
            parse_mode="HTML",
            reply_markup=reply_markup,
        )
        return ConversationHandler.END
    finally:
        db.close()


_HELP_TEXT = (
    "📝 <b>Así registrás tus gastos con NikoFin:</b>\n\n"
    "Escribime de forma natural — 1 mensaje = 1 gasto guardado:\n"
    '• <i>"farmacity 3200"</i>\n'
    '• <i>"almuerzo con el equipo 8500 pesos"</i>\n'
    '• <i>"uber ayer 1800"</i>\n'
    '• <i>"Netflix U$S 5"</i>\n'
    '• <i>"cargué nafta 15000 el viernes"</i>\n\n'
    "🔔 <b>O reenviame notificaciones de tu banco:</b>\n"
    '• <i>"Compra aprobada Visa ****4521 $15.200 Supermercado"</i>\n'
    '• <i>"Débito Mastercard ****1234 $8.500 Netflix"</i>\n\n'
    "Si mencionás una tarjeta o cuenta, la detecto automáticamente.\n\n"
    "📌 <b>Comandos disponibles:</b>\n"
    "/start — Iniciar o reconectar\n"
    "/gastos — Ver gastos del mes\n"
    "/presupuesto — Ver presupuestos\n"
    "/editar — Editar un gasto reciente\n"
    "/deshacer — Deshacer el último gasto\n"
    "/suscripciones — Ver suscripciones\n"
    "/inversiones — Ver inversiones\n"
    "/cuotas — Ver cuotas pendientes\n"
    "/cancelar — Cancelar operación actual\n"
    "/ayuda — Mostrar esta ayuda"
)


async def _validate_session(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Validate that the user's session is still active. Returns True if valid."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user or user.id != context.user_data.get("user_id"):
        query = update.callback_query
        await query.answer()
        await query.edit_message_text(
            "🔒 Tu sesión fue desconectada desde la web.\nUsá /start para reconectarte."
        )
        return False
    return True


def _authenticated_user(update: Update) -> User | None:
    chat = update.effective_chat
    if chat is None:
        return None
    return bot_module()._get_user_by_chat_id(str(chat.id))
