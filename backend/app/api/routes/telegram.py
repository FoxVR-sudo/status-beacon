from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.telegram_connect import process_telegram_update

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.post("/webhook/{secret}", status_code=status.HTTP_204_NO_CONTENT)
async def telegram_webhook(
    secret: str,
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    telegram_secret: str | None = Header(default=None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    if not settings.TELEGRAM_WEBHOOK_SECRET or secret != settings.TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=404, detail="Telegram webhook not found")
    if telegram_secret != settings.TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid Telegram webhook secret")

    await process_telegram_update(db, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)