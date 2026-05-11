"""
Core logic for smart import (LLM-based PDF/CSV parsing).
Extracted from routers/import_.py to be reusable by both sync endpoint and background jobs.
"""
import json
import os
import re
from datetime import date
from typing import Optional

import pandas as pd
from google import genai
from google.genai import types as genai_types
from sqlalchemy.orm import Session

from app.models import Category, Card
from app.prompts import SMART_IMPORT_PROMPT
from app.services.categorization import _resolve_category, _should_skip
from app.services.date_utils import _normalize_date_str
from app.services.import_utils import _expand_installments, _is_duplicate, _load_dataframe, _normalize_persons_llm
from app.services.normalizers import _normalize_bank, _normalize_person
from app.services.pdf import _extract_pdf_text, _inject_card_markers, _inject_csv_card_markers, _normalize_santander_dates


async def run_smart_import(
    file_content: bytes,
    filename: str,
    db: Session,
    user_id: int
) -> dict:
    """
    Core smart import logic: extracts text, calls LLM, expands installments, detects duplicates.

    Args:
        file_content: Raw file bytes
        filename: Original filename
        db: Database session
        user_id: User ID for duplicate detection and categorization

    Returns:
        dict with keys: rows, raw_count, summary, has_missing_data

    Raises:
        ValueError: If API key missing, file format unsupported, or no transactions found
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY no está configurada.")

    filename_lower = filename.lower()
    is_csv = filename_lower.endswith((".csv", ".xls", ".xlsx"))

    # Step 1: Extract text
    try:
        if filename_lower.endswith(".pdf"):
            raw_text = _extract_pdf_text(file_content)
            raw_text = _normalize_santander_dates(raw_text)
            raw_text = _inject_card_markers(raw_text)
        elif is_csv:
            if filename_lower.endswith(".csv"):
                raw_text = file_content.decode("utf-8", errors="replace")
                raw_text = _inject_csv_card_markers(raw_text)
            else:
                df = _load_dataframe(file_content, filename)
                raw_text = df.to_string(index=False, max_rows=1000)
                raw_text = _inject_csv_card_markers(raw_text)
        else:
            raise ValueError(f"Formato no soportado: {filename}. Usá PDF, CSV o Excel.")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"No se pudo leer el archivo: {e}")

    if not raw_text.strip():
        raise ValueError("No se pudo extraer contenido del archivo.")

    closing_info = {
        "closing_date": None,
        "next_closing_date": None,
        "due_date": None,
        "bank": "",
        "card_type": "",
        "person": "",
        "total_ars": None,
        "total_usd": None,
        "future_charges_ars": None,
        "future_charges_usd": None,
    }

    # Step 2: Call LLM
    client = genai.Client(api_key=api_key)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=f"Extracto bancario:\n\n{raw_text[:20000]}",
            config=genai_types.GenerateContentConfig(
                system_instruction=SMART_IMPORT_PROMPT,
                response_mime_type="application/json",
            ),
        )
        raw_response = (response.text or "").strip()
        if not raw_response:
            raise ValueError("El modelo no devolvió contenido. Intentá de nuevo.")

        try:
            rows_raw = json.loads(raw_response)
        except json.JSONDecodeError:
            raise ValueError(f"Respuesta inválida del modelo (no es JSON): {raw_response[:300]}")

        if not isinstance(rows_raw, list):
            raise ValueError("Response is not a list")

        # Extract closing info from LLM response
        for field in ["closing_date", "next_closing_date", "due_date", "bank"]:
            for r in rows_raw:
                if r and r.get(field):
                    val = str(r.get(field, "")).strip()
                    if val:
                        try:
                            normalized = _normalize_date_str(val)
                            if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                                parsed_date = date.fromisoformat(normalized)
                            else:
                                parsed_date = pd.to_datetime(normalized, dayfirst=True).date()
                            closing_info[field] = parsed_date
                            break
                        except Exception:
                            pass
            if field == "bank":
                for r in rows_raw:
                    if r and r.get("bank"):
                        val = str(r.get("bank", "")).strip()
                        if val:
                            closing_info["bank"] = val
                            break

        def _parse_amount(v) -> Optional[float]:
            if v is None:
                return None
            try:
                return float(str(v).replace(",", "."))
            except (ValueError, TypeError):
                return None

        for r in rows_raw:
            if r:
                if r.get("card_type") and not closing_info["card_type"]:
                    closing_info["card_type"] = str(r.get("card_type", "")).strip()
                if r.get("total_ars") is not None and closing_info["total_ars"] is None:
                    closing_info["total_ars"] = _parse_amount(r["total_ars"])
                if r.get("total_usd") is not None and closing_info["total_usd"] is None:
                    closing_info["total_usd"] = _parse_amount(r["total_usd"])
                if r.get("future_charges_ars") is not None and closing_info["future_charges_ars"] is None:
                    closing_info["future_charges_ars"] = _parse_amount(r["future_charges_ars"])
                if r.get("future_charges_usd") is not None and closing_info["future_charges_usd"] is None:
                    closing_info["future_charges_usd"] = _parse_amount(r["future_charges_usd"])

        # Fallback values
        fallback_card = closing_info["card_type"]
        fallback_bank = closing_info["bank"]
        fallback_person = ""
        for r in rows_raw:
            if r:
                if not fallback_card and r.get("card"):
                    fallback_card = str(r["card"]).strip()
                if not fallback_bank and r.get("bank"):
                    fallback_bank = str(r["bank"]).strip()
                if not fallback_person and r.get("person"):
                    fallback_person = str(r["person"]).strip()
            if fallback_card and fallback_bank and fallback_person:
                break

    except json.JSONDecodeError as e:
        raise ValueError(f"La IA no pudo parsear las transacciones. Intentá con importación manual. ({e})")
    except Exception as e:
        raise ValueError(f"Error interno: {type(e).__name__}: {e}")

    cats = db.query(Category).all()

    # Step 3: Parse rows
    parsed = []
    for r in rows_raw:
        desc = str(r.get("description", "")).strip()
        if not desc or _should_skip(desc):
            continue
        try:
            amount = float(r.get("amount", 0) or 0)
        except (ValueError, TypeError):
            amount = 0.0
        if amount == 0:
            continue

        txn_id = str(r.get("transaction_id") or "").strip() or None
        raw_date = str(r.get("date", "")).strip()
        try:
            normalized = _normalize_date_str(raw_date)
            if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                row_date = date.fromisoformat(normalized)
            else:
                row_date = pd.to_datetime(normalized, dayfirst=True).date()
        except Exception:
            row_date = None

        inst_num = r.get("installment_number")
        inst_total = r.get("installment_total")
        try:
            inst_num = int(inst_num) if inst_num else None
            inst_total = int(inst_total) if inst_total else None
        except (ValueError, TypeError):
            inst_num = inst_total = None

        raw_currency = str(r.get("currency", "") or "").strip().upper()
        currency = "USD" if raw_currency == "USD" else "ARS"
        row_card = str(r.get("card", "") or "").strip() or fallback_card
        row_bank = str(r.get("bank", "") or "").strip() or fallback_bank
        row_person = str(r.get("person", "") or "").strip() or fallback_person

        parsed.append({
            "date": raw_date,
            "_date_obj": row_date,
            "description": desc,
            "amount": amount,
            "currency": currency,
            "card": row_card,
            "bank": row_bank,
            "person": row_person,
            "transaction_id": txn_id,
            "installment_number": inst_num,
            "installment_total": inst_total,
            "installment_group_id": None,
        })

    # Step 4: Normalize person names with LLM
    unique_persons = list({r["person"] for r in parsed if r.get("person", "").strip()})
    if len(unique_persons) >= 1:
        norm_map = await _normalize_persons_llm(unique_persons, client)
        for r in parsed:
            raw_p = r.get("person", "")
            if raw_p in norm_map:
                r["person"] = norm_map[raw_p]

    # Step 5: Fill missing dates
    last_known_date: Optional[date] = None
    last_known_raw: str = ""
    for p in parsed:
        if p["_date_obj"] is not None:
            last_known_date = p["_date_obj"]
            last_known_raw = p["date"]
        elif last_known_date is not None:
            p["_date_obj"] = last_known_date
            p["date"] = last_known_raw

    # Step 6: Expand installments (generates future scheduled expenses)
    expenses_list, scheduled_list = _expand_installments(parsed, db, user_id)
    parsed = expenses_list

    # Step 7: Build response rows with duplicate detection
    rows = []
    for p in parsed:
        cat_id = _resolve_category(db, p["amount"], p["description"], cats)
        cat_name = next((c.name for c in cats if c.id == cat_id), None)
        row_date = p["_date_obj"]
        rows.append({
            "date": p["date"],
            "description": p["description"],
            "amount": p["amount"],
            "currency": p["currency"],
            "card": p["card"],
            "bank": p["bank"],
            "person": p["person"],
            "transaction_id": p["transaction_id"],
            "installment_number": p["installment_number"],
            "installment_total": p["installment_total"],
            "installment_group_id": p["installment_group_id"],
            "suggested_category": cat_name,
            "is_duplicate": _is_duplicate(
                db,
                row_date,
                p["amount"],
                p["description"],
                p["transaction_id"],
                p["installment_number"],
                p["installment_total"]
            ) if row_date else False,
            "is_auto_generated": p.get("_auto_generated", False),
        })

    # Add scheduled expenses to rows
    for s in scheduled_list:
        cat_id = _resolve_category(db, s["amount"], s["description"], cats)
        cat_name = next((c.name for c in cats if c.id == cat_id), None)
        rows.append({
            "date": s["scheduled_date"].strftime("%d-%m-%Y"),
            "description": s["description"],
            "amount": s["amount"],
            "currency": s["currency"],
            "card": s["card"],
            "bank": s["bank"],
            "person": s["person"],
            "transaction_id": s["transaction_id"],
            "installment_number": s["installment_number"],
            "installment_total": s["installment_total"],
            "installment_group_id": s["installment_group_id"],
            "suggested_category": cat_name,
            "is_duplicate": False,
            "is_auto_generated": True,
            "is_scheduled": True,
        })

    non_auto = [r for r in rows if not r.get("is_auto_generated")]
    if not non_auto:
        raise ValueError("No se encontraron transacciones en el archivo. El resumen puede estar vacío o sin consumos.")

    # Fallback: obtener person de la primera transacción si no está en closing_info
    person_value = closing_info.get("person", "") or ""
    if not person_value and rows:
        first_row = rows[0]
        person_value = first_row.get("person", "")

    summary = {
        "card_type": closing_info["card_type"] or "",
        "bank": closing_info["bank"] or "",
        "person": person_value,
        "closing_date": closing_info["closing_date"].isoformat() if closing_info["closing_date"] else None,
        "due_date": closing_info["due_date"].isoformat() if closing_info["due_date"] else None,
        "total_ars": closing_info["total_ars"],
        "total_usd": closing_info["total_usd"],
        "future_charges_ars": closing_info["future_charges_ars"],
        "future_charges_usd": closing_info["future_charges_usd"],
    }

    has_missing_data = any(
        not (r.get("bank") or "").strip() or
        not (r.get("card") or "").strip() or
        not (r.get("person") or "").strip()
        for r in rows
    )

    return {
        "rows": rows,
        "raw_count": len(rows_raw),
        "summary": summary,
        "has_missing_data": has_missing_data
    }
