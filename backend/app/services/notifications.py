import httpx
import aiosmtplib
from email.message import EmailMessage

from app.config import settings


async def send_email(to: str, subject: str, body: str, html_body: str | None = None) -> None:
    if not all([
        settings.SMTP_HOST,
        settings.SMTP_USER,
        settings.SMTP_PASSWORD,
        settings.FROM_EMAIL,
    ]):
        return

    use_tls = settings.SMTP_PORT in {465, 2465}
    start_tls = settings.SMTP_PORT in {25, 587, 2587}

    msg = EmailMessage()
    msg["From"] = settings.FROM_EMAIL
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
            use_tls=use_tls,
            start_tls=start_tls,
        )
    except Exception as exc:
        print(f"[email] Failed to send to {to}: {exc}")


async def send_telegram(chat_id: str, message: str) -> bool:
    if not settings.TELEGRAM_BOT_TOKEN:
        return False

    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(url, json={"chat_id": chat_id, "text": message})
            response.raise_for_status()
            payload = response.json()
            if not payload.get("ok"):
                print(f"[telegram] Failed to send to {chat_id}: {payload}")
                return False
            return True
    except Exception as exc:
        print(f"[telegram] Failed to send to {chat_id}: {exc}")
        return False
