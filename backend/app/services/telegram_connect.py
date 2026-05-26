import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.telegram_connection import TelegramConnection
from app.models.user import User

START_COMMAND_RE = re.compile(r"^/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]+))?$")
webhook_registered = False


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build_telegram_connect_url(token: str) -> str | None:
    if not settings.TELEGRAM_BOT_USERNAME:
        return None

    bot_username = settings.TELEGRAM_BOT_USERNAME.lstrip("@")
    return f"https://t.me/{bot_username}?start={token}"


def build_telegram_webhook_url() -> str | None:
    if not settings.TELEGRAM_WEBHOOK_SECRET:
        return None

    public_url = settings.FRONTEND_URL.rstrip("/")
    parsed = urlparse(public_url)
    if parsed.scheme != "https" or parsed.hostname in {"localhost", "127.0.0.1"}:
        return None

    return f"{public_url}/api/telegram/webhook/{settings.TELEGRAM_WEBHOOK_SECRET}"


def telegram_webhook_is_active() -> bool:
    return webhook_registered


def extract_start_token(text: str | None) -> str | None:
    if not text:
        return None

    match = START_COMMAND_RE.match(text.strip())
    if not match:
        return None

    return match.group(1)


def serialize_connection(connection: TelegramConnection, current_chat_id: str | None) -> dict:
    now = utc_now()
    status = connection.status
    if status == "pending" and connection.expires_at <= now:
        status = "expired"

    return {
        "token": connection.token,
        "status": status,
        "expires_at": connection.expires_at,
        "connect_url": build_telegram_connect_url(connection.token),
        "telegram_chat_id": current_chat_id,
    }


async def create_connection_session(db: AsyncSession, user: User) -> TelegramConnection:
    expires_at = utc_now() + timedelta(minutes=settings.TELEGRAM_CONNECT_EXPIRE_MINUTES)
    token = secrets.token_urlsafe(24)

    await db.execute(delete(TelegramConnection).where(TelegramConnection.user_id == user.id))

    connection = TelegramConnection(
        user_id=user.id,
        token=token,
        status="pending",
        expires_at=expires_at,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)
    return connection


async def _mark_expired_if_needed(db: AsyncSession, connection: TelegramConnection) -> None:
    if connection.status == "pending" and connection.expires_at <= utc_now():
        connection.status = "expired"
        await db.commit()
        await db.refresh(connection)


async def _apply_start_message(db: AsyncSession, chat_id: str, text: str | None) -> bool:
    token = extract_start_token(text)
    if not token:
        return False

    result = await db.execute(select(TelegramConnection).where(TelegramConnection.token == token))
    connection = result.scalar_one_or_none()
    if not connection:
        return False

    await _mark_expired_if_needed(db, connection)
    if connection.status != "pending":
        return connection.status == "connected"

    user_result = await db.execute(select(User).where(User.id == connection.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return False

    user.telegram_chat_id = str(chat_id)
    connection.chat_id = str(chat_id)
    connection.status = "connected"
    connection.connected_at = utc_now()
    await db.commit()
    await db.refresh(connection)

    from app.services.notifications import send_telegram

    await send_telegram(
        str(chat_id),
        "Telegram alerts are now connected to your SiteWatch account. Future monitor failures will be delivered here.",
    )
    return True


async def process_telegram_update(db: AsyncSession, update: dict) -> bool:
    message = update.get("message") or update.get("edited_message")
    if not message:
        return False

    chat = message.get("chat") or {}
    if chat.get("type") != "private":
        return False

    return await _apply_start_message(db, str(chat.get("id")), message.get("text"))


async def sync_telegram_connections(db: AsyncSession) -> int:
    if not settings.TELEGRAM_BOT_TOKEN:
        return 0

    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        print(f"[telegram-connect] Failed to read updates: {exc}")
        return 0

    applied = 0
    for update in payload.get("result", []):
        if await process_telegram_update(db, update):
            applied += 1

    return applied


async def register_telegram_webhook() -> bool:
    global webhook_registered

    webhook_registered = False
    webhook_url = build_telegram_webhook_url()
    if not webhook_url or not settings.TELEGRAM_BOT_TOKEN:
        return False

    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/setWebhook"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                url,
                json={
                    "url": webhook_url,
                    "secret_token": settings.TELEGRAM_WEBHOOK_SECRET,
                    "allowed_updates": ["message", "edited_message"],
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        print(f"[telegram-webhook] Failed to register webhook: {exc}")
        return False

    if not payload.get("ok"):
        print(f"[telegram-webhook] Failed to register webhook: {payload}")
        return False

    webhook_registered = True
    return True