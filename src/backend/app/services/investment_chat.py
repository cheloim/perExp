"""SSE use case for the investments assistant.

The server holds no conversation state: the client sends its whole thread and
the question; the model streams text frames terminated by ``[DONE]``.
"""

from __future__ import annotations

import json

from fastapi.responses import StreamingResponse

from app.prompts import INVESTMENTS_SYSTEM_PROMPT
from app.services.chat_context import to_llm_messages
from app.services.llm import get_client, is_configured


def _error_stream(message: str) -> StreamingResponse:
    async def _err():
        yield f"data: {json.dumps({'error': True, 'text': message})}\n\ndata: [DONE]\n\n"

    return StreamingResponse(_err(), media_type="text/event-stream")


def investments_chat_response(body: dict) -> StreamingResponse:
    """Build the SSE response for a chat request."""
    question = (body.get("question") or "").strip()
    context = (body.get("context") or "").strip()
    if not question:
        return _error_stream("Pregunta vacía.")

    if not is_configured("INVESTMENTS_LLM_API_KEY"):
        return _error_stream("INVESTMENTS_LLM_API_KEY / LLM_API_KEY no configurada.")

    user_message = question
    if context:
        user_message = f"{context}\n\nPREGUNTA: {question}"

    async def generate():
        try:
            client = get_client(api_key_env="INVESTMENTS_LLM_API_KEY")
            async for text in client.astream(
                to_llm_messages(body.get("messages"), user_message),
                feature="investments_chat",
                system=INVESTMENTS_SYSTEM_PROMPT,
                temperature=0.4,
            ):
                yield f"data: {json.dumps({'text': text})}\n\n"
        except Exception:
            # Marked as an error frame: the text is not a reply, and the client
            # must not store it in the thread as if the model had said it.
            yield f"data: {json.dumps({'error': True, 'text': 'Error al procesar la solicitud'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
