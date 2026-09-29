"""WhatsApp webhook endpoints for Meta Cloud API.

Handles:
- GET  /webhook/whatsapp             — Meta verification challenge
- POST /webhook/whatsapp             — Incoming messages
- POST /webhook/whatsapp/delete-user — Meta data deletion callback
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from app.metrics import WHATSAPP_MESSAGES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["whatsapp"])

VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "oikonomia-whatsapp-dev")
APP_SECRET = os.getenv("WHATSAPP_APP_SECRET", "")


def _verify_webhook_signature(body: bytes, signature_header: str | None) -> bool:
    """Verify Meta's X-Hub-Signature-256 HMAC on webhook payloads.

    If APP_SECRET is not configured, verification is skipped (dev mode).
    In production, APP_SECRET must be set.
    """
    if not APP_SECRET:
        # Dev mode: skip verification if no secret configured
        return True
    if not signature_header:
        return False
    # signature_header format: "sha256=<hex>"
    try:
        algo, received_sig = signature_header.split("=", 1)
    except ValueError:
        return False
    if algo != "sha256":
        return False
    expected_sig = hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected_sig, received_sig)


@router.get(
    "/whatsapp",
    summary="Verify WhatsApp webhook",
    description="Handle Meta's webhook verification challenge by validating the token and echoing the challenge.",
)
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


@router.post(
    "/whatsapp",
    summary="Receive WhatsApp messages",
    description="Accept incoming WhatsApp message payloads from Meta and process them asynchronously.",
)
async def receive_webhook(request: Request):
    """Handle incoming WhatsApp messages.

    Meta sends a POST with the message payload. We must respond with 200 within 5 seconds.
    Processing is done asynchronously. Verifies X-Hub-Signature-256 if APP_SECRET is set.
    """
    # Read raw body for signature verification
    raw_body = await request.body()

    # Verify HMAC signature
    signature_header = request.headers.get("X-Hub-Signature-256")
    if not _verify_webhook_signature(raw_body, signature_header):
        logger.warning("[WA_WEBHOOK] Invalid signature — rejecting request")
        return JSONResponse(content={"error": "Invalid signature"}, status_code=403)

    try:
        body = json.loads(raw_body)
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

                    WHATSAPP_MESSAGES.labels(direction="inbound").inc()

                    await handle_whatsapp_message(
                        phone=phone,
                        message_id=message_id,
                        msg_type=msg_type,
                        msg_data=msg,
                    )

    except Exception as e:
        logger.error("[WA_WEBHOOK] Error processing webhook: %s", e, exc_info=True)


# ---------------------------------------------------------------------------
# Meta Data Deletion Callback
# ---------------------------------------------------------------------------
# When a user requests deletion of their WhatsApp data through Meta settings,
# Meta sends a POST to this endpoint with a signed_request. We verify it,
# delete the user's data, and return a confirmation URL + code.
#
# https://developers.facebook.com/docs/whatsapp/cloud-api/guides/manage-data-deletion-requests


def _parse_signed_request(signed_request: str) -> dict | None:
    """Verify and decode Meta's signed_request payload.

    Format: base64url(hmac_sig) + '.' + base64url(json_payload)
    Returns the decoded payload dict, or None if verification fails.
    """
    if not APP_SECRET:
        # Dev mode: decode without verification
        try:
            _, payload_b64 = signed_request.split(".", 1)
            # Add padding if needed
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            return json.loads(base64.urlsafe_b64decode(payload_b64))
        except Exception:
            return None

    try:
        sig_b64, payload_b64 = signed_request.split(".", 1)
    except ValueError:
        return None

    # Decode signature
    try:
        sig_b64 += "=" * (4 - len(sig_b64) % 4)
        received_sig = base64.urlsafe_b64decode(sig_b64)
    except Exception:
        return None

    # Compute expected signature
    expected_sig = hmac.new(APP_SECRET.encode(), payload_b64.encode(), hashlib.sha256).digest()

    if not hmac.compare_digest(received_sig, expected_sig):
        return None

    # Decode payload
    try:
        payload_b64 += "=" * (4 - len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        return None


@router.post(
    "/whatsapp/delete-user",
    summary="Meta data deletion callback",
    description=(
        "Handles Meta's data deletion callback for WhatsApp users. "
        "Verifies the signed_request, deletes the user's account and all data, "
        "and returns a confirmation URL and code."
    ),
)
async def delete_user_callback(request: Request):
    """Handle Meta's data deletion callback.

    Meta sends a form-encoded POST with a 'signed_request' field when a user
    requests deletion of their WhatsApp data. We verify the request, find the
    user by their WhatsApp phone hash, and delete all their data.

    Returns:
        JSON with 'url' (confirmation page) and 'confirmation_code'.
    """
    # Parse form body
    form = await request.form()
    signed_request = form.get("signed_request")

    if not signed_request:
        logger.warning("[WA_DELETE] Missing signed_request parameter")
        return JSONResponse(content={"error": "Missing signed_request"}, status_code=400)

    # Verify and decode
    payload = _parse_signed_request(str(signed_request))
    if not payload:
        logger.warning("[WA_DELETE] Invalid signed_request")
        return JSONResponse(content={"error": "Invalid signed_request"}, status_code=403)

    user_id = payload.get("user_id")
    if not user_id:
        logger.warning("[WA_DELETE] No user_id in signed_request payload")
        return JSONResponse(content={"error": "Missing user_id in payload"}, status_code=400)

    logger.info("[WA_DELETE] Deletion request for WhatsApp user_id=%s", user_id)

    # Find and delete the user
    from app.database import SessionLocal
    from app.models import User
    from app.services.account_deletion import delete_user_and_all_data
    from app.services.encryption import compute_hmac

    db = SessionLocal()
    try:
        phone_hash = compute_hmac(str(user_id))
        user = db.query(User).filter(User.whatsapp_phone_hash == phone_hash).first()

        if not user:
            # User may have already been deleted or never linked
            logger.info(
                "[WA_DELETE] No user found for WhatsApp user_id=%s — returning success",
                user_id,
            )
        else:
            delete_user_and_all_data(db, user)
            logger.info("[WA_DELETE] Deleted user %s for WhatsApp user_id=%s", user.id, user_id)
    except Exception as e:
        logger.error("[WA_DELETE] Error deleting user: %s", e, exc_info=True)
        return JSONResponse(content={"error": "Internal error during deletion"}, status_code=500)
    finally:
        db.close()

    # Generate a confirmation code for Meta
    confirmation_code = secrets.token_hex(16)

    return JSONResponse(
        content={
            "url": "https://oikonomia.ar/privacy",
            "confirmation_code": confirmation_code,
        }
    )
