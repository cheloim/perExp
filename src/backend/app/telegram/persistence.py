"""Expense persistence and user payment-method summaries."""

import uuid
from datetime import datetime

from app.models import Account, Card, Category, Expense, ExpenseTag, Tag, User
from app.services.categorization import auto_categorize
from app.services.encryption import compute_hmac
from app.services.import_utils import _normalize_text
from app.services.installments import create_future_installments, split_installments
from app.telegram.constants import BUE
from app.telegram.runtime import bot_module, logger


def _find_or_create_tag(db, user_id: int, tag_name: str, card_id=None, account_id=None) -> Tag:
    from app.services.tag_sync import get_or_create_payment_tag, pick_tag_color

    if card_id is not None:
        from app.models import Card

        card = db.query(Card).filter(Card.id == card_id).first()
        if card:
            return get_or_create_payment_tag(db, user_id, card=card)
    if account_id is not None:
        from app.models import Account

        account = db.query(Account).filter(Account.id == account_id).first()
        if account:
            return get_or_create_payment_tag(db, user_id, account=account)

    name_hmac = compute_hmac(tag_name.strip().lower())
    existing = (
        db.query(Tag)
        .filter(
            Tag.user_id == user_id,
            Tag.name_hmac == name_hmac,
            Tag.group_name != "categoria",
        )
        .first()
    )
    if existing:
        return existing

    color = pick_tag_color(db, user_id)
    tag = Tag(
        name=tag_name,
        name_hmac=name_hmac,
        color=color,
        group_name="otros",
        user_id=user_id,
    )
    db.add(tag)
    db.flush()
    return tag


def _get_accounts(user_id: int) -> list[dict]:
    """Returns list of account dicts for the authenticated user."""
    db = bot_module().SessionLocal()
    try:
        accounts = db.query(Account).filter(Account.user_id == user_id).all()
        return [{"id": a.id, "name": a.name, "type": a.type} for a in accounts]
    finally:
        db.close()


def _get_card_options(user_id: int) -> dict:
    """Returns {bank: [card_name, ...]} from Card table for the authenticated user."""
    db = bot_module().SessionLocal()
    try:
        cards = db.query(Card).filter(Card.user_id == user_id).all()
        result: dict = {}
        for card in cards:
            bank = card.bank or "Sin banco"
            result.setdefault(bank, []).append(card.card_name)
        return {b: sorted(cards) for b, cards in result.items()}
    finally:
        db.close()


def _save_expense(
    parsed: dict,
    payment: str,
    person: str,
    bank: str = "",
    card: str = "",
    user_id: int | None = None,
    installment_total: int | None = None,
    installment_group_id: str | None = None,
    installment_number: int | None = None,
    amount_is_total: bool = True,
    predicted_category_id: int | None = None,
    account_id: int | None = None,
    card_id: int | None = None,
    tag_ids: list[int] | None = None,
    payment_tag_name: str | None = None,
    log_content: bool = True,
) -> Expense:
    db = bot_module().SessionLocal()
    try:
        if predicted_category_id is not None:
            category_id = predicted_category_id
        else:
            cats = db.query(Category).all()
            category_id = auto_categorize(parsed.get("description", ""), cats)

        raw_date = parsed.get("date") or datetime.now(BUE).date().strftime("%Y-%m-%d")
        try:
            expense_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            expense_date = datetime.now(BUE).date()

        raw_amount = float(parsed.get("amount") or 0)
        start_number: int | None = None
        future_amounts: list[tuple[int, float]] = []
        if installment_total and 2 <= installment_total <= 60:
            start_number = installment_number or 1
            if start_number < 1 or start_number > installment_total:
                start_number = 1
            if amount_is_total:
                plan = split_installments(raw_amount, installment_total, start=start_number)
                installment_amount = plan[0][1]
                future_amounts = plan[1:]
            else:
                installment_amount = raw_amount
                future_amounts = [
                    (number, raw_amount)
                    for number in range(start_number + 1, installment_total + 1)
                ]
            installment_group_id = installment_group_id or str(uuid.uuid4())
        else:
            installment_total = None
            installment_amount = raw_amount

        expense = Expense(
            date=expense_date,
            description=_normalize_text(parsed.get("description", "")),
            description_hmac=compute_hmac(_normalize_text(parsed.get("description", ""))),
            amount=installment_amount,
            currency=parsed.get("currency", "ARS"),
            category_id=category_id,
            user_id=user_id,
            installment_number=start_number if installment_total else None,
            installment_total=installment_total,
            installment_group_id=installment_group_id,
            account_id=account_id,
            card_id=card_id,
        )
        db.add(expense)
        db.flush()  # Assign ID without committing
        if future_amounts:
            create_future_installments(
                db,
                expense=expense,
                installment_total=installment_total or 0,
                amounts=future_amounts,
            )
        if log_content:
            logger.info(
                "[SAVE_EXPENSE] id=%d card_id=%s account_id=%s tag_ids=%s payment_tag_name=%s",
                expense.id,
                card_id,
                account_id,
                tag_ids,
                payment_tag_name,
            )

        from app.services.tag_sync import sync_category_tag

        sync_category_tag(db, expense, expense.category_id)

        # Create payment tag in this session if card/account is set but
        # caller didn't pass tag_ids (avoids cross-session visibility bug)
        if not tag_ids and (card_id is not None or account_id is not None):
            tag = _find_or_create_tag(db, user_id, "", card_id=card_id, account_id=account_id)
            if tag:
                tag_ids = [int(tag.id)]
        elif not tag_ids and payment_tag_name:
            from app.services.tag_sync import get_or_create_payment_tag

            tag = get_or_create_payment_tag(db, user_id, name_hint=payment_tag_name)
            if tag:
                tag_ids = [int(tag.id)]

        if tag_ids:
            # Validate tags exist before inserting to avoid FK violations
            valid_tag_ids = []
            for tid in tag_ids:
                tag_exists = db.query(Tag).filter(Tag.id == tid).first()
                if tag_exists:
                    valid_tag_ids.append(tid)
                else:
                    logger.warning(f"Tag {tid} not found, skipping")

            for tid in valid_tag_ids:
                db.add(ExpenseTag(expense_id=expense.id, tag_id=tid))

        # Link to recurring expense if matches
        from app.services.recurring_linker import link_to_recurring

        try:
            link_to_recurring(expense.id, expense.description, user_id, db)
        except Exception as e:
            if log_content:
                logger.warning("Failed to link recurring: %s", e)
            else:
                logger.warning(
                    "Failed to link recurring for private expense (%s)", type(e).__name__
                )

        # Single atomic commit for expense + tags + recurring linkage
        db.commit()
        db.refresh(expense)

        # Resolve up to 3 levels: cat → parent → grandparent
        expense._cat_levels = []
        if expense.category_id:
            cat = db.query(Category).filter(Category.id == expense.category_id).first()
            if cat:
                levels = [cat.name]
                node = cat
                while node.parent_id:
                    node = db.query(Category).filter(Category.id == node.parent_id).first()
                    if not node:
                        break
                    levels.append(node.name)
                expense._cat_levels = list(reversed(levels))

        # Keep the tags on the instance so every saved-message path can render
        # the account and custom tags without opening another session.
        expense._tags = (
            db.query(Tag)
            .join(ExpenseTag, ExpenseTag.tag_id == Tag.id)
            .filter(ExpenseTag.expense_id == expense.id)
            .all()
        )

        # Budget threshold check (non-blocking)
        if expense.category_id and user_id:
            try:
                from app.services.budget_helpers import check_budget_threshold_on_expense

                check_budget_threshold_on_expense(db, user_id, expense.category_id, expense.amount)
            except Exception as e:
                if log_content:
                    logger.warning("Budget threshold check failed: %s", e)
                else:
                    logger.warning(
                        "Budget threshold check failed for private expense (%s)", type(e).__name__
                    )

        return expense
    finally:
        db.close()


def _installment_args(parsed: dict) -> dict:
    """Translate parser output into _save_expense installment arguments.

    ``amount_kind`` is authoritative when the model returns it. Otherwise a
    current installment number above 1 means the amount is per-installment; a
    first installment means the amount is the purchase total.
    """
    raw_total = parsed.get("installment_total")
    try:
        total = int(raw_total)
    except (TypeError, ValueError):
        return {}
    if total < 2 or total > 60:
        return {}
    try:
        number = int(parsed.get("installment_number") or 1)
    except (TypeError, ValueError):
        number = 1
    if number < 1 or number > total:
        number = 1
    kind = parsed.get("amount_kind")
    if kind == "total":
        amount_is_total = True
    elif kind == "installment":
        amount_is_total = False
    else:
        amount_is_total = number <= 1
    return {
        "installment_total": total,
        "installment_number": number,
        "amount_is_total": amount_is_total,
    }


def _should_ask_installments(
    category_id: int | None, db, amount: float = 0, card_type: str = ""
) -> bool:
    """
    Returns True if category matches installment rules OR
    amount > 10000 on a credit card.
    """
    # Category-based check
    if category_id:
        category = db.query(Category).filter(Category.id == category_id).first()
        if category:
            if category.parent_id is None:
                if category.name in ("Viajes", "Educación", "Indumentaria"):
                    return True
            else:
                parent = db.query(Category).filter(Category.id == category.parent_id).first()
                if parent and parent.name in (
                    "Mantenimiento",
                    "Mobiliario",
                    "Viajes",
                    "Educación",
                    "Indumentaria",
                ):
                    return True

    # Amount + card type check
    return card_type == "credito" and amount > 10000


def _get_user_by_chat_id(chat_id: str) -> User | None:
    db = bot_module().SessionLocal()
    try:
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        return db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
    finally:
        db.close()
