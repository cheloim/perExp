import logging
import os

import resend

logger = logging.getLogger(__name__)

resend_api_key = os.getenv("RESEND_API_KEY")
if resend_api_key:
    resend.api_key = resend_api_key

FROM_EMAIL = os.getenv("SMTP_FROM", "Financial Planning <onboarding@resend.dev>")


def send_password_reset_email(to: str, token: str, base_url: str) -> bool:
    if not resend_api_key:
        logger.warning("RESEND_API_KEY not set — cannot send password reset email")
        return False

    reset_url = f"{base_url}/reset-password?token={token}"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 8px; background: #3b82f6; color: white; font-weight: bold; font-size: 20px; line-height: 48px;">F</div>
      </div>
      <h1 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">Restablecer contraseña</h1>
      <p style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
        Recibimos una solicitud para restablecer tu contraseña en Financial Planning. Haz clic en el botón de abajo para elegir una nueva contraseña.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="{reset_url}" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">Restablecer contraseña</a>
      </div>
      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        Este enlace expira en 15 minutos. Si no solicitaste este cambio, podés ignorar este email.
      </p>
    </div>
    """

    try:
        params: resend.Emails.SendParams = {
            "from": FROM_EMAIL,
            "to": [to],
            "subject": "Restablecer contraseña — Financial Planning",
            "html": html,
        }
        result = resend.Emails.send(params)
        logger.info(f"Password reset email sent to {to}: {result}")
        return True
    except Exception as e:
        logger.error(f"Failed to send password reset email to {to}: {e}")
        return False
