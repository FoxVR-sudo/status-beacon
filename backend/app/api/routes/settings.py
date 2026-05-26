from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.config import settings
from app.database import get_db
from app.models.telegram_connection import TelegramConnection
from app.models.user import User
from app.api.deps import get_current_user
from app.services.billing import (
    BillingConfigurationError,
    BillingStateError,
    create_billing_portal_session,
    create_checkout_session,
    get_billing_summary,
)
from app.services.notifications import send_telegram
from app.services.telegram_connect import (
    create_connection_session,
    serialize_connection,
    sync_telegram_connections,
    telegram_webhook_is_active,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class UserResponse(BaseModel):
    email: str
    first_name: str
    last_name: str
    company_name: Optional[str] = None
    is_email_verified: bool
    is_admin: bool
    telegram_chat_id: Optional[str] = None
    telegram_bot_username: Optional[str] = None
    telegram_delivery_mode: Literal["disabled", "webhook", "polling_fallback"]

    model_config = {"from_attributes": True}


class UpdateUserRequest(BaseModel):
    telegram_chat_id: Optional[str] = None


class TelegramConnectResponse(BaseModel):
    token: str
    status: Literal["pending", "connected", "expired"]
    expires_at: datetime
    connect_url: Optional[str] = None
    telegram_chat_id: Optional[str] = None


class ActionResponse(BaseModel):
    message: str


class BillingSummaryResponse(BaseModel):
    current_plan_id: Literal["free", "pro", "agency"]
    subscription_status: Optional[str] = None
    current_period_end: Optional[datetime] = None
    checkout_enabled: bool
    can_start_checkout: bool
    portal_available: bool
    configured_plan_ids: list[str]


class BillingCheckoutRequest(BaseModel):
    plan_id: Literal["pro", "agency"]


class BillingSessionResponse(BaseModel):
    url: str


def get_telegram_delivery_mode() -> Literal["disabled", "webhook", "polling_fallback"]:
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_BOT_USERNAME:
        return "disabled"
    if telegram_webhook_is_active():
        return "webhook"
    return "polling_fallback"


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        company_name=current_user.company_name,
        is_email_verified=current_user.is_email_verified,
        is_admin=current_user.is_admin,
        telegram_chat_id=current_user.telegram_chat_id,
        telegram_bot_username=settings.TELEGRAM_BOT_USERNAME or None,
        telegram_delivery_mode=get_telegram_delivery_mode(),
    )


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return UserResponse(
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        company_name=current_user.company_name,
        is_email_verified=current_user.is_email_verified,
        is_admin=current_user.is_admin,
        telegram_chat_id=current_user.telegram_chat_id,
        telegram_bot_username=settings.TELEGRAM_BOT_USERNAME or None,
        telegram_delivery_mode=get_telegram_delivery_mode(),
    )


@router.post("/telegram/connect", response_model=TelegramConnectResponse)
async def start_telegram_connect(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_BOT_USERNAME:
        raise HTTPException(status_code=503, detail="Telegram automatic connect is not configured")

    connection = await create_connection_session(db, current_user)
    return TelegramConnectResponse(**serialize_connection(connection, current_user.telegram_chat_id))


@router.get("/telegram/connect/{token}", response_model=TelegramConnectResponse)
async def get_telegram_connect_status(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not telegram_webhook_is_active():
        await sync_telegram_connections(db)

    result = await db.execute(
        select(TelegramConnection).where(
            TelegramConnection.token == token,
            TelegramConnection.user_id == current_user.id,
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Telegram connection request not found")

    await db.refresh(current_user)
    return TelegramConnectResponse(**serialize_connection(connection, current_user.telegram_chat_id))


@router.post("/telegram/test", response_model=ActionResponse)
async def send_test_telegram_message(
    current_user: User = Depends(get_current_user),
):
    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram delivery is not configured")
    if not current_user.telegram_chat_id:
        raise HTTPException(status_code=400, detail="Connect Telegram before sending a test message")

    sent = await send_telegram(
        current_user.telegram_chat_id,
        "Test message from SiteWatch. Telegram delivery is connected and ready for production alerts.",
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Telegram test message failed to send")

    return ActionResponse(message="Telegram test message sent successfully.")


@router.get("/billing", response_model=BillingSummaryResponse)
async def get_billing_state(current_user: User = Depends(get_current_user)):
    return BillingSummaryResponse(**get_billing_summary(current_user))


@router.post("/billing/checkout", response_model=BillingSessionResponse)
async def start_billing_checkout(
    data: BillingCheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        url = await create_checkout_session(db, current_user, data.plan_id)
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except BillingStateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return BillingSessionResponse(url=url)


@router.post("/billing/portal", response_model=BillingSessionResponse)
async def open_billing_portal(
    current_user: User = Depends(get_current_user),
):
    try:
        url = await create_billing_portal_session(current_user)
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except BillingStateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return BillingSessionResponse(url=url)
