"""WhatsApp webhook endpoints for Meta Cloud API.

Handles:
- GET  /webhook/whatsapp  — Meta verification challenge
- POST /webhook/whatsapp  — Incoming messages
"""

import asyncio
import logging
import os

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["whatsapp"])

VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "oikonomia-whatsapp-dev")


@router.get("/whatsapp")
async def verify_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
):
    """Handle Meta's webhook verification challenge.

    Meta sends a GET request with:
    - hub.mode = "subscribe"
    - hub.verify_token = your configured token
    - hub.challenge = random string to echo back
    """
    logger.info("[WA_WEBHOOK] Verification request: mode=%s", hub_mode)

    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        logger.info("[WA_WEBHOOK] Verification successful")
        return PlainTextResponse(content=hub_challenge)

    logger.warning("[WA_WEBHOOK] Verification failed: invalid token")
    return JSONResponse(content={"error": "Forbidden"}, status_code=403)


@router.post("/whatsapp")
async def receive_webhook(request: Request):
    """Handle incoming WhatsApp messages.

    Meta sends a POST with the message payload. We must respond with 200 within 5 seconds.
    Processing is done asynchronously.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(content={"status": "ok"})

    logger.info("[WA_WEBHOOK] Received payload")

    # Process asynchronously to respond quickly
    asyncio.create_task(_process_webhook(body))

    return JSONResponse(content={"status": "ok"})


async def _process_webhook(body: dict) -> None:
    """Process webhook payload asynchronously."""
    try:
        from app.whatsapp_bot import handle_whatsapp_message

        # Check if this is a WhatsApp Business Account event
        if body.get("object") != "whatsapp_business_account":
            return

        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})

                # Skip status updates (delivery receipts, read receipts)
                if "statuses" in value:
                    continue

                # Process messages
                messages = value.get("messages", [])
                contacts = value.get("contacts", [])

                for msg in messages:
                    phone = msg.get("from", "")
                    message_id = msg.get("id", "")
                    msg_type = msg.get("type", "")

                    # Get contact name if available
                    contact_name = ""
                    for contact in contacts:
                        if contact.get("wa_id") == phone:
                            contact_name = contact.get("profile", {}).get("name", "")
                            break

                    logger.info(
                        "[WA_WEBHOOK] Message from %s (%s): type=%s",
                        phone,
                        contact_name,
                        msg_type,
                    )

                    await handle_whatsapp_message(
                        phone=phone,
                        message_id=message_id,
                        msg_type=msg_type,
                        msg_data=msg,
                    )

    except Exception as e:
        logger.error("[WA_WEBHOOK] Error processing webhook: %s", e, exc_info=True)
