import hashlib
import io
import json
import re
from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd

_log = lambda msg: print(f"{datetime.now().isoformat()} {msg}")
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Expense
from app.services.date_utils import add_months, _normalize_date_str


def _strip_installment_suffix(desc: str) -> str:
    """Strip trailing installment suffixes and comprobante codes from description.

    Removes patterns like:
      - "-03/06" or "-C.03/06" (installment suffix with leading dash)
      - "-000-314" (comprobante suffix from some banks)
      - " C.03/06" or " 03/06" (trailing installment markers with leading space)
      - Embedded NN/NN at end without separator: "SA03/03", "TIENDA01/12"

    The goal is that "LA SEGUNDA COO0951898-03/06-000-314" and "LA SEGUNDA COO0951898"
    produce the same normalized description for proper grouping.
    """
    s = desc.strip()
    s = re.sub(r'-C\.\d{1,2}/\d{1,2}', '', s, flags=re.IGNORECASE)
    s = re.sub(r'-\d{2}/\d{2}', '', s)
    s = re.sub(r'\s+C\.\d{1,2}/\d{1,2}', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+\d{2}/\d{2}', '', s)
    s = re.sub(r'(?<=[A-Z]{2})\d{2}/\d{2}$', '', s)
    s = re.sub(r'-\d{3,}(?=-|$)', '', s)
    return s.strip()


def _normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = re.sub(r'\s*-\s*Pendiente\s*$', '', text.strip(), flags=re.IGNORECASE)
    result = cleaned.upper()
    if result:
        _log(f"[DEBUG NORMALIZE] '{text}' -> '{result}'")
    return result


def _title_case(text: Optional[str]) -> str:
    if not text:
        return ""
    result = text.strip().title()
    _log(f"[DEBUG TITLE_CASE] '{text}' -> '{result}'")
    return result


def _load_dataframe(content: bytes, filename: str) -> "pd.DataFrame":
    if filename.lower().endswith(".csv"):
        for sep in [",", ";", "\t"]:
            try:
                df = pd.read_csv(io.BytesIO(content), sep=sep)
                if len(df.columns) > 1:
                    return df
            except Exception:
                pass
        return pd.read_csv(io.BytesIO(content))
    return pd.read_excel(io.BytesIO(content))


def _detect_col(columns: list, hints: list) -> str:
    for col in columns:
        low = col.lower()
        if any(h in low for h in hints):
            return col
    return columns[0] if columns else ""


def _is_duplicate(
    db: Session,
    exp_date: date,
    amount: float,
    description: str,
    transaction_id: Optional[str] = None,
    installment_number: Optional[int] = None,
    installment_total: Optional[int] = None,
    installment_group_id: Optional[str] = None,
) -> bool:
    from app.models import ScheduledExpense

    if transaction_id:
        if installment_number and installment_total and installment_total >= 2:
            existing = db.query(Expense).filter(
                Expense.transaction_id == transaction_id,
                Expense.installment_number == installment_number,
                Expense.installment_total == installment_total,
            ).first()
            if existing:
                _log(f"[DUP by txn_id+installment] txn_id={transaction_id} inst={installment_number}/{installment_total} matched id={existing.id}")
                return True
            # Fall through to check ScheduledExpense and installment_group_id
        else:
            existing = db.query(Expense).filter(Expense.transaction_id == transaction_id).first()
            if existing:
                _log(f"[DUP by txn_id] txn_id={transaction_id} matched id={existing.id}")
                return True

        # Always check ScheduledExpense by installment_group_id if provided
        if installment_group_id:
            existing_scheduled = db.query(ScheduledExpense).filter(
                ScheduledExpense.installment_group_id == installment_group_id,
                ScheduledExpense.installment_number == installment_number,
                ScheduledExpense.installment_total == installment_total,
                ScheduledExpense.status == "PENDING"
            ).first()
            if existing_scheduled:
                _log(f"[DUP by txn_id+installment_group_id in ScheduledExpense] txn_id={transaction_id} inst={installment_number}/{installment_total} group_id={installment_group_id} matched id={existing_scheduled.id}")
                return True
        return False

    if installment_number and installment_total and installment_total >= 2:
        month_start = exp_date.replace(day=1)
        next_month = month_start.replace(day=28) + timedelta(days=4)
        month_end = next_month.replace(day=1) - timedelta(days=1)
        existing = db.query(Expense).filter(
            Expense.amount == amount,
            func.lower(Expense.description) == description.lower(),
            Expense.installment_number == installment_number,
            Expense.installment_total == installment_total,
            Expense.date >= month_start,
            Expense.date <= month_end,
        ).first()
        if existing:
            _log(f"[DUP by installment] amt={amount} desc={description} inst={installment_number}/{installment_total} month={month_start.strftime('%Y-%m')} matched id={existing.id}")
            return True

    q = db.query(Expense).filter(
        Expense.date == exp_date,
        Expense.amount == amount,
        func.lower(Expense.description) == description.lower(),
    )
    if installment_number is not None:
        q = q.filter(Expense.installment_number == installment_number)
    existing = q.first()
    if existing:
        _log(f"[DUP by triple] date={exp_date} amt={amount} desc={description} matched id={existing.id}")
        return True

    if installment_group_id:
        existing_scheduled = db.query(ScheduledExpense).filter(
            ScheduledExpense.installment_group_id == installment_group_id,
            ScheduledExpense.installment_number == installment_number,
            ScheduledExpense.installment_total == installment_total,
            ScheduledExpense.status == "PENDING"
        ).first()
        if existing_scheduled:
            _log(f"[DUP by installment_group_id in ScheduledExpense] group_id={installment_group_id} inst={installment_number}/{installment_total} matched id={existing_scheduled.id}")
            return True

    return False


def _is_scheduled_duplicate(
    db: Session,
    scheduled_date: date,
    amount: float,
    description: str,
    installment_number: int,
    installment_total: int,
    user_id: int,
    installment_group_id: Optional[str] = None,
) -> bool:
    """Verificar si ya existe una cuota programada duplicada"""
    from app.models import ScheduledExpense

    q = db.query(ScheduledExpense).filter(
        ScheduledExpense.user_id == user_id,
        ScheduledExpense.scheduled_date == scheduled_date,
        ScheduledExpense.installment_number == installment_number,
        ScheduledExpense.installment_total == installment_total,
        func.lower(ScheduledExpense.description) == description.lower(),
        ScheduledExpense.status == "PENDING"
    )
    if installment_group_id:
        q = q.filter(ScheduledExpense.installment_group_id == installment_group_id)
    return q.first() is not None


def _expand_installments(parsed: list, db: Session, user_id: int) -> tuple[list, list]:
    """
    Retorna: (expenses_to_create, scheduled_expenses_to_create)
    """
    from collections import defaultdict
    from datetime import date

    today = date.today()
    groups: dict = defaultdict(list)
    for r in parsed:
        inst_num = r.get("installment_number")
        inst_total = r.get("installment_total")
        d = r.get("_date_obj")
        if not inst_num or not inst_total or inst_total < 2 or not d:
            continue
        base_date = add_months(d, -(inst_num - 1))
        txn_id = r.get("transaction_id") or ""
        # Group by txn_id when available: Argentine statements share the same comprobante
        # across all installments of a purchase, so C.02/03 and C.03/03 with the same
        # txn_id must land in the same group to avoid cross-generating each other's rows.
        if txn_id:
            key = (_strip_installment_suffix(r["description"].lower()), inst_total, txn_id)
        else:
            key = (_strip_installment_suffix(r["description"].lower()), inst_total, base_date.strftime("%Y-%m"), r.get("person") or "")
        groups[key].append((r, base_date))

    expenses_extra: list = []
    scheduled_extra: list = []
    # Tracks already-generated slots to prevent cross-group duplicates within a batch.
    generated: set = set()

    for key, entries in groups.items():
        template, base_date = entries[0]
        desc_lower = _strip_installment_suffix(template["description"].lower())
        inst_total = template.get("installment_total")
        txn_id = template.get("transaction_id") or ""

        group_id = hashlib.md5("|".join(str(k) for k in key).encode()).hexdigest()[:12]

        inst_num = template.get("installment_number")
        present_nums: set = set()
        for r, _ in entries:
            r["installment_group_id"] = group_id
            present_nums.add(r["installment_number"])
            gen_key = (desc_lower, r["installment_number"], inst_total, txn_id) if txn_id \
                else (desc_lower, r["installment_number"], inst_total, r.get("_date_obj").strftime("%Y-%m") if r.get("_date_obj") else "")
            generated.add(gen_key)

        # Generate past installments (retrasados) - solo si fecha <= today
        for i in range(1, inst_num):
            if i in present_nums:
                continue
            charge_date = add_months(base_date, i - 1)

            # Saltear si es futura
            if charge_date > today:
                continue

            gen_key = (desc_lower, i, inst_total, txn_id) if txn_id \
                else (desc_lower, i, inst_total, charge_date.strftime("%Y-%m"))
            if gen_key in generated:
                continue
            if _is_duplicate(db, charge_date, template["amount"], template["description"],
                             transaction_id=txn_id or None,
                             installment_number=i, installment_total=inst_total,
                             installment_group_id=group_id):
                continue
            generated.add(gen_key)
            expenses_extra.append({
                "date": charge_date.strftime("%d-%m-%Y"),
                "_date_obj": charge_date,
                "description": template["description"],
                "amount": template["amount"],
                "currency": template.get("currency", "ARS"),
                "card": template.get("card", ""),
                "bank": template.get("bank", ""),
                "person": template.get("person", ""),
                "transaction_id": txn_id or None,
                "installment_number": i,
                "installment_total": inst_total,
                "installment_group_id": group_id,
                "_auto_generated": True,
            })

        # Generate future installments - separar expenses (<=today) de scheduled (>today)
        for i in range(inst_num + 1, inst_total + 1):
            if i in present_nums:
                continue
            charge_date = add_months(base_date, i - 1)
            gen_key = (desc_lower, i, inst_total, txn_id) if txn_id \
                else (desc_lower, i, inst_total, charge_date.strftime("%Y-%m"))
            if gen_key in generated:
                continue

            # Verificar duplicados en expenses
            if _is_duplicate(db, charge_date, template["amount"], template["description"],
                             transaction_id=txn_id or None,
                             installment_number=i, installment_total=inst_total,
                             installment_group_id=group_id):
                continue

            # Verificar duplicados en scheduled_expenses
            if _is_scheduled_duplicate(db, charge_date, template["amount"],
                                       template["description"], i, inst_total, user_id,
                                       installment_group_id=group_id):
                continue

            generated.add(gen_key)

            # DECISIÓN: pasado/presente vs futuro
            if charge_date <= today:
                # Crear en expenses
                expenses_extra.append({
                    "date": charge_date.strftime("%d-%m-%Y"),
                    "_date_obj": charge_date,
                    "description": template["description"],
                    "amount": template["amount"],
                    "currency": template.get("currency", "ARS"),
                    "card": template.get("card", ""),
                    "bank": template.get("bank", ""),
                    "person": template.get("person", ""),
                    "transaction_id": txn_id or None,
                    "installment_number": i,
                    "installment_total": inst_total,
                    "installment_group_id": group_id,
                    "_auto_generated": True,
                })
            else:
                # Crear en scheduled_expenses
                scheduled_extra.append({
                    "scheduled_date": charge_date,
                    "description": template["description"],
                    "amount": template["amount"],
                    "currency": template.get("currency", "ARS"),
                    "card": template.get("card", ""),
                    "bank": template.get("bank", ""),
                    "person": template.get("person", ""),
                    "transaction_id": txn_id or None,
                    "installment_number": i,
                    "installment_total": inst_total,
                    "installment_group_id": group_id,
                    "status": "PENDING",
                    "category_id": None,
                    "user_id": user_id,
                    "_is_scheduled": True,  # Flag para el frontend
                })

    return (parsed + expenses_extra, scheduled_extra)


async def _normalize_persons_llm(persons: list[str], client) -> dict[str, str]:
    if not persons:
        return {}
    prompt = (
        "Estos son nombres de titulares de tarjetas de crédito argentinas extraídos de "
        "extractos bancarios. Los PDFs suelen truncar o reordenar los nombres "
        "(ej: 'MENDOZA MARCELO IGN' y 'MARCELO I MENDOZA N' son la misma persona).\n\n"
        "Para cada nombre:\n"
        "1. Si dos o más nombres son claramente la misma persona (mismo apellido + al menos "
        "   una inicial del nombre coincide), devolvé el MISMO valor normalizado para todos.\n"
        "2. Si son personas distintas, devolvé valores distintos.\n"
        "3. El formato normalizado debe ser: APELLIDO, NOMBRE (en MAYÚSCULAS).\n"
        "   Expandí abreviaturas si podés inferirlas (ej: 'IGN' → 'IGNACIO').\n\n"
        "Devolvé ÚNICAMENTE un JSON válido: {\"nombre_original\": \"NOMBRE_NORMALIZADO\", ...}\n\n"
        f"Nombres: {json.dumps(persons, ensure_ascii=False)}"
    )
    from google.genai import types as genai_types
    try:
        resp = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=prompt,
            config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
        )
        result = json.loads(resp.text)
        if isinstance(result, dict):
            return result
    except Exception:
        pass
    return {p: p for p in persons}


def _detect_installment_pattern(description: str) -> tuple[int, int] | None:
    """
    Detecta patrones de cuotas en la descripción.
    Retorna (installment_number, installment_total) o None si no hay cuota.
    Patrones reconocidos:
      - C.01/03, C.12/12, Cta 2/6
      - NN/NN al final (Galicia): "KEL EDICIONES SA03/03"
      - Simple: "1/3", "2/6"
    """
    if not description:
        return None
    s = str(description).strip()

    m = re.search(r"C\.(\d{1,2})/(\d{1,2})", s)
    if m:
        num, total = int(m.group(1)), int(m.group(2))
        if total >= 2:
            return (num, total)

    m = re.search(r"Cta\s*(\d+)/(\d+)", s)
    if m:
        num, total = int(m.group(1)), int(m.group(2))
        if total >= 2:
            return (num, total)

    m = re.search(r"(\d{1,2})/(\d{1,2})$", s)
    if m:
        num, total = int(m.group(1)), int(m.group(2))
        if total >= 2 and 1 <= num <= total:
            return (num, total)

    m = re.search(r"(\d{1,2})/(\d{1,2})(?:\s|$)", s)
    if m:
        num, total = int(m.group(1)), int(m.group(2))
        if total >= 2 and 1 <= num <= total:
            return (num, total)

    return None


def fix_missing_installments(db: Session, user_id: int) -> dict:
    """
    Escanea expenses sin installment_group_id y detecta patrones de cuotas.
    Agrupa por descripción+monto+cantidad_total, asigna installment_group_id,
    y crea los gastos faltantes (pasados) y scheduled_expenses (futuros).
    """
    import hashlib
    from collections import defaultdict
    from app.models import Expense, ScheduledExpense
    from app.services.date_utils import add_months

    today = date.today()

    candidates = db.query(Expense).filter(
        Expense.user_id == user_id,
        (Expense.installment_group_id == None) | (Expense.installment_group_id == "")
    ).all()

    groups: dict = defaultdict(list)
    for e in candidates:
        pattern = _detect_installment_pattern(e.description)
        if not pattern:
            continue
        inst_num, inst_total = pattern
        key = (e.description.lower().strip(), round(abs(e.amount), 2), inst_total)
        groups[key].append((e, inst_num, inst_total))

    expenses_created = 0
    scheduled_created = 0
    group_ids_fixed = []

    for key, entries in groups.items():
        desc_lower, amount, inst_total = key
        template_e = entries[0][0]

        present_nums = {inst_num for _, inst_num, _ in entries}
        if len(present_nums) < 2:
            continue

        group_id = hashlib.md5("|".join(str(k) for k in key).encode()).hexdigest()[:12]
        group_ids_fixed.append(group_id)

        base_date = None
        for e, inst_num, _ in entries:
            e.installment_group_id = group_id
            e.installment_number = inst_num
            e.installment_total = inst_total
            if base_date is None or (base_date and e.date < base_date):
                base_date = e.date

        if base_date is None:
            continue

        base_date_obj = base_date.replace(day=1)
        generated_keys = set()
        for e, inst_num, inst_total in entries:
            gen_key = (desc_lower, inst_num, inst_total)
            generated_keys.add(gen_key)

        for inst_num in range(1, inst_total + 1):
            if inst_num in present_nums:
                continue
            gen_key = (desc_lower, inst_num, inst_total)
            if gen_key in generated_keys:
                continue

            charge_date = add_months(base_date, inst_num - inst_num)
            charge_date = date(base_date.year, base_date.month, min(base_date.day, 28))
            charge_date = add_months(base_date, inst_num - 1)

            existing_exp = db.query(Expense).filter(
                Expense.user_id == user_id,
                Expense.installment_group_id == group_id,
                Expense.installment_number == inst_num,
            ).first()
            if existing_exp:
                generated_keys.add(gen_key)
                continue

            existing_sched = db.query(ScheduledExpense).filter(
                ScheduledExpense.user_id == user_id,
                ScheduledExpense.installment_group_id == group_id,
                ScheduledExpense.installment_number == inst_num,
                ScheduledExpense.status == "PENDING"
            ).first()
            if existing_sched:
                generated_keys.add(gen_key)
                continue

            if charge_date <= today:
                new_exp = Expense(
                    date=charge_date,
                    description=template_e.description,
                    amount=template_e.amount,
                    currency=template_e.currency or "ARS",
                    card=template_e.card,
                    bank=template_e.bank,
                    person=template_e.person,
                    card_id=template_e.card_id,
                    account_id=template_e.account_id,
                    category_id=template_e.category_id,
                    installment_number=inst_num,
                    installment_total=inst_total,
                    installment_group_id=group_id,
                    user_id=user_id,
                    group_id=template_e.group_id,
                    _auto_generated=True,
                )
                db.add(new_exp)
                expenses_created += 1
            else:
                new_sched = ScheduledExpense(
                    scheduled_date=charge_date,
                    description=template_e.description,
                    amount=template_e.amount,
                    currency=template_e.currency or "ARS",
                    card=template_e.card,
                    bank=template_e.bank,
                    person=template_e.person,
                    card_id=template_e.card_id,
                    account_id=template_e.account_id,
                    category_id=template_e.category_id,
                    installment_number=inst_num,
                    installment_total=inst_total,
                    installment_group_id=group_id,
                    status="PENDING",
                    user_id=user_id,
                    group_id=template_e.group_id,
                )
                db.add(new_sched)
                scheduled_created += 1
            generated_keys.add(gen_key)

    db.commit()

    return {
        "groups_fixed": len(group_ids_fixed),
        "expenses_created": expenses_created,
        "scheduled_created": scheduled_created,
        "group_ids": group_ids_fixed,
    }
