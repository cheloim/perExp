import logging
import os
from datetime import datetime

import resend

logger = logging.getLogger(__name__)

email_api_key = os.getenv("EMAIL_API_KEY")
if email_api_key:
    resend.api_key = email_api_key

FROM_NAME = os.getenv("SMTP_FROM", "NikoFin")
FROM_ADDRESS = os.getenv("SMTP_FROM_ADDRESS", "noreply@resend.dev")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@nikofin.com")


def _send(subject: str, html: str, to: str, to_name: str = "") -> bool:
    """Send a transactional email via Resend. Returns True on success."""
    if not email_api_key:
        logger.warning("EMAIL_API_KEY not set — cannot send email")
        return False
    try:
        from_addr = f"{FROM_NAME} <{FROM_ADDRESS}>"
        params: resend.Emails.SendParams = {
            "from": from_addr,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        resend.Emails.send(params)
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False


def send_password_reset_email(to: str, token: str, base_url: str) -> bool:
    reset_url = f"{base_url}/reset-password?token={token}"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 8px; background: #3b82f6; color: white; font-weight: bold; font-size: 20px; line-height: 48px;">N</div>
      </div>
      <h1 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">Restablecer contraseña</h1>
      <p style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
        Recibimos una solicitud para restablecer tu contraseña en NikoFin. Haz clic en el botón de abajo para elegir una nueva contraseña.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="{reset_url}" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">Restablecer contraseña</a>
      </div>
      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        Este enlace expira en 15 minutos. Si no solicitaste este cambio, podés ignorar este email.
      </p>
    </div>
    """

    result = _send("Restablecer contraseña — NikoFin", html, to)
    if result:
        logger.info(f"Password reset email sent to {to}")
    return result


def send_verification_email(to: str, token: str, base_url: str) -> bool:
    verify_url = f"{base_url}/verify-email?token={token}"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 8px; background: #3b82f6; color: white; font-weight: bold; font-size: 20px; line-height: 48px;">N</div>
      </div>
      <h1 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">Verificar tu email</h1>
      <p style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
        Gracias por registrarte en NikoFin. Verificá tu email haciendo clic en el botón de abajo.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="{verify_url}" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">Verificar email</a>
      </div>
      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        Este enlace expira en 24 horas. Si no te registraste, podés ignorar este email.
      </p>
    </div>
    """

    result = _send("Verificar tu email — NikoFin", html, to)
    if result:
        logger.info(f"Verification email sent to {to}")
    return result


def send_report_failure_email(user_id: int, month_str: str, error: str) -> bool:
    timestamp = datetime.utcnow().strftime("%d/%m/%Y %H:%M:%S UTC")

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 8px; background: #ef4444; color: white; font-weight: bold; font-size: 20px; line-height: 48px;">!</div>
      </div>
      <h1 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">Reporte mensual falló</h1>
      <p style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
        La generación del reporte mensual falló después de 3 intentos.
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 4px 0; font-size: 13px; color: #333;"><strong>User ID:</strong> {user_id}</p>
        <p style="margin: 4px 0; font-size: 13px; color: #333;"><strong>Mes:</strong> {month_str}</p>
        <p style="margin: 4px 0; font-size: 13px; color: #333;"><strong>Error:</strong> {error[:300]}</p>
        <p style="margin: 4px 0; font-size: 13px; color: #333;"><strong>Timestamp:</strong> {timestamp}</p>
      </div>
      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        Revisá los logs del worker para más detalles.
      </p>
    </div>
    """

    result = _send(
        f"[ALERTA] Reporte mensual falló — {month_str} — User {user_id}",
        html,
        ADMIN_EMAIL,
    )
    if result:
        logger.info(f"Report failure email sent for user {user_id}, month {month_str}")
    return result
