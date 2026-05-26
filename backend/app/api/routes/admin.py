from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.alert import Alert
from app.models.check import Check
from app.models.user import ACCOUNT_STATUSES, User
from app.models.website import Website
from app.services.billing import (
    ACTIVE_SUBSCRIPTION_STATUSES,
    get_configured_plan_ids,
    get_current_plan_id,
    get_price_id_for_plan_id,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminOverviewResponse(BaseModel):
    users: int
    admins: int
    active_subscriptions: int
    websites: int
    checks: int
    alerts: int


class AdminUserItem(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    company_name: str | None = None
    account_status: str
    is_admin: bool
    is_email_verified: bool
    websites_count: int
    current_plan_id: str
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    stripe_price_id: str | None = None
    stripe_subscription_status: str | None = None
    stripe_current_period_end: datetime | None = None
    created_at: datetime | None = None


class AdminUserUpdateRequest(BaseModel):
    email: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None
    company_name: str | None = None
    account_status: str | None = None
    is_admin: bool | None = None
    is_email_verified: bool | None = None
    current_plan_id: str | None = None
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    stripe_price_id: str | None = None
    stripe_subscription_status: str | None = None
    stripe_current_period_end: datetime | None = None


class AdminWebsiteItem(BaseModel):
    id: int
    user_id: int
    name: str
    url: str
    check_interval: int
    is_paused: bool
    created_at: datetime | None = None


class AdminWebsiteUpdateRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1)
    name: str | None = None
    url: str | None = None
    check_interval: int | None = Field(default=None, ge=1, le=1440)
    is_paused: bool | None = None


class AdminSubscriptionItem(BaseModel):
    user_id: int
    email: str
    account_status: str
    current_plan_id: str
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    stripe_subscription_status: str | None = None
    stripe_current_period_end: datetime | None = None
    created_at: datetime | None = None


class AdminSubscriptionUpsertRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1)
    current_plan_id: str | None = None
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    stripe_subscription_status: str | None = None
    stripe_current_period_end: datetime | None = None


class AdminCheckItem(BaseModel):
    id: int
    website_id: int
    website_name: str | None = None
    user_id: int | None = None
    status_code: int | None = None
    response_time: float | None = None
    ttfb: float | None = None
    ssl_days_left: int | None = None
    keyword_ok: bool | None = None
    checked_at: datetime | None = None


class AdminCheckUpsertRequest(BaseModel):
    website_id: int | None = Field(default=None, ge=1)
    status_code: int | None = None
    response_time: float | None = Field(default=None, ge=0)
    ttfb: float | None = Field(default=None, ge=0)
    ssl_days_left: int | None = None
    keyword_ok: bool | None = None
    checked_at: datetime | None = None


class AdminAlertItem(BaseModel):
    id: int
    website_id: int
    website_name: str | None = None
    user_id: int | None = None
    type: str
    message: str
    sent_at: datetime | None = None


class AdminAlertUpsertRequest(BaseModel):
    website_id: int | None = Field(default=None, ge=1)
    type: str | None = None
    message: str | None = None
    sent_at: datetime | None = None


class ActionResponse(BaseModel):
    message: str


def ensure_admin(current_user: User) -> None:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")


def _serialize_admin_user(user: User, websites_count: int) -> AdminUserItem:
    return AdminUserItem(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        company_name=user.company_name,
        account_status=user.account_status,
        is_admin=user.is_admin,
        is_email_verified=user.is_email_verified,
        websites_count=websites_count,
        current_plan_id=get_current_plan_id(user),
        stripe_customer_id=user.stripe_customer_id,
        stripe_subscription_id=user.stripe_subscription_id,
        stripe_price_id=user.stripe_price_id,
        stripe_subscription_status=user.stripe_subscription_status,
        stripe_current_period_end=user.stripe_current_period_end,
        created_at=user.created_at,
    )


def _serialize_admin_subscription(user: User) -> AdminSubscriptionItem:
    return AdminSubscriptionItem(
        user_id=user.id,
        email=user.email,
        account_status=user.account_status,
        current_plan_id=get_current_plan_id(user),
        stripe_customer_id=user.stripe_customer_id,
        stripe_subscription_id=user.stripe_subscription_id,
        stripe_subscription_status=user.stripe_subscription_status,
        stripe_current_period_end=user.stripe_current_period_end,
        created_at=user.created_at,
    )


async def _website_counts_by_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, int]:
    if not user_ids:
        return {}

    website_counts_result = await db.execute(
        select(Website.user_id, func.count(Website.id))
        .where(Website.user_id.in_(user_ids))
        .group_by(Website.user_id)
    )
    return {
        user_id: website_count for user_id, website_count in website_counts_result.all()
    }


async def _websites_by_ids(db: AsyncSession, website_ids: list[int]) -> dict[int, Website]:
    if not website_ids:
        return {}

    result = await db.execute(select(Website).where(Website.id.in_(website_ids)))
    websites = result.scalars().all()
    return {website.id: website for website in websites}


async def _apply_admin_user_update(
    db: AsyncSession,
    *,
    user: User,
    payload: dict,
    current_user: User,
) -> None:
    if "email" in payload:
        email_value = str(payload["email"]).strip().lower()
        if not email_value:
            raise HTTPException(status_code=400, detail="Email is required")
        existing_email = await db.execute(
            select(User.id).where(User.email == email_value, User.id != user.id)
        )
        if existing_email.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="Another user already uses that email")
        user.email = email_value

    if "stripe_customer_id" in payload and payload["stripe_customer_id"]:
        existing_customer = await db.execute(
            select(User.id).where(User.stripe_customer_id == payload["stripe_customer_id"], User.id != user.id)
        )
        if existing_customer.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="That Stripe customer id is already assigned")

    if "stripe_subscription_id" in payload and payload["stripe_subscription_id"]:
        existing_subscription = await db.execute(
            select(User.id).where(User.stripe_subscription_id == payload["stripe_subscription_id"], User.id != user.id)
        )
        if existing_subscription.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="That Stripe subscription id is already assigned")

    if user.id == current_user.id and payload.get("is_admin") is False:
        raise HTTPException(status_code=400, detail="You cannot remove your own admin access")

    if "account_status" in payload:
        status_value = str(payload["account_status"] or "").strip().lower()
        if status_value not in ACCOUNT_STATUSES:
            raise HTTPException(status_code=400, detail="Unsupported account status")
        if user.id == current_user.id and status_value != "active":
            raise HTTPException(status_code=400, detail="You cannot suspend or disable your own admin account")
        user.account_status = status_value

    if "current_plan_id" in payload:
        plan_id = str(payload["current_plan_id"] or "").strip().lower()
        if plan_id not in get_configured_plan_ids():
            raise HTTPException(status_code=400, detail="Unsupported subscription plan")

        configured_price_id = get_price_id_for_plan_id(plan_id)
        if plan_id != "free" and not configured_price_id:
            raise HTTPException(status_code=400, detail="That subscription plan is not configured in Stripe")

        user.stripe_price_id = configured_price_id
        if plan_id == "free":
            if "stripe_subscription_id" not in payload:
                user.stripe_subscription_id = None
            if "stripe_subscription_status" not in payload:
                user.stripe_subscription_status = None
            if "stripe_current_period_end" not in payload:
                user.stripe_current_period_end = None

    if "first_name" in payload:
        user.first_name = (payload["first_name"] or "").strip()
    if "last_name" in payload:
        user.last_name = (payload["last_name"] or "").strip()
    if "company_name" in payload:
        company_name = (payload["company_name"] or "").strip()
        user.company_name = company_name or None
    if "is_admin" in payload:
        user.is_admin = bool(payload["is_admin"])
    if "is_email_verified" in payload:
        user.is_email_verified = bool(payload["is_email_verified"])
        user.email_verified_at = datetime.now(timezone.utc) if user.is_email_verified else None
    if "stripe_customer_id" in payload:
        user.stripe_customer_id = payload["stripe_customer_id"] or None
    if "stripe_subscription_id" in payload:
        user.stripe_subscription_id = payload["stripe_subscription_id"] or None
    if "stripe_price_id" in payload:
        user.stripe_price_id = payload["stripe_price_id"] or None
    if "stripe_subscription_status" in payload:
        user.stripe_subscription_status = payload["stripe_subscription_status"] or None
    if "stripe_current_period_end" in payload:
        user.stripe_current_period_end = payload["stripe_current_period_end"]


def _serialize_admin_check(check: Check, website: Website | None) -> AdminCheckItem:
    return AdminCheckItem(
        id=check.id,
        website_id=check.website_id,
        website_name=website.name if website else None,
        user_id=website.user_id if website else None,
        status_code=check.status_code,
        response_time=check.response_time,
        ttfb=check.ttfb,
        ssl_days_left=check.ssl_days_left,
        keyword_ok=check.keyword_ok,
        checked_at=check.checked_at,
    )


def _serialize_admin_alert(alert: Alert, website: Website | None) -> AdminAlertItem:
    return AdminAlertItem(
        id=alert.id,
        website_id=alert.website_id,
        website_name=website.name if website else None,
        user_id=website.user_id if website else None,
        type=alert.type,
        message=alert.message,
        sent_at=alert.sent_at,
    )


@router.get("/overview", response_model=AdminOverviewResponse)
async def admin_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)

    users_count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    admins_count = (await db.execute(select(func.count()).select_from(User).where(User.is_admin.is_(True)))).scalar_one()
    active_subscriptions_count = (
        await db.execute(
            select(func.count()).select_from(User).where(
                User.stripe_subscription_id.is_not(None),
                User.stripe_subscription_status.in_(tuple(ACTIVE_SUBSCRIPTION_STATUSES)),
            )
        )
    ).scalar_one()
    websites_count = (await db.execute(select(func.count()).select_from(Website))).scalar_one()
    checks_count = (await db.execute(select(func.count()).select_from(Check))).scalar_one()
    alerts_count = (await db.execute(select(func.count()).select_from(Alert))).scalar_one()

    return AdminOverviewResponse(
        users=users_count,
        admins=admins_count,
        active_subscriptions=active_subscriptions_count,
        websites=websites_count,
        checks=checks_count,
        alerts=alerts_count,
    )


@router.get("/users", response_model=list[AdminUserItem])
async def admin_list_users(
    limit: int = Query(default=50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(User).order_by(User.created_at.desc()).limit(limit))
    users = result.scalars().all()
    user_ids = [user.id for user in users]
    website_counts_by_user = await _website_counts_by_user_ids(db, user_ids)

    return [
        _serialize_admin_user(user, website_counts_by_user.get(user.id, 0))
        for user in users
    ]


@router.patch("/users/{user_id}", response_model=AdminUserItem)
async def admin_update_user(
    user_id: int,
    data: AdminUserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    payload = data.model_dump(exclude_unset=True)

    await _apply_admin_user_update(db, user=user, payload=payload, current_user=current_user)

    await db.commit()
    await db.refresh(user)

    website_counts_by_user = await _website_counts_by_user_ids(db, [user.id])
    return _serialize_admin_user(user, website_counts_by_user.get(user.id, 0))


@router.get("/websites", response_model=list[AdminWebsiteItem])
async def admin_list_websites(
    limit: int = Query(default=100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Website).order_by(Website.created_at.desc()).limit(limit))
    websites = result.scalars().all()
    return [
        AdminWebsiteItem(
            id=website.id,
            user_id=website.user_id,
            name=website.name,
            url=website.url,
            check_interval=website.check_interval,
            is_paused=website.is_paused,
            created_at=website.created_at,
        )
        for website in websites
    ]


@router.get("/subscriptions", response_model=list[AdminSubscriptionItem])
async def admin_list_subscriptions(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(
        select(User)
        .where(
            User.stripe_customer_id.is_not(None)
            | User.stripe_subscription_id.is_not(None)
            | User.stripe_subscription_status.is_not(None)
            | User.stripe_price_id.is_not(None)
        )
        .order_by(User.created_at.desc())
        .limit(limit)
    )
    users = result.scalars().all()
    return [_serialize_admin_subscription(user) for user in users]


@router.post("/subscriptions", response_model=AdminSubscriptionItem)
async def admin_create_subscription(
    data: AdminSubscriptionUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    if data.user_id is None:
        raise HTTPException(status_code=400, detail="User id is required")

    result = await db.execute(select(User).where(User.id == data.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    payload = data.model_dump(exclude_unset=True)
    payload.pop("user_id", None)
    await _apply_admin_user_update(db, user=user, payload=payload, current_user=current_user)
    await db.commit()
    await db.refresh(user)
    return _serialize_admin_subscription(user)


@router.patch("/subscriptions/{user_id}", response_model=AdminSubscriptionItem)
async def admin_update_subscription(
    user_id: int,
    data: AdminSubscriptionUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    payload = data.model_dump(exclude_unset=True)
    payload.pop("user_id", None)
    await _apply_admin_user_update(db, user=user, payload=payload, current_user=current_user)
    await db.commit()
    await db.refresh(user)
    return _serialize_admin_subscription(user)


@router.delete("/subscriptions/{user_id}", response_model=ActionResponse)
async def admin_delete_subscription(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.stripe_customer_id = None
    user.stripe_subscription_id = None
    user.stripe_price_id = None
    user.stripe_subscription_status = None
    user.stripe_current_period_end = None
    await db.commit()
    return ActionResponse(message="Subscription deleted")


@router.get("/checks", response_model=list[AdminCheckItem])
async def admin_list_checks(
    limit: int = Query(default=100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Check).order_by(Check.checked_at.desc()).limit(limit))
    checks = result.scalars().all()
    websites_by_id = await _websites_by_ids(db, [check.website_id for check in checks])
    return [_serialize_admin_check(check, websites_by_id.get(check.website_id)) for check in checks]


@router.post("/checks", response_model=AdminCheckItem)
async def admin_create_check(
    data: AdminCheckUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    if data.website_id is None:
        raise HTTPException(status_code=400, detail="Website id is required")

    website_result = await db.execute(select(Website).where(Website.id == data.website_id))
    website = website_result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=400, detail="Target website does not exist")

    check = Check(
        website_id=data.website_id,
        status_code=data.status_code,
        response_time=data.response_time,
        ttfb=data.ttfb,
        ssl_days_left=data.ssl_days_left,
        keyword_ok=data.keyword_ok,
        checked_at=data.checked_at,
    )
    db.add(check)
    await db.commit()
    await db.refresh(check)
    return _serialize_admin_check(check, website)


@router.patch("/checks/{check_id}", response_model=AdminCheckItem)
async def admin_update_check(
    check_id: int,
    data: AdminCheckUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Check).where(Check.id == check_id))
    check = result.scalar_one_or_none()
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")

    payload = data.model_dump(exclude_unset=True)
    website: Website | None = None
    if "website_id" in payload:
        website_result = await db.execute(select(Website).where(Website.id == payload["website_id"]))
        website = website_result.scalar_one_or_none()
        if not website:
            raise HTTPException(status_code=400, detail="Target website does not exist")
        check.website_id = payload["website_id"]

    if "status_code" in payload:
        check.status_code = payload["status_code"]
    if "response_time" in payload:
        check.response_time = payload["response_time"]
    if "ttfb" in payload:
        check.ttfb = payload["ttfb"]
    if "ssl_days_left" in payload:
        check.ssl_days_left = payload["ssl_days_left"]
    if "keyword_ok" in payload:
        check.keyword_ok = payload["keyword_ok"]
    if "checked_at" in payload:
        check.checked_at = payload["checked_at"]

    await db.commit()
    await db.refresh(check)
    if website is None:
        websites_by_id = await _websites_by_ids(db, [check.website_id])
        website = websites_by_id.get(check.website_id)
    return _serialize_admin_check(check, website)


@router.delete("/checks/{check_id}", response_model=ActionResponse)
async def admin_delete_check(
    check_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Check).where(Check.id == check_id))
    check = result.scalar_one_or_none()
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")

    await db.delete(check)
    await db.commit()
    return ActionResponse(message="Check deleted")


@router.get("/alerts", response_model=list[AdminAlertItem])
async def admin_list_alerts(
    limit: int = Query(default=100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Alert).order_by(Alert.sent_at.desc()).limit(limit))
    alerts = result.scalars().all()
    websites_by_id = await _websites_by_ids(db, [alert.website_id for alert in alerts])
    return [_serialize_admin_alert(alert, websites_by_id.get(alert.website_id)) for alert in alerts]


@router.post("/alerts", response_model=AdminAlertItem)
async def admin_create_alert(
    data: AdminAlertUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    if data.website_id is None:
        raise HTTPException(status_code=400, detail="Website id is required")

    website_result = await db.execute(select(Website).where(Website.id == data.website_id))
    website = website_result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=400, detail="Target website does not exist")

    alert_type = (data.type or "").strip()
    message = (data.message or "").strip()
    if not alert_type:
        raise HTTPException(status_code=400, detail="Alert type is required")
    if not message:
        raise HTTPException(status_code=400, detail="Alert message is required")

    alert = Alert(
        website_id=data.website_id,
        type=alert_type,
        message=message,
        sent_at=data.sent_at,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return _serialize_admin_alert(alert, website)


@router.patch("/alerts/{alert_id}", response_model=AdminAlertItem)
async def admin_update_alert(
    alert_id: int,
    data: AdminAlertUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    payload = data.model_dump(exclude_unset=True)
    website: Website | None = None
    if "website_id" in payload:
        website_result = await db.execute(select(Website).where(Website.id == payload["website_id"]))
        website = website_result.scalar_one_or_none()
        if not website:
            raise HTTPException(status_code=400, detail="Target website does not exist")
        alert.website_id = payload["website_id"]

    if "type" in payload:
        alert_type = str(payload["type"] or "").strip()
        if not alert_type:
            raise HTTPException(status_code=400, detail="Alert type is required")
        alert.type = alert_type
    if "message" in payload:
        message = str(payload["message"] or "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="Alert message is required")
        alert.message = message
    if "sent_at" in payload:
        alert.sent_at = payload["sent_at"]

    await db.commit()
    await db.refresh(alert)
    if website is None:
        websites_by_id = await _websites_by_ids(db, [alert.website_id])
        website = websites_by_id.get(alert.website_id)
    return _serialize_admin_alert(alert, website)


@router.delete("/alerts/{alert_id}", response_model=ActionResponse)
async def admin_delete_alert(
    alert_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    await db.delete(alert)
    await db.commit()
    return ActionResponse(message="Alert deleted")


@router.patch("/websites/{website_id}", response_model=AdminWebsiteItem)
async def admin_update_website(
    website_id: int,
    data: AdminWebsiteUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)

    result = await db.execute(select(Website).where(Website.id == website_id))
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    payload = data.model_dump(exclude_unset=True)

    if "user_id" in payload:
        target_user = await db.execute(select(User.id).where(User.id == payload["user_id"]))
        if target_user.scalar_one_or_none() is None:
            raise HTTPException(status_code=400, detail="Target user does not exist")
        website.user_id = payload["user_id"]

    if "name" in payload:
        name_value = (payload["name"] or "").strip()
        if not name_value:
            raise HTTPException(status_code=400, detail="Website name is required")
        website.name = name_value

    if "url" in payload:
        url_value = str(payload["url"] or "").strip()
        if not url_value:
            raise HTTPException(status_code=400, detail="Website URL is required")
        website.url = url_value

    if "check_interval" in payload:
        website.check_interval = payload["check_interval"]

    if "is_paused" in payload:
        website.is_paused = bool(payload["is_paused"])

    await db.commit()
    await db.refresh(website)

    return AdminWebsiteItem(
        id=website.id,
        user_id=website.user_id,
        name=website.name,
        url=website.url,
        check_interval=website.check_interval,
        is_paused=website.is_paused,
        created_at=website.created_at,
    )


@router.delete("/users/{user_id}", response_model=ActionResponse)
async def admin_delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.delete(user)
    await db.commit()
    return ActionResponse(message="User deleted")


@router.delete("/websites/{website_id}", response_model=ActionResponse)
async def admin_delete_website(
    website_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_admin(current_user)

    result = await db.execute(select(Website).where(Website.id == website_id))
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    await db.delete(website)
    await db.commit()
    return ActionResponse(message="Website deleted")
