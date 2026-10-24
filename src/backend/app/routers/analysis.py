import json
import re
import unicodedata
from calendar import monthrange
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models import AnalysisHistory, Category, Expense, User
from app.prompts import ANALYSIS_SYSTEM_PROMPT
from app.schemas import AnalysisHistoryResponse, AnalysisRequest
from app.services.auth import get_current_user
from app.services.chat_context import to_llm_messages
from app.services.llm import LLMMessage, get_client, is_configured

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _first_of_month_back(today: date, back: int) -> date:
    """First day of the month `back` months before the month `today` is in."""
    total = today.year * 12 + today.month - 1 - back
    return date(total // 12, total % 12 + 1, 1)


#: The question words that carry no referent. What survives this filter is the
#: merchant or category the user is asking about ("YENNY TORTUGAS", "Edenor",
#: "supermercado"). Deliberately question-shaped rather than a full Spanish
#: stopword list: an over-eager filter would drop the very term being asked.
_QUESTION_STOPWORDS = {
    "algun",
    "algunas",
    "algunos",
    "analiza",
    "analizar",
    "analisis",
    "ante",
    "antes",
    "aquel",
    "aqui",
    "asi",
    "aun",
    "aunque",
    "bajo",
    "bien",
    "cada",
    "casi",
    "compara",
    "comparacion",
    "comparar",
    "como",
    "con",
    "contra",
    "cual",
    "cuales",
    "cuando",
    "cuanto",
    "de",
    "decime",
    "del",
    "desde",
    "dime",
    "donde",
    "dos",
    "durante",
    "el",
    "ella",
    "ellas",
    "ello",
    "ellos",
    "en",
    "entre",
    "era",
    "eran",
    "es",
    "esa",
    "esas",
    "ese",
    "eso",
    "esos",
    "esta",
    "estan",
    "este",
    "esto",
    "estos",
    "explicame",
    "fue",
    "gasta",
    "gastado",
    "gaste",
    "gasto",
    "gastos",
    "hace",
    "hacia",
    "hasta",
    "hay",
    "las",
    "le",
    "les",
    "lo",
    "los",
    "mas",
    "me",
    "mes",
    "meses",
    "mi",
    "mio",
    "mios",
    "mis",
    "mucho",
    "nada",
    "ni",
    "no",
    "nos",
    "nuestra",
    "nuestro",
    "otra",
    "otras",
    "otro",
    "otros",
    "para",
    "pero",
    "poco",
    "por",
    "porque",
    "puedo",
    "puede",
    "quiero",
    "quedo",
    "que",
    "quien",
    "saber",
    "segun",
    "ser",
    "si",
    "sido",
    "sin",
    "sobre",
    "son",
    "su",
    "sus",
    "tambien",
    "tan",
    "tanto",
    "tiene",
    "todo",
    "todos",
    "tras",
    "tu",
    "tus",
    "un",
    "una",
    "unas",
    "uno",
    "unos",
    "varios",
    "veces",
    "vengo",
    "ver",
    "voy",
    "ya",
    "yo",
}

#: How many matching spends a question may pull into the prompt. The aggregates
#: are already bounded; this caps the one block that scales with what was typed.
_RETRIEVAL_LIMIT = 20


def _norm(text: str) -> str:
    """Lowercased and accent-free, so "YENNY" finds "yenny" and "á" finds "a"."""
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


def _question_terms(question: str | None) -> list[str]:
    """The content words of a question: its merchant or category referent."""
    if not question:
        return []
    words = re.findall(r"[a-z0-9]{3,}", _norm(question))
    return [w for w in words if w not in _QUESTION_STOPWORDS][:8]


def _cat_name(expense, cat_map: dict) -> str:
    category = cat_map.get(expense.category_id) if expense.category_id else None
    return category.name if category else "Sin categoría"


@router.post(
    "/stream",
    summary="Stream expense analysis",
    description="SSE streaming endpoint that analyzes expenses using an LLM and returns insights with optional user question.",
)
async def stream_analysis(
    req: AnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Expense).filter(Expense.user_id == current_user.id)
    window_start: date | None = None
    exact_month: tuple[int, int] | None = None
    if req.month:
        try:
            exact_month = (int(req.month[:4]), int(req.month[5:7]))
        except (ValueError, IndexError):
            exact_month = None

    if exact_month:
        y, m = exact_month
        q = q.filter(
            Expense.date >= date(y, m, 1),
            Expense.date <= date(y, m, monthrange(y, m)[1]),
        )
    else:
        # A window, not a month: the current month plus `months - 1` previous
        # ones, with no upper bound so a spend dated later is still analysed.
        # Always bounded — twelve months unless the request names a length —
        # so no question can silently ask for the whole history.
        window_start = _first_of_month_back(date.today(), (req.months or 12) - 1)
        q = q.filter(Expense.date >= window_start)

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
    by_month: dict = {}
    for e in expenses:
        cat_name = _cat_name(e, cat_map)
        by_cat[cat_name] = by_cat.get(cat_name, 0.0) + e.amount
        key = e.date.strftime("%Y-%m")
        by_month[key] = by_month.get(key, 0.0) + e.amount

    top_10 = sorted(expenses, key=lambda x: x.amount, reverse=True)[:10]

    period = ""
    if exact_month:
        period = f"Período: {req.month}"
    else:
        period = f"Período: {window_start} → {date.today()}"

    # Month-over-month is computed here rather than left to the model's
    # arithmetic: the deltas are exactly what "compará con el mes pasado"
    # needs, and a model subtracting two totals gets it wrong often enough.
    month_keys = sorted(by_month)
    current_key = date.today().strftime("%Y-%m")
    month_deltas = []
    # strict=False: the halves are one apart by design — each month against the
    # one that precedes it.
    for prev_key, curr_key in zip(month_keys, month_keys[1:], strict=False):
        delta = by_month[curr_key] - by_month[prev_key]
        pct = f"{delta / by_month[prev_key] * 100:+.1f}%" if by_month[prev_key] else "sin base"
        sign = "+" if delta >= 0 else "-"
        in_course = " (mes en curso)" if curr_key == current_key else ""
        month_deltas.append(
            f"- {curr_key}: ${by_month[curr_key]:,.2f} "
            f"(vs {prev_key}: {pct}, {sign}${abs(delta):,.2f}){in_course}"
        )

    # The same comparison for the categories of the newest month against the
    # one before it — top 5 by the newest month, so the block stays bounded.
    cat_deltas = []
    if len(month_keys) >= 2:
        curr_key, prev_key = month_keys[-1], month_keys[-2]
        curr_cat: dict = {}
        prev_cat: dict = {}
        for e in expenses:
            key = e.date.strftime("%Y-%m")
            name = _cat_name(e, cat_map)
            if key == curr_key:
                curr_cat[name] = curr_cat.get(name, 0.0) + e.amount
            elif key == prev_key:
                prev_cat[name] = prev_cat.get(name, 0.0) + e.amount
        for name in sorted(curr_cat, key=lambda k: curr_cat[k], reverse=True)[:5]:
            curr_val, prev_val = curr_cat[name], prev_cat.get(name, 0.0)
            pct = f"{(curr_val - prev_val) / prev_val * 100:+.1f}%" if prev_val else "sin base"
            cat_deltas.append(f"- {name}: ${curr_val:,.2f} (vs ${prev_val:,.2f}, {pct})")

    # The spends a question is about, found from the words in the question. The
    # window arrives aggregated, so "¿cuánto gasté en YENNY TORTUGAS?" would
    # otherwise have nothing to answer from. Scoped like everything else: only
    # the user's own expenses are in `expenses` to begin with.
    terms = _question_terms(req.question)
    matches = []
    if terms:
        scored = []
        for e in expenses:
            hay, cat = _norm(e.description), _norm(_cat_name(e, cat_map))
            score = sum(2 for t in terms if t in hay) + sum(1 for t in terms if t in cat)
            if score:
                scored.append((score, e.amount, e))
        scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
        matches = [e for _, _, e in scored[:_RETRIEVAL_LIMIT]]
    retrieval = (
        (
            f"GASTOS QUE COINCIDEN CON LA PREGUNTA ({', '.join(terms)}):\n"
            + "\n".join(
                f"- {e.date} | {e.description} | ${e.amount:,.2f} | {_cat_name(e, cat_map)}"
                for e in matches
            )
        )
        if matches
        else ""
    )

    data_text = f"""
{period}

RESUMEN:
- Total gastado: ${total:,.2f}
- Transacciones: {len(expenses)}
- Promedio por transacción: ${total / len(expenses):,.2f}
{f"- Meses: {len(by_month)}, promedio mensual: ${total / len(by_month):,.2f}" if len(by_month) > 1 else ""}

GASTOS POR CATEGORÍA:
{chr(10).join(f"- {k}: ${v:,.2f} ({v / total * 100:.1f}%)" for k, v in sorted(by_cat.items(), key=lambda x: x[1], reverse=True))}

GASTOS POR MES:
{chr(10).join(f"- {k}: ${v:,.2f}" for k, v in sorted(by_month.items()))}

{f"COMPARACIÓN MES A MES:{chr(10)}{chr(10).join(month_deltas)}" if month_deltas else ""}
{f"CATEGORÍAS — {month_keys[-1]} vs {month_keys[-2]} (top 5):{chr(10)}{chr(10).join(cat_deltas)}" if cat_deltas else ""}
TOP 10 GASTOS MÁS ALTOS:
{chr(10).join(f"- {e.date} | {e.description} | ${e.amount:,.2f} | {_cat_name(e, cat_map)}" for e in top_10)}

{retrieval}
"""

    user_message = data_text.strip()
    if req.question:
        user_message += f"\n\nPREGUNTA ESPECÍFICA DEL USUARIO:\n{req.question}"
    else:
        user_message += "\n\nAnalizá estos gastos en detalle y dame sugerencias concretas para optimizar mis finanzas."

    api_key_env = "LLM_API_KEY"
    if not is_configured(api_key_env):
        raise HTTPException(
            500, "LLM_API_KEY no está configurada. Creá un archivo .env con tu API key."
        )

    # The whole thread, so the model knows what has already been said.
    contents = to_llm_messages([m.model_dump() for m in req.messages or []], user_message)

    expense_count_val = len(expenses)
    total_val = total
    accumulated_text: list = []

    async def generate():
        try:
            client = get_client(api_key_env=api_key_env)
            async for text in client.astream(
                contents,
                feature="analysis_chat",
                system=(None if req.debug_mode else ANALYSIS_SYSTEM_PROMPT),
            ):
                accumulated_text.append(text)
                yield f"data: {json.dumps({'text': text})}\n\n"
        except Exception:
            # Marked as an error frame: the text is not a reply, and the client
            # must not store it in the thread as if the model had said it.
            yield f"data: {json.dumps({'error': True, 'text': 'Error al procesar la solicitud'})}\n\n"

        if accumulated_text:
            hist_db = SessionLocal()
            try:
                hist_db.add(
                    AnalysisHistory(
                        created_at=datetime.utcnow(),
                        month=req.month,
                        question=req.question,
                        result_text="".join(accumulated_text),
                        expense_count=expense_count_val,
                        total_amount=total_val,
                        user_id=current_user.id,
                    )
                )
                hist_db.commit()
            except Exception as e:
                import logging

                logging.getLogger(__name__).error(f"Failed to save analysis history: {e}")
            finally:
                hist_db.close()

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/summarize",
    summary="Summarize chat conversation",
    description="SSE streaming endpoint that generates a concise summary of a chat conversation for session resume.",
)
async def summarize_chat(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """Stream a concise summary of a chat conversation (for session resume)."""
    import json as _json

    from fastapi.responses import StreamingResponse as _SR

    messages = body.get("messages", [])
    if not messages:

        async def _empty():
            yield f"data: {_json.dumps({'text': 'Sin mensajes para resumir.'})}\n\ndata: [DONE]\n\n"

        return _SR(_empty(), media_type="text/event-stream")

    if not is_configured():

        async def _no_key():
            yield f"data: {_json.dumps({'error': True, 'text': 'LLM_API_KEY no configurada.'})}\n\ndata: [DONE]\n\n"

        return _SR(_no_key(), media_type="text/event-stream")

    convo = "\n".join(
        f"{'Usuario' if m.get('role') == 'user' else 'Asistente'}: {m.get('text', '')}"
        for m in messages
        if m.get("text")
    )
    prompt = (
        "Resumí la siguiente conversación en un párrafo conciso (máx. 5 oraciones). "
        "El resumen debe capturar los temas principales, conclusiones y cualquier dato clave "
        "para que el usuario pueda retomar el contexto en una nueva sesión.\n\n"
        f"CONVERSACIÓN:\n{convo}"
    )

    async def generate():
        try:
            async for text in get_client().astream(
                [LLMMessage(role="user", text=prompt)],
                feature="analysis_summary",
                temperature=0.3,
            ):
                yield f"data: {_json.dumps({'text': text})}\n\n"
        except Exception:
            yield f"data: {_json.dumps({'error': True, 'text': 'Error al procesar la solicitud'})}\n\n"
        yield "data: [DONE]\n\n"

    return _SR(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/history",
    response_model=list[AnalysisHistoryResponse],
    summary="List analysis history",
    description="Retrieve the last 50 analysis history entries for the current user.",
)
def get_analysis_history(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return (
        db.query(AnalysisHistory)
        .filter(AnalysisHistory.user_id == current_user.id)
        .order_by(desc(AnalysisHistory.id))
        .limit(50)
        .all()
    )


@router.delete(
    "/history/{hist_id}",
    summary="Delete an analysis entry",
    description="Delete a specific analysis history entry by ID.",
)
def delete_analysis_history(
    hist_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    h = (
        db.query(AnalysisHistory)
        .filter(AnalysisHistory.id == hist_id, AnalysisHistory.user_id == current_user.id)
        .first()
    )
    if not h:
        raise HTTPException(404, "Historial no encontrado")
    db.delete(h)
    db.commit()
    return {"ok": True}
