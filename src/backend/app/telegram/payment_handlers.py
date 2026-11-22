"""Payment method, installment, account and card conversation handlers."""

import uuid

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from app.models import Account, Card, User
from app.services.bot_reports import build_cat_levels as _build_cat_levels
from app.services.encryption import compute_hmac
from app.telegram.auth import _validate_session
from app.telegram.constants import (
    WAITING_ACCOUNT_CREATE_NAME,
    WAITING_ACCOUNT_CREATE_TYPE,
    WAITING_ACCOUNT_SELECT,
    WAITING_CARD_BANK,
    WAITING_CARD_CREATE_CHOICE,
    WAITING_CARD_CREATE_CONFIRM,
    WAITING_CARD_CREATE_NAME,
    WAITING_CARD_CREATE_TYPE,
    WAITING_CARD_MANUAL,
    WAITING_CARD_TYPE,
    WAITING_CONFIRM,
    WAITING_INSTALLMENT_NUMBER,
    WAITING_INSTALLMENT_QUESTION,
)
from app.telegram.formatting import _confirm_text, _escape_html
from app.telegram.persistence import _get_accounts, _get_card_options, _should_ask_installments
from app.telegram.runtime import bot_module


async def handle_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, method = query.data.split(":", 1)
    context.user_data["payment_method"] = method

    if method == "efectivo_transferencia":
        # Show accounts list or prompt to create one
        user_id = context.user_data.get("user_id")
        accounts = _get_accounts(user_id) if user_id else []

        if not accounts:
            await query.edit_message_text(
                "🏦 *No tenés cuentas registradas*\n\n"
                "Para registrar gastos en efectivo o transferencia necesitás crear una cuenta primero.\n\n"
                "📝 *¿Qué nombre le ponemos a tu cuenta?*\n\n"
                "Ejemplos:\n"
                "• _Efectivo_ — para pagos en efectivo\n"
                "• _MercadoPago_ — billetera digital\n"
                "• _Cuenta Galicia_ — cuenta bancaria\n"
                "• _Cuenta USD_ — ahorros en dólares\n\n"
                "💡 Podés cambiar el nombre después desde la web.",
                parse_mode="HTML",
            )
            return WAITING_ACCOUNT_CREATE_NAME

        # Show accounts list
        keyboard = [
            [
                InlineKeyboardButton(
                    f"{acc['name']} ({acc['type']})", callback_data=f"account:{acc['id']}"
                )
            ]
            for acc in accounts
        ]
        keyboard.append(
            [InlineKeyboardButton("➕ Crear nueva cuenta", callback_data="account:new")]
        )
        keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="cancel")])

        await query.edit_message_text(
            "💰 ¿Desde qué cuenta?",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_ACCOUNT_SELECT

    # Tarjeta — show banks filtered by user
    user_id = context.user_data.get("user_id")
    card_options = _get_card_options(user_id) if user_id else {}
    context.user_data["card_options"] = card_options

    if not card_options:
        keyboard = [
            [InlineKeyboardButton("➕ Crear nueva tarjeta", callback_data="cardnew:new")],
            [InlineKeyboardButton("✏️ Ingresar nombre manualmente", callback_data="cardnew:manual")],
        ]
        await query.edit_message_text(
            "💳 *No tenés tarjetas registradas*\n\n¿Qué preferís?",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_CARD_CREATE_CHOICE

    banks = sorted(card_options.keys())
    keyboard = [[InlineKeyboardButton(b, callback_data=f"bank:{b}")] for b in banks]
    keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="cancel")])
    await query.edit_message_text("💳 ¿Qué banco?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_BANK


async def handle_payment_none(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    context.user_data["payment_method"] = "none"
    context.user_data.pop("card_id", None)
    context.user_data.pop("account_id", None)
    context.user_data["payment_label"] = ""

    db = bot_module().SessionLocal()
    try:
        parsed = context.user_data.get("parsed")
        predicted_category_id, cats = bot_module()._instant_categorize(
            parsed, context.user_data["user_id"], db
        )
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], "", cat_levels),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_card_bank(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    bank = query.data.split(":", 1)[1]
    context.user_data["card_bank"] = bank

    card_options = context.user_data.get("card_options", {})
    cards = card_options.get(bank, [])

    if not cards:
        await query.edit_message_text(
            f"No encontré tarjetas de {bank} registradas.\n"
            "¿Cómo se llama la tarjeta? Escribila, por ejemplo: _Visa_ o _Mastercard_.",
            parse_mode="HTML",
        )
        return WAITING_CARD_MANUAL

    keyboard = [[InlineKeyboardButton(card, callback_data=f"card:{card}")] for card in cards]
    keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="cancel")])
    await query.edit_message_text("💳 ¿Qué tarjeta?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_TYPE


async def handle_card_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    parts = query.data.split(":", 1)
    card = parts[1]
    bank = context.user_data.get("card_bank", "")

    label = f"{bank} {card}"
    context.user_data["card_selected"] = card
    context.user_data["payment_label"] = label

    # Look up card_id from DB so the expense is linked to the card
    db_card = bot_module().SessionLocal()
    try:
        all_cards = db_card.query(Card).filter(Card.user_id == context.user_data["user_id"]).all()
        card_obj = next(
            (
                c
                for c in all_cards
                if c.card_name
                and c.card_name.lower() == card.lower()
                and c.bank
                and c.bank.lower() == bank.lower()
            ),
            None,
        )
        if card_obj:
            context.user_data["card_id"] = card_obj.id
    finally:
        db_card.close()

    # Run early categorization to determine if we need to ask about installments
    parsed = context.user_data["parsed"]
    db = bot_module().SessionLocal()
    try:
        predicted_category_id, cats = bot_module()._instant_categorize(
            parsed, context.user_data["user_id"], db
        )
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""

        # Check if we should ask about installments
        card_type = card_obj.card_type if card_obj else ""
        amount = parsed.get("amount", 0) if parsed else 0
        if _should_ask_installments(predicted_category_id, db, amount, card_type):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await query.edit_message_text(
                "¿Lo pagaste en cuotas?",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            # No installments needed, go straight to confirmation
            cat_levels = _build_cat_levels(predicted_category_id, db)
            confirm_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                ]
            ]
            await query.edit_message_text(
                _confirm_text(parsed, label, cat_levels),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            return WAITING_CONFIRM
    finally:
        db.close()


async def handle_installment_question(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle yes/no response to '¿Lo pagaste en cuotas?'"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, answer = query.data.split(":", 1)

    if answer == "no":
        # No installments, go to confirmation
        payment_label = context.user_data.get("payment_label", "")
        predicted_category_id = context.user_data.get("predicted_category_id")
        db = bot_module().SessionLocal()
        try:
            cat_levels = _build_cat_levels(predicted_category_id, db)
        finally:
            db.close()
        confirm_keyboard = [
            [
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]
        ]
        await query.edit_message_text(
            _confirm_text(
                context.user_data["parsed"],
                payment_label,
                cat_levels,
                context.user_data.get("cat_debug", ""),
            ),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(confirm_keyboard),
        )
        return WAITING_CONFIRM

    # answer == "yes" - ask for number of installments
    await query.edit_message_text("¿Cuántas cuotas? (Escribí un número entre 2 y 60)")
    return WAITING_INSTALLMENT_NUMBER


async def handle_installment_number(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle numeric input for installment count"""
    text = update.message.text.strip()

    # Validate input is a valid integer between 2-60
    try:
        installments = int(text)
        if installments < 2 or installments > 60:
            await update.message.reply_text("Por favor, ingresá un número entre 2 y 60.")
            return WAITING_INSTALLMENT_NUMBER
    except ValueError:
        await update.message.reply_text(
            "No entendí. Por favor, escribí un número (por ejemplo: 12)"
        )
        return WAITING_INSTALLMENT_NUMBER

    # Generate unique group ID for this installment series
    installment_group_id = str(uuid.uuid4())

    # Store installment data in context
    context.user_data["installment_total"] = installments
    context.user_data["installment_group_id"] = installment_group_id

    # Show confirmation
    payment_label = context.user_data.get("payment_label", "")
    predicted_category_id = context.user_data.get("predicted_category_id")
    db = bot_module().SessionLocal()
    try:
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()
    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]

    await update.message.reply_text(
        _confirm_text(
            context.user_data["parsed"],
            payment_label,
            cat_levels,
            context.user_data.get("cat_debug", ""),
            installments,
        ),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_account_select(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle account selection or new account creation trigger"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, account_id = query.data.split(":", 1)

    if account_id == "new":
        await query.edit_message_text(
            "🏦 *Nueva Cuenta*\n\n"
            "📝 ¿Qué nombre le ponemos?\n\n"
            "Ejemplos:\n"
            "• _Efectivo_\n"
            "• _MercadoPago_\n"
            "• _Cuenta Galicia_\n"
            "• _Cuenta USD_\n\n"
            "💡 Podés editar el nombre después desde la web.",
            parse_mode="HTML",
        )
        return WAITING_ACCOUNT_CREATE_NAME

    # Load account info and categorize
    db = bot_module().SessionLocal()
    try:
        account = (
            db.query(Account)
            .filter(
                Account.id == int(account_id),
                Account.user_id == context.user_data["user_id"],
            )
            .first()
        )
        if not account:
            await query.edit_message_text("Error: cuenta no encontrada.")
            return ConversationHandler.END

        context.user_data["account_id"] = account.id
        context.user_data["payment_label"] = f"{account.name} ({account.type})"

        # Instant keyword categorization
        parsed = context.user_data["parsed"]
        predicted_category_id, cats = bot_module()._instant_categorize(
            parsed, context.user_data["user_id"], db
        )
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    # Show confirmation
    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], context.user_data["payment_label"], cat_levels),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_account_create_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle new account name input"""
    account_name = update.message.text.strip()
    context.user_data["new_account_name"] = account_name

    # Ask for account type
    keyboard = [
        [InlineKeyboardButton("💵 Efectivo", callback_data="acctype:efectivo")],
        [InlineKeyboardButton("🏦 Cuenta Corriente", callback_data="acctype:cuenta_corriente")],
        [InlineKeyboardButton("💳 Caja de Ahorro", callback_data="acctype:caja_ahorro")],
        [InlineKeyboardButton("📱 MercadoPago / Billetera", callback_data="acctype:mercadopago")],
        [InlineKeyboardButton("💰 Otro", callback_data="acctype:otro")],
    ]
    await update.message.reply_text(
        f"✅ Perfecto, <b>{_escape_html(account_name)}</b>\n\nAhora elegí el tipo de cuenta:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return WAITING_ACCOUNT_CREATE_TYPE


async def handle_account_create_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle account type selection and create the account"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, account_type = query.data.split(":", 1)
    account_name = context.user_data.get("new_account_name", "Nueva cuenta")
    user_id = context.user_data.get("user_id")

    # Create account in DB
    db = bot_module().SessionLocal()
    try:
        new_account = Account(
            name=account_name,
            name_hmac=compute_hmac(account_name.strip().lower()),
            type=account_type,
            user_id=user_id,
        )
        db.add(new_account)
        db.commit()
        db.refresh(new_account)

        context.user_data["account_id"] = new_account.id
        context.user_data["payment_label"] = f"{new_account.name} ({new_account.type})"

        # Instant keyword categorization
        parsed = context.user_data["parsed"]
        predicted_category_id, cats = bot_module()._instant_categorize(
            parsed, context.user_data["user_id"], db
        )
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    # Show confirmation
    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], context.user_data["payment_label"], cat_levels),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_card_create_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Ask if user wants to create a new card when none exist"""
    query = update.callback_query
    await query.answer()

    _, choice = query.data.split(":", 1)

    if choice == "new":
        await query.edit_message_text(
            "💳 *Nueva Tarjeta*\n\nPrimero, elegí el tipo de tarjeta:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("💳 Crédito", callback_data="cardctype:credito")],
                    [InlineKeyboardButton("💰 Débito", callback_data="cardctype:debito")],
                ]
            ),
        )
        return WAITING_CARD_CREATE_TYPE

    return ConversationHandler.END


async def handle_card_create_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card type selection and ask for card name"""
    query = update.callback_query
    await query.answer()

    _, card_type = query.data.split(":", 1)
    context.user_data["new_card_type"] = card_type

    await query.message.reply_text(
        "📝 *Datos de la tarjeta*\n\n"
        "Escribí los datos como los ves en tus gastos:\n\n"
        "Ejemplos:\n"
        "• _Visa Galicia_\n"
        "• _Mastercard HSBC_\n"
        "• _Naranja_\n"
        "• _Mercado Pago_\n\n"
        "💡 Puedo detectar automáticamente la franquicia y el banco.",
        parse_mode="HTML",
    )
    return WAITING_CARD_CREATE_NAME


async def handle_card_create_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card name input, extract info with LLM, ask for confirmation"""
    raw_input = update.message.text.strip()
    card_type = context.user_data.get("new_card_type", "credito")

    db = bot_module().SessionLocal()
    try:
        chat_id = str(update.effective_chat.id)
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
        user_full_name = user.full_name if user else ""
    finally:
        db.close()

    extracted = bot_module()._extract_card_info(raw_input, card_type)
    card_name = extracted.get("card_name", raw_input)
    bank = extracted.get("bank", "")

    if user_full_name:
        if "," in user_full_name:
            parts = user_full_name.split(",")
            holder = parts[1].strip().split()[0] if len(parts) > 1 and parts[1].strip() else ""
        else:
            holder = user_full_name.split()[0] if user_full_name.split() else ""
    else:
        holder = ""

    context.user_data["new_card_name"] = card_name
    context.user_data["new_card_bank"] = bank
    context.user_data["new_card_holder"] = holder

    bank_display = bank if bank else "No detectado"

    await update.message.reply_text(
        "🔍 <b>Detectado</b>\n\n"
        f"💳 Tarjeta: <b>{_escape_html(card_name)}</b>\n"
        f"🏦 Banco: <b>{_escape_html(bank_display)}</b>\n"
        f"👤 Titular: <b>{_escape_html(holder)}</b>\n"
        f"💳 Tipo: <b>{_escape_html(card_type)}</b>\n\n"
        "¿Confirmás la creación de esta tarjeta?",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("✅ Sí, crear", callback_data="cardconfirm:yes")],
                [InlineKeyboardButton("❌ Cancelar", callback_data="cardconfirm:no")],
            ]
        ),
    )
    return WAITING_CARD_CREATE_CONFIRM


async def handle_card_create_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card creation confirmation"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, action = query.data.split(":", 1)

    if action == "no":
        await query.message.reply_text("❌ Creación de tarjeta cancelada.")
        return ConversationHandler.END

    card_name = context.user_data.get("new_card_name", "")
    bank = context.user_data.get("new_card_bank", "")
    card_type = context.user_data.get("new_card_type", "credito")

    chat_id = str(update.effective_chat.id)
    db = bot_module().SessionLocal()
    try:
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
        if not user:
            await query.message.reply_text("❌ Error: usuario no encontrado.")
            return ConversationHandler.END

        user_id = user.id
        user_full_name = user.full_name if user.full_name else ""

        if user_full_name:
            if "," in user_full_name:
                parts = user_full_name.split(",")
                holder = parts[1].strip().split()[0] if len(parts) > 1 and parts[1].strip() else ""
            else:
                holder = user_full_name.split()[0] if user_full_name.split() else ""
        else:
            holder = ""

        existing = (
            db.query(Card)
            .filter(
                Card.user_id == user_id,
                Card.card_name_hmac == compute_hmac(card_name.lower()),
                Card.bank_hmac == compute_hmac(bank.lower()),
            )
            .first()
        )
        if existing:
            await query.message.reply_text(
                "❌ Ya existe una tarjeta con ese nombre y banco. Probá con otro nombre.",
                parse_mode="HTML",
            )
            return ConversationHandler.END

        new_card = Card(
            card_name=card_name,
            card_name_hmac=compute_hmac(card_name.lower()),
            bank=bank,
            bank_hmac=compute_hmac(bank.lower()),
            holder=holder,
            card_type=card_type,
            user_id=user_id,
        )
        db.add(new_card)
        db.commit()

        context.user_data["card_selected"] = card_name
        context.user_data["card_bank"] = bank
        context.user_data["payment_label"] = f"{bank} {card_name}".strip() if bank else card_name
        context.user_data["card_id"] = new_card.id

        parsed = context.user_data["parsed"]
        predicted_category_id, cats = bot_module()._instant_categorize(
            parsed, context.user_data["user_id"], db
        )
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""

        if _should_ask_installments(
            predicted_category_id, db, parsed.get("amount", 0), new_card.card_type
        ):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await query.edit_message_text(
                f"✅ <b>Tarjeta {_escape_html(card_name)} creada!</b>\n\n¿Lo pagaste en cuotas?",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            cat_levels = _build_cat_levels(predicted_category_id, db)
            confirm_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                ]
            ]
            await query.edit_message_text(
                f"✅ <b>Tarjeta {_escape_html(card_name)} creada!</b>\n\n"
                + _confirm_text(parsed, context.user_data["payment_label"], cat_levels),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            return WAITING_CONFIRM
    finally:
        db.close()
