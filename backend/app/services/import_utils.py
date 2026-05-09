import hashlib
import io
import json
from datetime import date, timedelta
from typing import Optional

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Expense
from app.services.date_utils import add_months, _normalize_date_str


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
) -> bool:
    if transaction_id:
        if installment_number and installment_total and installment_total >= 2:
            return db.query(Expense).filter(
                Expense.transaction_id == transaction_id,
                Expense.installment_number == installment_number,
                Expense.installment_total == installment_total,
            ).first() is not None
        return db.query(Expense).filter(Expense.transaction_id == transaction_id).first() is not None

    if installment_number and installment_total and installment_total >= 2:
        month_start = exp_date.replace(day=1)
        next_month = month_start.replace(day=28) + timedelta(days=4)
        month_end = next_month.replace(day=1) - timedelta(days=1)
        q = db.query(Expense).filter(
            func.lower(Expense.description) == description.lower(),
            Expense.installment_number == installment_number,
            Expense.installment_total == installment_total,
            Expense.date >= month_start,
            Expense.date <= month_end,
        )
        if q.first():
            return True

    q = db.query(Expense).filter(
        Expense.date == exp_date,
        Expense.amount == amount,
        func.lower(Expense.description) == description.lower(),
    )
    if installment_number is not None:
        q = q.filter(Expense.installment_number == installment_number)
    return q.first() is not None


def _is_scheduled_duplicate(
    db: Session,
    scheduled_date: date,
    amount: float,
    description: str,
    installment_number: int,
    installment_total: int,
    user_id: int,
) -> bool:
    """Verificar si ya existe una cuota programada duplicada"""
    from app.models import ScheduledExpense

    return db.query(ScheduledExpense).filter(
        ScheduledExpense.user_id == user_id,
        ScheduledExpense.scheduled_date == scheduled_date,
        ScheduledExpense.installment_number == installment_number,
        ScheduledExpense.installment_total == installment_total,
        func.lower(ScheduledExpense.description) == description.lower(),
        ScheduledExpense.status == "PENDING"
    ).first() is not None


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
            key = (r["description"].lower(), inst_total, txn_id)
        else:
            key = (r["description"].lower(), inst_total, base_date.strftime("%Y-%m"), r.get("person") or "")
        groups[key].append((r, base_date))

    expenses_extra: list = []
    scheduled_extra: list = []
    # Tracks already-generated slots to prevent cross-group duplicates within a batch.
    generated: set = set()

    for key, entries in groups.items():
        template, base_date = entries[0]
        desc_lower = template["description"].lower()
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
                             installment_number=i, installment_total=inst_total):
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
                             installment_number=i, installment_total=inst_total):
                continue

            # Verificar duplicados en scheduled_expenses
            if _is_scheduled_duplicate(db, charge_date, template["amount"],
                                       template["description"], i, inst_total, user_id):
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
