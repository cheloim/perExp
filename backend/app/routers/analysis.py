import json
import os
from calendar import monthrange
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types as genai_types
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models import AnalysisHistory, Category, Expense, User
from app.prompts import ANALYSIS_SYSTEM_PROMPT
from app.schemas import AnalysisHistoryResponse, AnalysisRequest
from app.services.auth import get_current_user

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("/stream")
async def stream_analysis(req: AnalysisRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Expense).filter(Expense.user_id == current_user.id)
    if req.month:
        try:
            y, m = int(req.month[:4]), int(req.month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1),
                Expense.date <= date(y, m, monthrange(y, m)[1]),
            )
        except (ValueError, IndexError):
            pass

    expenses = q.all()
    categories = db.query(Category).all()
    cat_map = {c.id: c for c in categories}

    async def no_data_stream():
        msg = "No hay gastos registrados para el período seleccionado. Importá o cargá algunos gastos primero."
        yield f"data: {json.dumps({'text': msg})}\n\n"
        yield "data: [DONE]\n\n"

    if not expenses:
        return StreamingResponse(no_data_stream(), media_type="text/event-stream")

    total = sum(e.amount for e in expenses)

    by_cat: dict = {}
    for e in expenses:
        cat_name = cat_map[e.category_id].name if e.category_id and e.category_id in cat_map else "Sin categoría"
        by_cat[cat_name] = by_cat.get(cat_name, 0.0) + e.amount

    by_month: dict = {}
    for e in expenses:
        key = e.date.strftime("%Y-%m")
        by_month[key] = by_month.get(key, 0.0) + e.amount

    top_10 = sorted(expenses, key=lambda x: x.amount, reverse=True)[:10]

    period = ""
    if req.month:
        period = f"Período: {req.month}"
    else:
        dates = [e.date for e in expenses]
        period = f"Período: {min(dates)} → {max(dates)}" if dates else ""

    data_text = f"""
{period}

RESUMEN:
- Total gastado: ${total:,.2f}
- Transacciones: {len(expenses)}
- Promedio por transacción: ${total/len(expenses):,.2f}
{f'- Meses: {len(by_month)}, promedio mensual: ${total/len(by_month):,.2f}' if len(by_month) > 1 else ''}

GASTOS POR CATEGORÍA:
{chr(10).join(f"- {k}: ${v:,.2f} ({v/total*100:.1f}%)" for k, v in sorted(by_cat.items(), key=lambda x: x[1], reverse=True))}

GASTOS POR MES:
{chr(10).join(f"- {k}: ${v:,.2f}" for k, v in sorted(by_month.items()))}

TOP 10 GASTOS MÁS ALTOS:
{chr(10).join(f"- {e.date} | {e.description} | ${e.amount:,.2f} | {cat_map.get(e.category_id, type('C', (), {'name': 'Sin cat'})()).name}" for e in top_10)}
"""

    user_message = data_text.strip()
    if req.question:
        user_message += f"\n\nPREGUNTA ESPECÍFICA DEL USUARIO:\n{req.question}"
    else:
        user_message += "\n\nAnalizá estos gastos en detalle y dame sugerencias concretas para optimizar mis finanzas."

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no está configurada. Creá un archivo .env con tu API key.")

    expense_count_val = len(expenses)
    total_val = total
    accumulated_text: list = []

    async def generate():
        try:
            client = genai.Client(api_key=api_key)
            async for chunk in await client.aio.models.generate_content_stream(
                model="gemini-flash-latest",
                contents=user_message,
                config=genai_types.GenerateContentConfig(
                    system_instruction=(None if req.debug_mode else ANALYSIS_SYSTEM_PROMPT),
                ),
            ):
                if chunk.text:
                    accumulated_text.append(chunk.text)
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'text': f'Error: {e}'})}\n\n"

        if accumulated_text:
            hist_db = SessionLocal()
            try:
                hist_db.add(AnalysisHistory(
                    created_at=datetime.utcnow(),
                    month=req.month,
                    question=req.question,
                    result_text="".join(accumulated_text),
                    expense_count=expense_count_val,
                    total_amount=total_val,
                    user_id=current_user.id,
                ))
                hist_db.commit()
            except Exception:
                pass
            finally:
                hist_db.close()

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/summarize")
async def summarize_chat(body: dict):
    """Stream a concise summary of a chat conversation (for session resume)."""
    import json as _json
    from fastapi.responses import StreamingResponse as _SR
    from google import genai as _genai
    from google.genai import types as _gtypes

    messages = body.get("messages", [])
    if not messages:
        async def _empty():
            yield f"data: {_json.dumps({'text': 'Sin mensajes para resumir.'})}\n\ndata: [DONE]\n\n"
        return _SR(_empty(), media_type="text/event-stream")

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        async def _no_key():
            yield f"data: {_json.dumps({'text': 'GOOGLE_API_KEY no configurada.'})}\n\ndata: [DONE]\n\n"
        return _SR(_no_key(), media_type="text/event-stream")

    convo = "\n".join(
        f"{'Usuario' if m.get('role') == 'user' else 'Asistente'}: {m.get('text', '')}"
        for m in messages if m.get("text")
    )
    prompt = (
        "Resumí la siguiente conversación en un párrafo conciso (máx. 5 oraciones). "
        "El resumen debe capturar los temas principales, conclusiones y cualquier dato clave "
        "para que el usuario pueda retomar el contexto en una nueva sesión.\n\n"
        f"CONVERSACIÓN:\n{convo}"
    )

    async def generate():
        try:
            client = _genai.Client(api_key=api_key)
            async for chunk in await client.aio.models.generate_content_stream(
                model="gemini-flash-latest",
                contents=prompt,
                config=_gtypes.GenerateContentConfig(temperature=0.3),
            ):
                if chunk.text:
                    yield f"data: {_json.dumps({'text': chunk.text})}\n\n"
        except Exception as e:
            yield f"data: {_json.dumps({'text': f'Error: {e}'})}\n\n"
        yield "data: [DONE]\n\n"

    return _SR(generate(), media_type="text/event-stream",
               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/history", response_model=List[AnalysisHistoryResponse])
def get_analysis_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AnalysisHistory).filter(AnalysisHistory.user_id == current_user.id).order_by(desc(AnalysisHistory.id)).limit(50).all()


@router.delete("/history/{hist_id}")
def delete_analysis_history(hist_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    h = db.query(AnalysisHistory).filter(AnalysisHistory.id == hist_id, AnalysisHistory.user_id == current_user.id).first()
    if not h:
        raise HTTPException(404, "Historial no encontrado")
    db.delete(h)
    db.commit()
    return {"ok": True}
