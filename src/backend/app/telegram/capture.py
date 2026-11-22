"""Image, voice and bank-notification capture handlers."""

import asyncio
import time
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from app.models import Category, Tag
from app.services.capture import MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, sanitize_card_hint
from app.telegram.auth import _validate_session
from app.telegram.constants import BUE
from app.telegram.formatting import (
    _cat_levels_from_categories,
    _format_amount,
    _saved_batch_text,
)
from app.telegram.parsing import (
    _match_account_from_text,
    _match_card_from_notification,
    _match_cuenta_tag_from_text,
    _normalize_card_type,
)
from app.telegram.persistence import _installment_args
from app.telegram.report_handlers import _chunk_message
from app.telegram.runtime import bot_module, logger


async def handle_expense_image(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Extract one or more expense drafts from a Telegram photo or image document."""
    msg = update.message
    if not msg:
        return ConversationHandler.END

    user = bot_module()._get_user_by_chat_id(str(update.effective_chat.id))
    if not user:
        await msg.reply_text("Primero autentificate con /start.")
        return ConversationHandler.END
    user_id = user.id
    context.user_data["user_id"] = user_id

    try:
        allowed = bot_module().check_rate_limit(f"capture:{user_id}", "capture")[0]
    except Exception:
        allowed = True
    if not allowed:
        await msg.reply_text(
            "Alcanzaste el límite de capturas por ahora. Probá de nuevo más tarde."
        )
        return ConversationHandler.END

    if msg.photo:
        media = msg.photo[-1]
        mime_type = "image/jpeg"
    elif msg.document and (msg.document.mime_type or "").lower().startswith("image/"):
        media = msg.document
        mime_type = (media.mime_type or "").lower()
    else:
        await msg.reply_text("Mandame una imagen JPEG, PNG o WebP como foto o archivo.")
        return ConversationHandler.END

    if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        await msg.reply_text(
            "Formato no compatible. Usá una imagen JPEG, PNG o WebP; HEIC no está disponible todavía."
        )
        return ConversationHandler.END

    if media.file_size is not None and media.file_size > bot_module().MAX_IMAGE_BYTES:
        await msg.reply_text("La imagen supera el límite de 8 MB. Mandame una más liviana.")
        return ConversationHandler.END

    try:
        telegram_file = await media.get_file()
        image_bytes = bytes(await telegram_file.download_as_bytearray())
    except Exception:
        logger.info(
            "[TELEGRAM_CAPTURE] source_type=%s reason=%s bytes=%d confidence=%s",
            "unknown",
            "download_error",
            0,
            "unknown",
        )
        await msg.reply_text("No pude descargar la imagen. Probá enviarla de nuevo.")
        return ConversationHandler.END

    if len(image_bytes) > bot_module().MAX_IMAGE_BYTES:
        await msg.reply_text("La imagen supera el límite de 8 MB. Mandame una más liviana.")
        return ConversationHandler.END

    try:
        result = await asyncio.to_thread(
            bot_module().extract_expense_from_image,
            image_bytes,
            mime_type=mime_type,
            hint=(msg.caption or "")[:300] or None,
            api_key_env="MESSAGES_BOT_LLM_API_KEY",
        )
    except Exception:
        logger.info(
            "[TELEGRAM_CAPTURE] source_type=%s reason=%s bytes=%d confidence=%s",
            "unknown",
            "provider_error",
            len(image_bytes),
            "unknown",
        )
        await msg.reply_text("No pude analizar la imagen. Probá de nuevo más tarde.")
        return ConversationHandler.END

    drafts = result.drafts
    source_type = drafts[0].source_type if drafts else "unknown"
    confidence = drafts[0].confidence if drafts else "unknown"
    logger.info(
        "[TELEGRAM_CAPTURE] source_type=%s reason=%s bytes=%d confidence=%s count=%d",
        source_type,
        result.reason or "none",
        len(image_bytes),
        confidence,
        len(drafts),
    )
    if result.status != "ok" or not drafts:
        await msg.reply_text(result.message)
        return ConversationHandler.END

    def _parsed_from_draft(draft) -> dict:
        if hasattr(draft, "model_dump"):
            draft_data = draft.model_dump(mode="json")
        else:
            from dataclasses import asdict, is_dataclass

            draft_data = asdict(draft) if is_dataclass(draft) else dict(draft)
        # Defense in depth: never persist or show a card number, even if a provider
        # (or an older extractor) echoes one in card_hint.
        draft_data["card_hint"] = sanitize_card_hint(draft_data.get("card_hint"))
        date_value = draft_data.get("date")
        if hasattr(date_value, "isoformat"):
            date_value = date_value.isoformat()
        return {
            "amount": draft_data["amount"],
            "description": draft_data["description"],
            "date": date_value or datetime.now(BUE).date().isoformat(),
            "currency": draft_data.get("currency", "ARS"),
        }

    db = bot_module().SessionLocal()
    saved = []
    saved_items = []
    failed = 0
    try:
        for draft in drafts:
            parsed = _parsed_from_draft(draft)
            try:
                predicted_category_id, cats = bot_module()._instant_categorize(parsed, user_id, db)
                cat_levels = _cat_levels_from_categories(predicted_category_id, cats)
                expense = bot_module()._save_expense(
                    parsed,
                    payment="",
                    person=update.effective_user.full_name if update.effective_user else "",
                    user_id=user_id,
                    predicted_category_id=predicted_category_id,
                    card_id=None,
                    account_id=None,
                    installment_total=draft.installment_total,
                    installment_number=draft.installment_number,
                    amount_is_total=draft.amount_kind != "installment",
                    log_content=False,
                )
                saved.append(expense)
                saved_items.append((expense, cat_levels))
            except Exception as exc:
                failed += 1
                logger.error(
                    "[TELEGRAM_CAPTURE] save_failed error_type=%s",
                    type(exc).__name__,
                )
    finally:
        db.close()

    if not saved:
        await msg.reply_text("No pude guardar el gasto. Revisá tus gastos antes de reintentar.")
        return ConversationHandler.END

    context.user_data["last_expense_id"] = saved[-1].id
    context.user_data["last_expense_time"] = time.time()

    if len(saved) == 1 and not failed:
        expense = saved[0]
        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "✏️ Editar",
                        callback_data=f"quickedit:{expense.id}",
                        style="primary",
                    )
                ]
            ]
        )
        await msg.reply_text(bot_module()._quick_saved_text(expense), reply_markup=keyboard)
        return ConversationHandler.END

    context.user_data["last_batch_ids"] = ",".join(str(expense.id) for expense in saved)
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "🗑 Deshacer todo",
                    callback_data="undobatch:last",
                )
            ]
        ]
    )
    text = _saved_batch_text(saved_items, failed=failed)
    for index, chunk in enumerate(_chunk_message(text)):
        await msg.reply_text(
            chunk,
            parse_mode="HTML",
            reply_markup=keyboard if index == 0 else None,
        )
    return ConversationHandler.END


async def handle_expense_image_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if not await _validate_session(update, context):
        return ConversationHandler.END
    parts = (query.data or "").split(":")
    if len(parts) != 3 or parts[0] != "expenseimg" or not parts[1] or not parts[2]:
        await query.edit_message_text("No pude reconocer esa opción. Mandame la imagen de nuevo.")
        return ConversationHandler.END
    _, draft_id, action = parts
    pending = context.user_data.get("pending_expense_image")
    if not pending:
        await query.edit_message_text("No hay un comprobante pendiente para revisar.")
        return ConversationHandler.END
    if pending.get("draft_id") != draft_id:
        await query.edit_message_text(
            "Este comprobante ya no está vigente. Mandá la imagen de nuevo."
        )
        return ConversationHandler.END

    if action == "edit":
        context.user_data.pop("pending_expense_image", None)
        await query.edit_message_text(
            "Mandame el gasto corregido, por ejemplo: supermercado 15200."
        )
        return ConversationHandler.END
    if action == "cancel":
        context.user_data.pop("pending_expense_image", None)
        await query.edit_message_text("Cancelado.")
        return ConversationHandler.END
    if action != "save":
        await query.edit_message_text("No pude reconocer esa opción. Mandame la imagen de nuevo.")
        return ConversationHandler.END

    user_id = context.user_data.get("user_id")
    if not user_id:
        context.user_data.pop("pending_expense_image", None)
        await query.edit_message_text("Primero autentificate con /start.")
        return ConversationHandler.END

    parsed = {
        "amount": pending["amount"],
        "description": pending["description"],
        "date": pending.get("date") or datetime.now(BUE).date().isoformat(),
        "currency": pending.get("currency", "ARS"),
    }
    db = bot_module().SessionLocal()
    try:
        predicted_category_id, categories = bot_module()._instant_categorize(parsed, user_id, db)
        expense = bot_module()._save_expense(
            parsed,
            payment="",
            person=update.effective_user.full_name if update.effective_user else "",
            user_id=user_id,
            predicted_category_id=predicted_category_id,
            card_id=None,
            account_id=None,
            log_content=False,
        )
    except Exception as exc:
        logger.error(
            "[TELEGRAM_CAPTURE] save_failed error_type=%s",
            type(exc).__name__,
        )
        context.user_data.pop("pending_expense_image", None)
        await query.edit_message_text(
            "No pude confirmar si el gasto se guardó. Revisá tus gastos antes de reintentar."
        )
        return ConversationHandler.END
    finally:
        db.close()

    category = next((cat for cat in categories if cat.id == expense.category_id), None)
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "✏️ Editar",
                    callback_data=f"quickedit:{expense.id}",
                    style="primary",
                )
            ]
        ]
    )
    context.user_data["last_expense_id"] = expense.id
    context.user_data["last_expense_time"] = time.time()
    context.user_data.pop("pending_expense_image", None)
    await query.edit_message_text(
        bot_module()._quick_saved_text(expense, category.name if category else None, []),
        reply_markup=keyboard,
    )
    return ConversationHandler.END


async def _handle_bank_notification(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
    *,
    log_content: bool = True,
) -> int:
    parsed = await asyncio.to_thread(
        bot_module()._parse_bank_notification, text, log_content=log_content
    )

    if not parsed or not parsed.get("amount"):
        if log_content:
            logger.warning(
                "[BANK_PARSE] Failed to parse bank notification — chat_id=%s text=%s",
                str(update.effective_chat.id),
                text[:200],
            )
        else:
            logger.warning("[BANK_PARSE] Could not parse private message")
        await update.message.reply_text(
            "🔔 Notificación bancaria detectada pero no pude parsear el monto.\n"
            "Probá de nuevo o escribí el gasto manualmente.",
            parse_mode="HTML",
        )
        return ConversationHandler.END

    user_id = context.user_data["user_id"]
    db = bot_module().SessionLocal()
    try:
        card = _match_card_from_notification(
            user_id,
            parsed.get("bank"),
            parsed.get("card_type"),
            parsed.get("card_name"),
            db,
            log_content=log_content,
        )

        card_id = None
        account_id = None
        matched_tag_ids = []
        payment_tag_name = None

        if card:
            card_id = card.id
        elif _normalize_card_type(parsed.get("card_type")) == "debito" and parsed.get("bank"):
            account = _match_account_from_text(text, user_id, db)
            if account:
                account_id = account.id

        # Fallback: match against 'cuenta' tags via HMAC
        if not card_id and not account_id:
            matched_tag = _match_cuenta_tag_from_text(
                parsed.get("card_name"),
                parsed.get("bank"),
                user_id,
                db,
                text=text,
                card_type=parsed.get("card_type"),
            )
            if matched_tag:
                card_id = matched_tag.card_id
                account_id = matched_tag.account_id
                matched_tag_ids = [matched_tag.id]
                if log_content:
                    logger.info(
                        "[BANK_PARSE] matched cuenta tag: id=%d card_id=%s account_id=%s",
                        matched_tag.id,
                        card_id,
                        account_id,
                    )

        # Fallback tag name from bank+card_name text when nothing matched
        if not card_id and not account_id and not matched_tag_ids:
            bank_info = parsed.get("bank", "")
            card_name_info = parsed.get("card_name", "")
            tag_name = f"{bank_info} {card_name_info}".strip()
            if tag_name:
                payment_tag_name = tag_name

        predicted_category_id, cats = bot_module()._instant_categorize(parsed, user_id, db)

        expense = bot_module()._save_expense(
            parsed,
            payment="",
            person=update.effective_user.full_name or "",
            user_id=user_id,
            predicted_category_id=predicted_category_id,
            card_id=card_id,
            account_id=account_id,
            tag_ids=matched_tag_ids or None,
            payment_tag_name=payment_tag_name,
            log_content=log_content,
            **_installment_args(parsed),
        )

        cat = (
            db.query(Category).filter(Category.id == expense.category_id).first()
            if expense.category_id
            else None
        )
        # Fetch assigned tags (excluding category mirrors)
        expense_tags = []
        if expense.id:
            from app.models import ExpenseTag

            expense_tags = (
                db.query(Tag)
                .join(ExpenseTag, ExpenseTag.tag_id == Tag.id)
                .filter(ExpenseTag.expense_id == expense.id, Tag.group_name != "categoria")
                .all()
            )
        context.user_data["last_expense_id"] = expense.id
        context.user_data["last_expense_time"] = time.time()

        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "✏️ Editar",
                        callback_data=f"quickedit:{expense.id}",
                        style="primary",
                    )
                ]
            ]
        )
        await update.message.reply_text(
            bot_module()._quick_saved_text(expense, cat.name if cat else None, expense_tags),
            reply_markup=keyboard,
        )
        return ConversationHandler.END
    except Exception as e:
        if log_content:
            logger.error("Error saving bank notification expense: %s", e, exc_info=True)
        else:
            logger.error("Error saving private bank notification expense (%s)", type(e).__name__)
        try:
            amount_str = _format_amount(
                float(parsed.get("amount", 0)), parsed.get("currency", "ARS")
            )
            await update.message.reply_text(
                f"⚠️ Notificación bancaria recibida ({amount_str}) pero hubo un error al guardarla.\n"
                f"Intentá registrar el gasto manualmente.",
                parse_mode="HTML",
            )
        except Exception:
            pass
        return ConversationHandler.END
    finally:
        db.close()


async def handle_voice_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    media = update.message.voice or update.message.audio
    auth_user = bot_module()._authenticated_user(update)
    if not auth_user:
        await update.message.reply_text("Primero autenticate con /start.")
        return ConversationHandler.END

    try:
        allowed, _ = bot_module().check_rate_limit(f"capture:{auth_user.id}", "capture")
    except Exception:
        # Capture remains available during a Redis outage, as with the API limiter.
        logger.warning("Could not check Telegram voice capture rate limit; allowing capture")
        allowed = True
    if not allowed:
        await update.message.reply_text("Demasiadas capturas, probá en un rato")
        return ConversationHandler.END

    duration = getattr(media, "duration", None)
    try:
        duration_hint = float(duration) if duration is not None else None
    except (TypeError, ValueError):
        duration_hint = None
    if duration_hint is not None and duration_hint > MAX_AUDIO_SECONDS:
        await update.message.reply_text("El audio no puede durar más de 120 segundos.")
        return ConversationHandler.END

    announced_size = getattr(media, "file_size", None)
    if announced_size is not None and announced_size > MAX_AUDIO_BYTES:
        await update.message.reply_text("El audio supera el límite de 10 MB.")
        return ConversationHandler.END

    try:
        telegram_file = await context.bot.get_file(media.file_id)
        data = bytes(await telegram_file.download_as_bytearray())
        if len(data) > MAX_AUDIO_BYTES:
            await update.message.reply_text("El audio supera el límite de 10 MB.")
            return ConversationHandler.END

        filename = getattr(media, "file_name", None)
        mime_type = getattr(media, "mime_type", None)
        extensions = {
            "ogg": ("ogg", "audio/ogg"),
            "opus": ("ogg", "audio/opus"),
            "wav": ("wav", "audio/wav"),
            "mp3": ("mp3", "audio/mpeg"),
            "m4a": ("m4a", "audio/mp4"),
        }
        if not filename:
            extension = next(
                (
                    ext
                    for ext, (_, supported_mime) in extensions.items()
                    if supported_mime == mime_type
                ),
                "ogg" if update.message.voice else "audio",
            )
            filename = f"voice.{extension}"
        if not mime_type:
            extension = filename.rsplit(".", maxsplit=1)[-1].lower()
            mime_type = extensions.get(
                extension, ("", "audio/ogg" if update.message.voice else "application/octet-stream")
            )[1]

        result = await asyncio.to_thread(
            bot_module().transcribe_audio,
            data=data,
            filename=filename,
            mime_type=mime_type,
            duration_hint=duration_hint,
            api_key_env="MESSAGES_BOT_LLM_API_KEY",
        )
    except Exception as exc:
        logger.warning("Telegram voice transcription failed (%s)", type(exc).__name__)
        await update.message.reply_text("No pude procesar el audio. Probá de nuevo.")
        return ConversationHandler.END

    text = (result.text or "").strip()
    if result.unclear or not text:
        await update.message.reply_text("No pude entender el audio. Probá de nuevo.")
        return ConversationHandler.END

    return await bot_module()._process_text_expense(update, context, text=text, source="voice")
