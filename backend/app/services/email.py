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


def send_impersonation_transcript(
    admin_email: str,
    target_email: str,
    session_start: str,
    session_end: str,
    actions: list[dict],
    chat: list[dict],
) -> bool:
    actions_html = ""
    for a in actions:
        actions_html += f"""
        <tr>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;">{a.get("created_at", "")}</td>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;">{a.get("action", "")}</td>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;">{a.get("ip_address", "")}</td>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;">{a.get("details", "") or ""}</td>
        </tr>"""

    chat_html = ""
    for c in chat:
        chat_html += f"""
        <tr>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;">{c.get("created_at", "")}</td>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;font-weight:600;">{c.get("sender", "")}</td>
          <td style="padding:6px;border:1px solid #e5e7eb;font-size:12px;">{c.get("message", "")}</td>
        </tr>"""

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px;">
      <h1 style="font-size:20px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">Resumen de sesión de soporte</h1>
      <p style="color:#666;font-size:14px;margin-bottom:24px;">
        Se finalizó una sesión de acceso administrativo.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:4px 0;font-size:13px;color:#333;"><strong>Admin:</strong> {admin_email}</p>
        <p style="margin:4px 0;font-size:13px;color:#333;"><strong>Usuario:</strong> {
        target_email
    }</p>
        <p style="margin:4px 0;font-size:13px;color:#333;"><strong>Inicio:</strong> {
        session_start
    }</p>
        <p style="margin:4px 0;font-size:13px;color:#333;"><strong>Fin:</strong> {session_end}</p>
      </div>

      <h2 style="font-size:16px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">Acciones realizadas</h2>
      {
        "<p style='color:#999;font-size:13px;'>Sin acciones registradas.</p>"
        if not actions
        else f'''
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Fecha</th>
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Acción</th>
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">IP</th>
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Detalles</th>
          </tr>
        </thead>
        <tbody>{actions_html}</tbody>
      </table>'''
    }

      <h2 style="font-size:16px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">Chat</h2>
      {
        "<p style='color:#999;font-size:13px;'>Sin mensajes.</p>"
        if not chat
        else f'''
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Hora</th>
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Remitente</th>
            <th style="padding:6px;border:1px solid #e5e7eb;text-align:left;font-size:11px;">Mensaje</th>
          </tr>
        </thead>
        <tbody>{chat_html}</tbody>
      </table>'''
    }

      <p style="color:#999;font-size:11px;margin-top:32px;">
        Este email se envió automáticamente al finalizar la sesión de soporte.
      </p>
    </div>
    """

    subject = f"[Oikonomia] Resumen sesión de soporte — {target_email}"
    sent = _send(subject, html, admin_email)
    if target_email and target_email != admin_email:
        _send(subject, html, target_email)
    return sent
