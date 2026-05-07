import io
import re
from datetime import date
from typing import Optional

import pandas as pd

from app.services.import_utils import _expand_installments


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
    return ""


def _parse_amount(raw: str) -> Optional[float]:
    if not raw or str(raw).strip() in ("", "-", "NaN"):
        return None
    s = str(raw).strip()
    s = s.replace("$", "").replace("U$S", "").replace("US$", "").replace("U$S", "")
    negative = s.startswith("-")
    s = s.replace("-", "")
    if s.count(",") == 1 and "." not in s:
        s = s.replace(",", ".")
    elif s.count(",") > 1:
        s = s.replace(",", "")
    elif s.count(".") > 1:
        s = s.replace(".", "").replace(",", ".")
    clean = "".join(c for c in s if c.isdigit() or c == ".")
    try:
        val = float(clean)
        return -val if negative else val
    except (ValueError, TypeError):
        return None


def _parse_installments(raw: str):
    if not raw or str(raw).strip() in ("", "-", "NaN"):
        return None, None
    s = str(raw).strip()
    m = re.match(r"(\d+)\s*de\s*(\d+)", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"(\d+)/(\d+)", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(\d+)\s*de\s*(\d+)", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def _parse_date(raw: str):
    if not raw or str(raw).strip() in ("", "-", "NaN"):
        return None
    try:
        return pd.to_datetime(str(raw).strip(), dayfirst=True).date()
    except Exception:
        return None


def _is_transaction_row(date_val, comprobante_val, desc_val) -> bool:
    if date_val is not None:
        return True
    comp_str = str(comprobante_val or "").strip()
    if re.match(r"^\d{4,}$", comp_str) and str(desc_val or "").strip():
        return True
    return False


def _extract_card_from_text(text: str) -> Optional[str]:
    m = re.search(r"terminada\s+en\s+(\d{4})", text, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _extract_person_from_text(text: str) -> Optional[str]:
    m = re.search(r"Adicional\s+de\s+(.+?)\s*-\s*Visa", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"Tarjeta\s+de\s+(.+?)\s*-\s*Visa", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"Tarjeta\s+de\s+(.+)", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def _scan_closing_dates(df: pd.DataFrame) -> tuple:
    closing_date = None
    due_date = None
    for _, row in df.iterrows():
        row_str = " ".join(str(v) for v in row.values if str(v) not in ("", "NaN", "nan"))
        m = re.search(r"Fecha\s+de\s+cierre[:\s]*(\d{2}/\d{2}/\d{4})", row_str, re.IGNORECASE)
        if m:
            closing_date = _parse_date(m.group(1))
        m = re.search(r"Fecha\s+de\s+vencimiento[:\s]*(\d{2}/\d{2}/\d{4})", row_str, re.IGNORECASE)
        if m:
            due_date = _parse_date(m.group(1))
        if closing_date and due_date:
            break
    return closing_date, due_date


def _to_string_safe(val) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


def parse_csv_expenses(content: bytes, filename: str, db, user_id: int):
    from app.models import Card, CardClosing, Category
    from app.services.categorization import auto_categorize

    df = _load_dataframe(content, filename)
    cols = list(df.columns)

    date_col = _detect_col(cols, ["fecha", "date", "dia"])
    desc_col = _detect_col(cols, ["desc", "concepto", "detalle", "comercio", "nombre", "detail"])
    cuotas_col = _detect_col(cols, ["cuota"])
    comprob_col = _detect_col(cols, ["comprob", "referencia", "nro"])
    pesos_col = _detect_col(cols, ["monto en pesos", "monto pesos", "importe en pesos", "pesos"])
    dolares_col = _detect_col(cols, ["monto en dollars", "monto dolares", "importe en dólares", "dólares", "dolares", "us$", "u$s"])

    if not date_col and not desc_col:
        for col in cols:
            for _, row in df.iterrows():
                val = _to_string_safe(row.get(col))
                if re.match(r"^\d{2}/\d{2}/\d{4}$", val):
                    date_col = col
                    break
            if date_col:
                break

    closing_date, due_date = _scan_closing_dates(df)

    cats = db.query(Category).all()

    current_last4: Optional[str] = None
    current_person: Optional[str] = None
    previous_date: Optional[date] = None
    previous_date_str: str = ""

    raw_rows: list = []

    for _, row in df.iterrows():
        row_vals = {str(c): _to_string_safe(row.get(c)) for c in cols}
        row_text = " ".join(row_vals.values())

        card_last4 = _extract_card_from_text(row_text)
        if card_last4:
            current_last4 = card_last4

        person = _extract_person_from_text(row_text)
        if person:
            current_person = person

        date_raw = _to_string_safe(row.get(date_col)) if date_col else ""
        date_obj = _parse_date(date_raw)
        if date_obj:
            previous_date = date_obj
            previous_date_str = date_raw

        desc_raw = _to_string_safe(row.get(desc_col)) if desc_col else ""
        comprob_raw = _to_string_safe(row.get(comprob_col)) if comprob_col else ""

        if not _is_transaction_row(date_obj, comprob_raw, desc_raw):
            continue

        if not desc_raw:
            continue

        pesos_raw = _to_string_safe(row.get(pesos_col)) if pesos_col else ""
        dolares_raw = _to_string_safe(row.get(dolares_col)) if dolares_col else ""

        amount: Optional[float] = None
        currency = "ARS"
        if dolares_raw and dolares_raw not in ("", "-"):
            amount = _parse_amount(dolares_raw)
            currency = "USD"
        elif pesos_raw and pesos_raw not in ("", "-"):
            amount = _parse_amount(pesos_raw)

        if amount is None:
            amount = _parse_amount(pesos_raw) or _parse_amount(dolares_raw)
            if amount and dolares_raw and dolares_raw not in ("", "-"):
                currency = "USD"

        if amount is None or amount == 0:
            continue

        amount = abs(amount)

        txn_id: Optional[str] = None
        if re.match(r"^\d{4,}$", comprob_raw) and comprob_raw not in ("", "-"):
            txn_id = comprob_raw

        inst_num, inst_total = None, None
        if cuotas_col:
            inst_num, inst_total = _parse_installments(_to_string_safe(row.get(cuotas_col)))

        effective_date = date_obj or previous_date
        effective_date_str = date_raw or previous_date_str

        raw_rows.append({
            "date": effective_date_str,
            "_date_obj": effective_date,
            "description": desc_raw,
            "amount": amount,
            "currency": currency,
            "card_last4": current_last4 or "",
            "person": current_person or "",
            "transaction_id": txn_id,
            "installment_number": inst_num,
            "installment_total": inst_total,
            "installment_group_id": None,
        })

    card_lookup: dict[str, dict] = {}
    unique_last4 = {r["card_last4"] for r in raw_rows if r["card_last4"]}
    for last4 in unique_last4:
        card = db.query(Card).filter(
            Card.user_id == user_id,
            Card.last4_digits == last4
        ).first()
        if card:
            card_lookup[last4] = {
                "bank": card.bank or "",
                "card": card.name or "",
                "card_id": card.id,
            }

    for r in raw_rows:
        l4 = r["card_last4"]
        if l4 in card_lookup:
            r["bank"] = card_lookup[l4]["bank"]
            r["card"] = card_lookup[l4]["card"]
            r["card_id"] = card_lookup[l4]["card_id"]
        else:
            r["bank"] = ""
            r["card"] = ""
            r["card_id"] = None

    raw_rows = _expand_installments(raw_rows, db)

    rows = []
    for p in raw_rows:
        desc = p["description"]
        cat_id = auto_categorize(desc, cats)
        cat_name = next((c.name for c in cats if c.id == cat_id), None)
        row_date = p["_date_obj"]

        from app.services.import_utils import _is_duplicate
        is_dup = _is_duplicate(
            db, row_date, p["amount"], p["description"],
            p.get("transaction_id"), p.get("installment_number"),
            p.get("installment_total"), p.get("card_last4") or None
        ) if row_date else False

        card_name = p.get("card", "")
        bank_name = p.get("bank", "")
        if not card_name:
            card_name = "Visa" if p.get("card_last4") else ""

        rows.append({
            "date": p["date"],
            "description": desc,
            "amount": p["amount"],
            "currency": p.get("currency", "ARS"),
            "card": card_name,
            "bank": bank_name,
            "person": p.get("person", ""),
            "card_last4": p.get("card_last4", ""),
            "transaction_id": p.get("transaction_id"),
            "installment_number": p.get("installment_number"),
            "installment_total": p.get("installment_total"),
            "installment_group_id": p.get("installment_group_id"),
            "suggested_category": cat_name,
            "is_duplicate": is_dup,
            "is_auto_generated": p.get("_auto_generated", False),
        })

    card_closings: list = []
    if closing_date:
        for last4 in unique_last4:
            card_name = card_lookup.get(last4, {}).get("card", "Visa")
            bank_name = card_lookup.get(last4, {}).get("bank", "")
            card_closings.append({
                "card": card_name,
                "card_last_digits": last4,
                "card_type": "credito",
                "bank": bank_name,
                "closing_date": closing_date,
                "next_closing_date": None,
                "due_date": due_date,
            })

    summary = {
        "card_last4": list(unique_last4)[0] if unique_last4 else "",
        "card_type": "Visa",
        "bank": card_lookup.get(list(unique_last4)[0], {}).get("bank", "") if unique_last4 else "",
        "closing_date": closing_date.isoformat() if closing_date else None,
        "due_date": due_date.isoformat() if due_date else None,
        "total_ars": None,
        "total_usd": None,
        "future_charges_ars": None,
        "future_charges_usd": None,
    }

    return {
        "rows": rows,
        "raw_count": len(raw_rows),
        "summary": summary,
        "card_closings": card_closings,
    }
