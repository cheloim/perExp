import json
import os
import re
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from google import genai
from google.genai import types as genai_types
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Card, Category, Expense, User
from app.services.auth import get_current_user
from app.prompts import SMART_IMPORT_PROMPT
from app.schemas import RowsConfirmBody
from app.services.categorization import _resolve_category, _should_skip
from app.services.date_utils import _normalize_date_str
from app.services.import_utils import (
    _detect_col,
    _expand_installments,
    _is_duplicate,
    _load_dataframe,
    _normalize_persons_llm,
)
from app.services.normalizers import _normalize_bank, _normalize_person
from app.services.pdf import _extract_pdf_text, _inject_card_markers, _inject_csv_card_markers, _normalize_santander_dates
from app.services.categorization import auto_categorize


router = APIRouter(prefix="/import", tags=["import"])


@router.post("/preview")
async def preview_import(
    file: UploadFile = File(...),
    date_col: Optional[str] = None,
    desc_col: Optional[str] = None,
    amount_col: Optional[str] = None,
    card_col: Optional[str] = None,
    bank_col: Optional[str] = None,
    person_col: Optional[str] = None,
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        df = _load_dataframe(content, file.filename or "")
    except Exception as e:
        raise HTTPException(400, f"Error al leer el archivo: {e}")

    cols = list(df.columns)
    auto_date   = date_col   or _detect_col(cols, ["fecha", "date", "dia", "day"])
    auto_desc   = desc_col   or _detect_col(cols, ["desc", "concepto", "detalle", "comercio", "nombre", "detail"])
    auto_amount = amount_col or _detect_col(cols, ["monto", "importe", "amount", "total", "valor", "pesos"])
    auto_card   = card_col   or ""
    auto_bank   = bank_col   or ""
    auto_person = person_col or ""

    cats = db.query(Category).all()

    rows = []
    for _, row in df.head(50).iterrows():
        raw_amount = str(row.get(auto_amount, "0")).strip()
        if raw_amount.count(",") == 1 and raw_amount.count(".") == 0:
            raw_amount = raw_amount.replace(",", ".")
        elif raw_amount.count(",") > 1:
            raw_amount = raw_amount.replace(",", "")
        clean = "".join(c for c in raw_amount if c.isdigit() or c == ".")
        try:
            amount = abs(float(clean or "0"))
        except ValueError:
            amount = 0.0

        desc = str(row.get(auto_desc, "")).strip()
        cat_id = auto_categorize(desc, cats)
        cat_name = next((c.name for c in cats if c.id == cat_id), None) if cat_id else None

        try:
            row_date = pd.to_datetime(str(row.get(auto_date, "")).strip(), dayfirst=True).date()
        except Exception:
            row_date = None

        rows.append({
            "date": str(row.get(auto_date, "")).strip(),
            "description": desc,
            "amount": amount,
            "suggested_category": cat_name,
            "is_duplicate": _is_duplicate(db, row_date, amount, desc) if row_date else False,
        })

    return {
        "columns": cols,
        "rows": rows,
        "date_col": auto_date,
        "desc_col": auto_desc,
        "amount_col": auto_amount,
        "card_col": auto_card,
        "bank_col": auto_bank,
        "person_col": auto_person,
    }


@router.post("/confirm")
async def confirm_import(
    file: UploadFile = File(...),
    date_col: str = "",
    desc_col: str = "",
    amount_col: str = "",
    card_col: Optional[str] = None,
    bank_col: Optional[str] = None,
    person_col: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content = await file.read()
    try:
        df = _load_dataframe(content, file.filename or "")
    except Exception as e:
        raise HTTPException(400, f"Error al leer el archivo: {e}")

    cats = db.query(Category).all()
    imported = 0
    skipped = 0

    for _, row in df.iterrows():
        try:
            raw_date = str(row.get(date_col, "")).strip()
            try:
                normalized = _normalize_date_str(raw_date)
                if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                    parsed_date = date.fromisoformat(normalized)
                else:
                    parsed_date = pd.to_datetime(normalized, dayfirst=True).date()
            except Exception:
                parsed_date = date.today()

            raw_amount = str(row.get(amount_col, "0")).strip()
            if raw_amount.count(",") == 1 and raw_amount.count(".") == 0:
                raw_amount = raw_amount.replace(",", ".")
            elif raw_amount.count(",") > 1:
                raw_amount = raw_amount.replace(",", "")
            clean = "".join(c for c in raw_amount if c.isdigit() or c == ".")
            amount = abs(float(clean or "0"))

            description = str(row.get(desc_col, "")).strip()
            if not description or amount == 0:
                skipped += 1
                continue

            if _should_skip(description):
                skipped += 1
                continue

            if _is_duplicate(db, parsed_date, amount, description):
                skipped += 1
                continue

            card   = str(row.get(card_col,   "")).strip() if card_col   else ""
            bank   = str(row.get(bank_col,   "")).strip() if bank_col   else ""
            person = str(row.get(person_col, "")).strip() if person_col else ""

            category_id = _resolve_category(db, amount, description, cats)
            db.add(Expense(
                date=parsed_date,
                description=description,
                amount=amount,
                category_id=category_id,
                card=card,
                bank=bank,
                person=person,
                user_id=current_user.id,
            ))
            imported += 1
        except Exception:
            skipped += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}


@router.post("/pdf-debug")
async def pdf_debug(file: UploadFile = File(...)):
    content = await file.read()
    try:
        raw = _extract_pdf_text(content)
        raw = _normalize_santander_dates(raw)
        lines = raw.splitlines()
        candidate_lines = [
            {"i": i, "line": repr(l)}
            for i, l in enumerate(lines)
            if (re.search(r'\d[\d\-]{4,}\d', l) or 'arjeta' in l or 'uenta' in l or 'socio' in l)
            and len(l.strip()) < 200
        ]
        injected = _inject_card_markers(raw).splitlines()
        return {
            "total_lines": len(lines),
            "first_50": lines[:50],
            "candidate_lines": candidate_lines[:60],
            "markers_found": [l for l in injected if "[TARJETA_LAST4" in l],
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/csv-debug")
async def csv_debug(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()
    try:
        df = _load_dataframe(content, filename)
        raw_text = df.to_string(index=False, max_rows=1000)
        injected_text = _inject_csv_card_markers(raw_text)
        injected_lines = injected_text.splitlines()
        return {
            "total_rows": len(df),
            "df_columns": list(df.columns),
            "raw_text_preview": raw_text[:3000],
            "injected_text_preview": injected_text[:3000],
            "card_lines": [
                {"i": i, "line": l}
                for i, l in enumerate(injected_lines)
                if "terminada en" in l.lower() or "[tarjeta_last4" in l.lower()
            ],
            "markers_found": [l for l in injected_lines if "[TARJETA_LAST4" in l],
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/csv-parser-debug")
async def csv_parser_debug(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from app.services.csv_parser import (
        _csv_split, _parse_amount, _parse_date, _parse_installments,
        _extract_card_from_text, _extract_person_from_text, _load_dataframe,
    )
    import re
    content = await file.read()
    filename = (file.filename or "").lower()
    try:
        if filename.endswith(".csv"):
            raw_text = content.decode("utf-8", errors="replace")
        else:
            df = _load_dataframe(content, filename)
            raw_text = df.to_csv(index=False)

        lines = raw_text.splitlines()

        header_idx = None
        header_col_idx = {}
        for i, line in enumerate(lines):
            ll = line.lower()
            if "fecha" in ll and "descripci" in ll:
                header_idx = i
                parts = _csv_split(line)
                for j, p in enumerate(parts):
                    p_lower = p.lower().strip()
                    if "fecha" in p_lower:
                        header_col_idx["date"] = j
                    elif "descripci" in p_lower:
                        header_col_idx["desc"] = j
                    elif "cuota" in p_lower:
                        header_col_idx["cuotas"] = j
                    elif "comprob" in p_lower:
                        header_col_idx["comprob"] = j
                    elif "monto en pesos" in p_lower or "importe en pesos" in p_lower:
                        header_col_idx["pesos"] = j
                    elif "dólares" in p_lower or "dolares" in p_lower or "us$" in p_lower:
                        header_col_idx["dolares"] = j
                break

        sample_rows = []
        parsed_count = 0
        skipped_reasons = {"no_header": 0, "no_desc": 0, "no_amount": 0, "ok": 0}

        if header_idx is None:
            return {"error": "No se encontró la fila de encabezado con 'Fecha' y 'Descripción'.", "header_col_idx": {}}

        current_last4 = None
        current_person = None
        previous_date = None

        for i in range(header_idx + 1, len(lines)):
            line = lines[i].strip()
            if not line:
                continue

            parts = _csv_split(line)
            card = _extract_card_from_text(line)
            if card:
                current_last4 = card
            person = _extract_person_from_text(line)
            if person:
                current_person = person

            date_idx = header_col_idx.get("date")
            date_raw = parts[date_idx].strip() if date_idx is not None and date_idx < len(parts) else ""
            date_obj = _parse_date(date_raw)

            desc_idx = header_col_idx.get("desc")
            desc_raw = parts[desc_idx].strip() if desc_idx is not None and desc_idx < len(parts) else ""

            if date_obj is None:
                comp_idx = header_col_idx.get("comprob")
                comp_raw = parts[comp_idx].strip() if comp_idx is not None and comp_idx < len(parts) else ""
                if not (re.match(r"^\d{4,}$", comp_raw) and desc_raw):
                    skipped_reasons["no_header"] += 1
                    continue

            if not desc_raw:
                skipped_reasons["no_desc"] += 1
                continue

            pesos_idx = header_col_idx.get("pesos")
            dolares_idx = header_col_idx.get("dolares")
            pesos_raw = parts[pesos_idx].strip() if pesos_idx is not None and pesos_idx < len(parts) else ""
            dolares_raw = parts[dolares_idx].strip() if dolares_idx is not None and dolares_idx < len(parts) else ""

            amount = None
            if dolares_raw and dolares_raw not in ("", "-"):
                amount = _parse_amount(dolares_raw)
            if amount is None and pesos_raw and pesos_raw not in ("", "-"):
                amount = _parse_amount(pesos_raw)

            if len(sample_rows) < 20:
                sample_rows.append({
                    "line_idx": i,
                    "date_raw": date_raw,
                    "desc_raw": desc_raw,
                    "pesos_raw": pesos_raw,
                    "dolares_raw": dolares_raw,
                    "amount_parsed": amount,
                    "card_last4": current_last4,
                    "person": current_person,
                })

            if amount is None or amount == 0:
                skipped_reasons["no_amount"] += 1
                continue

            parsed_count += 1
            skipped_reasons["ok"] += 1

        return {
            "filename": filename,
            "total_lines": len(lines),
            "header_idx": header_idx,
            "header_col_idx": header_col_idx,
            "skipped_reasons": skipped_reasons,
            "parsed_count": parsed_count,
            "sample_rows": sample_rows,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(400, str(e))


@router.post("/smart")
async def smart_import(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Smart import endpoint (synchronous, legacy).
    New async import is available at POST /import-jobs.
    """
    from app.services.smart_import_core import run_smart_import

    content = await file.read()
    filename = file.filename or "unknown"

    try:
        result = await run_smart_import(
            file_content=content,
            filename=filename,
            db=db,
            user_id=current_user.id
        )
        return result
    except ValueError as e:
        # Map ValueError to appropriate HTTP error
        error_msg = str(e)
        if "GOOGLE_API_KEY" in error_msg:
            raise HTTPException(500, error_msg)
        elif "Formato no soportado" in error_msg or "no pudo leer" in error_msg:
            raise HTTPException(400, error_msg)
        elif "no pudo extraer" in error_msg:
            raise HTTPException(400, error_msg)
        elif "no pudo parsear" in error_msg:
            raise HTTPException(422, error_msg)
        elif "No se encontraron transacciones" in error_msg:
            raise HTTPException(422, error_msg)
        else:
            raise HTTPException(500, f"Error: {error_msg}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Error interno: {type(e).__name__}: {e}")


@router.post("/rows-confirm")
def rows_confirm_import(body: RowsConfirmBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from app.models import ScheduledExpense
    cats = db.query(Category).all()
    user_cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    imported = 0
    scheduled_count = 0
    skipped = 0

    print(f"[DEBUG] rows-confirm: received {len(body.rows)} rows")
    if body.rows:
        print(f"[DEBUG] first row keys: {list(body.rows[0].keys())}")
        print(f"[DEBUG] first row: {body.rows[0]}")

    for r in body.rows:
        desc = str(r.get("description", "")).strip()
        try:
            amount = float(r.get("amount", 0) or 0)
        except (ValueError, TypeError):
            amount = 0.0

        if not desc or amount == 0:
            skipped += 1
            continue

        try:
            raw_date = str(r.get("date", "")).strip()
            normalized = _normalize_date_str(raw_date)
            if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                parsed_date = date.fromisoformat(normalized)
            else:
                parsed_date = pd.to_datetime(normalized, dayfirst=True).date()
        except Exception:
            parsed_date = date.today()

        if _should_skip(desc):
            skipped += 1
            continue

        try:
            inst_num = int(r["installment_number"]) if r.get("installment_number") else None
            inst_total = int(r["installment_total"]) if r.get("installment_total") else None
        except (ValueError, TypeError):
            inst_num = inst_total = None

        txn_id = str(r.get("transaction_id") or "").strip() or None

        if _is_duplicate(db, parsed_date, amount, desc, txn_id, inst_num, inst_total):
            skipped += 1
            continue

        norm_bank = _normalize_bank(str(r.get("bank", "") or ""))
        norm_person = _normalize_person(str(r.get("person", "") or ""), db)
        raw_currency = str(r.get("currency", "") or "").strip().upper()
        currency = "USD" if raw_currency == "USD" else "ARS"
        category_id = _resolve_category(db, amount, desc, cats)

        # Determinar si es scheduled
        is_scheduled = r.get("is_scheduled", False)

        if is_scheduled:
            # Crear scheduled_expense
            try:
                db.add(ScheduledExpense(
                    scheduled_date=parsed_date,
                    description=desc,
                    amount=amount,
                    currency=currency,
                    category_id=category_id,
                    card=str(r.get("card", "") or ""),
                    bank=norm_bank,
                    person=norm_person,
                    transaction_id=txn_id,
                    installment_number=inst_num,
                    installment_total=inst_total,
                    installment_group_id=str(r.get("installment_group_id") or "") or None,
                    status="PENDING",
                    user_id=current_user.id,
                ))
                scheduled_count += 1
            except Exception:
                skipped += 1
        else:
            # Crear expense normal
            try:
                db.add(Expense(
                    date=parsed_date,
                    description=desc,
                    amount=amount,
                    currency=currency,
                    category_id=category_id,
                    card=str(r.get("card", "") or ""),
                    bank=norm_bank,
                    person=norm_person,
                    transaction_id=txn_id,
                    installment_number=inst_num,
                    installment_total=inst_total,
                    installment_group_id=str(r.get("installment_group_id") or "") or None,
                    user_id=current_user.id,
                ))

                row_card_name = str(r.get("card", "") or "").strip()
                if row_card_name:
                    existing_card = next(
                        (c for c in user_cards
                         if c.name.lower() == row_card_name.lower()
                         and c.bank.lower() == norm_bank.lower()
                         and c.holder.lower() == norm_person.lower()), None
                    )
                    if existing_card:
                        if existing_card.name.lower() != row_card_name.lower():
                            existing_card.name = row_card_name
                    else:
                        new_card = Card(
                            name=row_card_name,
                            bank=norm_bank,
                            holder=norm_person,
                            card_type="credito",
                            user_id=current_user.id,
                        )
                        db.add(new_card)
                        user_cards.append(new_card)

                imported += 1
            except Exception:
                skipped += 1

    db.commit()
    return {"imported": imported, "scheduled": scheduled_count, "skipped": skipped}


@router.post("/csv-raw-llm-preview")
async def csv_raw_llm_preview(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no está configurada.")

    content = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".csv"):
        raw_text = content.decode("utf-8", errors="replace")
    elif filename.endswith((".xls", ".xlsx")):
        df = _load_dataframe(content, filename)
        raw_text = df.to_string(index=False, max_rows=2000)
    else:
        raise HTTPException(415, "Solo CSV o Excel.")

    preview = raw_text[:8000]

    debug_prompt = f"""Parseá este extracto CSV y devolvé SOLO un JSON array con las transacciones identificadas.

Reglas:
1. Identificá las tarjetas buscando patrones como "terminada en XXXX" o "Visa/MC terminada en XXXX" en los headers de sección
2. Para cada transacción, asigná el card_last4 según el último header de sección visto antes de esa transacción
3. Devolvé: fecha (YYYY-MM-DD), description, amount, currency, card_last4, installment_number, installment_total
4. Solo transacciones de consumo/débito (NO pagos, NO totales, NO subtotales)
5. Si una fila parece ser un header de totales/subtotales, ignorala

Formato del CSV:
- Filas que contienen "terminada en" o "Visa" o "MC" o "Mastercard" son ENCABEZADOS DE SECCIÓN (contienen el card_last4)
- Filas que tienen fecha (DD/MM/YYYY), descripción y monto son TRANSACCIONES
- Las transacciones que siguen a un encabezado de sección pertenecen a esa tarjeta

Texto a parsear:
---
{preview}
---"""

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-flash-latest",
        contents=debug_prompt,
    )

    return {
        "filename": file.filename,
        "raw_preview": preview,
        "raw_length": len(raw_text),
        "llm_response": response.text.strip(),
    }
