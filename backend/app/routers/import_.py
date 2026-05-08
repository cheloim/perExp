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
    api_key = os.getenv("GOOGLE_API_KEY")
    content = await file.read()
    filename = (file.filename or "").lower()

    is_csv = filename.endswith((".csv", ".xls", ".xlsx"))

    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no está configurada.")

    try:
        if filename.endswith(".pdf"):
            raw_text = _extract_pdf_text(content)
            raw_text = _normalize_santander_dates(raw_text)
            raw_text = _inject_card_markers(raw_text)
            _marker_re = re.compile(r'\[TARJETA_LAST4:\s*(\d{4})\]')
            _injected_lines = raw_text.splitlines()
            _marker_map: list[tuple[int, str]] = []
            for _i, _ln in enumerate(_injected_lines):
                _m = _marker_re.search(_ln)
                if _m:
                    _marker_map.append((_i, _m.group(1)))
            _pdf_last4_fallback = _marker_map[0][1] if _marker_map else ""
        elif is_csv:
            if filename.endswith(".csv"):
                raw_text = content.decode("utf-8", errors="replace")
                raw_text = _inject_csv_card_markers(raw_text)
            else:
                df = _load_dataframe(content, filename)
                raw_text = df.to_string(index=False, max_rows=1000)
                raw_text = _inject_csv_card_markers(raw_text)
            _pdf_last4_fallback = ""
        else:
            raise HTTPException(415, f"Formato no soportado: {filename}. Usá PDF, CSV o Excel.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")

    if not raw_text.strip():
        raise HTTPException(400, "No se pudo extraer contenido del archivo.")

    closing_info = {
        "closing_date": None, "next_closing_date": None, "due_date": None,
        "bank": "", "card_last_digits": "", "card_type": "",
        "total_ars": None, "total_usd": None,
        "future_charges_ars": None, "future_charges_usd": None,
    }

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
            raise HTTPException(500, "El modelo no devolvió contenido. Intentá de nuevo.")
        try:
            rows_raw = json.loads(raw_response)
        except json.JSONDecodeError:
            raise HTTPException(500, f"Respuesta inválida del modelo (no es JSON): {raw_response[:300]}")
        if not isinstance(rows_raw, list):
            raise ValueError("Response is not a list")

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
                if r.get("card_last_digits") and not closing_info["card_last_digits"]:
                    closing_info["card_last_digits"] = str(r.get("card_last_digits", "")).strip()
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

        fallback_card   = closing_info["card_type"]
        fallback_bank   = closing_info["bank"]
        fallback_person = ""
        for r in rows_raw:
            if r:
                if not fallback_card   and r.get("card"):   fallback_card   = str(r["card"]).strip()
                if not fallback_bank   and r.get("bank"):   fallback_bank   = str(r["bank"]).strip()
                if not fallback_person and r.get("person"): fallback_person = str(r["person"]).strip()
            if fallback_card and fallback_bank and fallback_person:
                break

    except json.JSONDecodeError as e:
        raise HTTPException(422, f"La IA no pudo parsear las transacciones. Intentá con importación manual. ({e})")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Error interno: {type(e).__name__}: {e}")

    cats = db.query(Category).all()

    user_cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    card_bank_map = {c.last4_digits: _normalize_bank(c.bank) for c in user_cards if c.last4_digits}

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
        row_card   = str(r.get("card",   "") or "").strip() or fallback_card
        row_bank   = str(r.get("bank",   "") or "").strip() or fallback_bank
        row_person = str(r.get("person", "") or "").strip() or fallback_person
        row_last4  = (str(r.get("card_last4") or "").strip()[:4]
                      or closing_info["card_last_digits"][:4]
                      or _pdf_last4_fallback)
        llm_bank = str(r.get("bank", "") or "").strip() or fallback_bank
        if row_last4 and row_last4 in card_bank_map:
            row_bank = card_bank_map[row_last4]
        else:
            row_bank = llm_bank
        parsed.append({
            "date": raw_date,
            "_date_obj": row_date,
            "description": desc,
            "amount": amount,
            "currency": currency,
            "card": row_card,
            "bank": row_bank,
            "person": row_person,
            "card_last4": row_last4,
            "transaction_id": txn_id,
            "installment_number": inst_num,
            "installment_total": inst_total,
            "installment_group_id": None,
        })

    unique_persons = list({r["person"] for r in parsed if r.get("person", "").strip()})
    if len(unique_persons) >= 1:
        norm_map = await _normalize_persons_llm(unique_persons, client)
        for r in parsed:
            raw_p = r.get("person", "")
            if raw_p in norm_map:
                r["person"] = norm_map[raw_p]

    last_known_date: Optional[date] = None
    last_known_raw: str = ""
    for p in parsed:
        if p["_date_obj"] is not None:
            last_known_date = p["_date_obj"]
            last_known_raw = p["date"]
        elif last_known_date is not None:
            p["_date_obj"] = last_known_date
            p["date"] = last_known_raw

    parsed = _expand_installments(parsed, db)

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
            "card_last4": p.get("card_last4", ""),
            "transaction_id": p["transaction_id"],
            "installment_number": p["installment_number"],
            "installment_total": p["installment_total"],
            "installment_group_id": p["installment_group_id"],
            "suggested_category": cat_name,
            "is_duplicate": _is_duplicate(db, row_date, p["amount"], p["description"], p["transaction_id"], p["installment_number"], p["installment_total"], p.get("card_last4") or None) if row_date else False,
            "is_auto_generated": p.get("_auto_generated", False),
        })

    non_auto = [r for r in rows if not r.get("is_auto_generated")]
    if not non_auto:
        raise HTTPException(422, "No se encontraron transacciones en el archivo. El resumen puede estar vacío o sin consumos.")

    summary = {
        "card_last4":         closing_info["card_last_digits"] or _pdf_last4_fallback,
        "card_type":          closing_info["card_type"] or "",
        "bank":               closing_info["bank"] or "",
        "closing_date":       closing_info["closing_date"].isoformat() if closing_info["closing_date"] else None,
        "due_date":           closing_info["due_date"].isoformat() if closing_info["due_date"] else None,
        "total_ars":          closing_info["total_ars"],
        "total_usd":          closing_info["total_usd"],
        "future_charges_ars": closing_info["future_charges_ars"],
        "future_charges_usd": closing_info["future_charges_usd"],
    }
    return {"rows": rows, "raw_count": len(rows_raw), "summary": summary}


@router.post("/rows-confirm")
def rows_confirm_import(body: RowsConfirmBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cats = db.query(Category).all()
    user_cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    card_bank_map = {c.last4_digits: _normalize_bank(c.bank) for c in user_cards if c.last4_digits}
    imported = 0
    skipped = 0

    for r in body.rows:
        try:
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
            row_last4 = str(r.get("card_last4") or "").strip()[:4] or None
            if _is_duplicate(db, parsed_date, amount, desc, txn_id, inst_num, inst_total, row_last4):
                skipped += 1
                continue

            raw_currency = str(r.get("currency", "") or "").strip().upper()
            currency = "USD" if raw_currency == "USD" else "ARS"
            category_id = _resolve_category(db, amount, desc, cats)
            norm_bank = _normalize_bank(str(r.get("bank", "") or ""))
            if row_last4 and row_last4 in card_bank_map:
                norm_bank = card_bank_map[row_last4]
            norm_person = _normalize_person(str(r.get("person", "") or ""), db)

            db.add(Expense(
                date=parsed_date,
                description=desc,
                amount=amount,
                currency=currency,
                category_id=category_id,
                card=str(r.get("card", "") or ""),
                bank=norm_bank,
                person=norm_person,
                card_last4=row_last4,
                transaction_id=txn_id,
                installment_number=inst_num,
                installment_total=inst_total,
                installment_group_id=str(r.get("installment_group_id") or "") or None,
                user_id=current_user.id,
            ))

            # Auto-create card if not exists
            row_card_name = str(r.get("card", "") or "").strip()
            if row_last4 and row_card_name:
                existing_card = next(
                    (c for c in user_cards if c.last4_digits == row_last4), None
                )
                if not existing_card:
                    new_card = Card(
                        name=row_card_name,
                        bank=norm_bank,
                        last4_digits=row_last4,
                        card_type="credito",  # default a credito
                        user_id=current_user.id,
                    )
                    db.add(new_card)
                    user_cards.append(new_card)  # agregar a la lista para próximos gastos

            imported += 1
        except Exception:
            skipped += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}


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
