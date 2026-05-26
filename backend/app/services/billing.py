from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User

PAID_PLAN_IDS = ("pro", "agency")
ACTIVE_SUBSCRIPTION_STATUSES = {"trialing", "active", "past_due", "unpaid"}
PLAN_MONITOR_LIMITS = {"free": 1}


class BillingConfigurationError(RuntimeError):
    pass


class BillingStateError(RuntimeError):
    pass


def _configure_stripe() -> None:
    if not settings.STRIPE_SECRET_KEY:
        raise BillingConfigurationError("Stripe billing is not configured for this environment.")
    stripe.api_key = settings.STRIPE_SECRET_KEY


def _paid_plan_price_ids() -> dict[str, str]:
    return {
        plan_id: price_id
        for plan_id, price_id in {
            "pro": settings.STRIPE_PRICE_PRO_MONTHLY,
            "agency": settings.STRIPE_PRICE_AGENCY_MONTHLY,
        }.items()
        if price_id
    }


def get_configured_plan_ids() -> list[str]:
    return ["free", *_paid_plan_price_ids().keys()]


def get_price_id_for_plan_id(plan_id: str | None) -> str | None:
    if not plan_id or plan_id == "free":
        return None
    return _paid_plan_price_ids().get(plan_id)


def checkout_enabled() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and _paid_plan_price_ids())


def subscription_status_is_active(status: str | None) -> bool:
    return status in ACTIVE_SUBSCRIPTION_STATUSES


def get_plan_id_for_price_id(price_id: str | None) -> str:
    if not price_id:
        return "free"

    for plan_id, configured_price_id in _paid_plan_price_ids().items():
        if price_id == configured_price_id:
            return plan_id
    return "free"


def get_current_plan_id(user: User) -> str:
    if not subscription_status_is_active(user.stripe_subscription_status):
        return "free"
    return get_plan_id_for_price_id(user.stripe_price_id)


def get_plan_monitor_limit(plan_id: str) -> int | None:
    return PLAN_MONITOR_LIMITS.get(plan_id)


def get_current_monitor_limit(user: User) -> int | None:
    return get_plan_monitor_limit(get_current_plan_id(user))


def get_billing_summary(user: User) -> dict[str, Any]:
    has_active_subscription = subscription_status_is_active(user.stripe_subscription_status) and bool(user.stripe_subscription_id)

    return {
        "current_plan_id": get_current_plan_id(user),
        "subscription_status": user.stripe_subscription_status,
        "current_period_end": user.stripe_current_period_end,
        "checkout_enabled": checkout_enabled(),
        "can_start_checkout": checkout_enabled() and not has_active_subscription,
        "portal_available": bool(settings.STRIPE_SECRET_KEY and user.stripe_customer_id),
        "configured_plan_ids": get_configured_plan_ids(),
    }


async def ensure_stripe_customer(db: AsyncSession, user: User) -> str:
    _configure_stripe()

    if user.stripe_customer_id:
        return user.stripe_customer_id

    display_name = " ".join(part.strip() for part in [user.first_name, user.last_name] if part and part.strip())
    customer = await asyncio.to_thread(
        stripe.Customer.create,
        email=user.email,
        name=display_name or None,
        metadata={"user_id": str(user.id)},
    )

    customer_id = customer.get("id")
    if not customer_id:
        raise BillingStateError("Stripe customer creation did not return an id.")

    user.stripe_customer_id = customer_id
    await db.commit()
    await db.refresh(user)
    return customer_id


async def create_checkout_session(db: AsyncSession, user: User, plan_id: str) -> str:
    if plan_id not in PAID_PLAN_IDS:
        raise BillingStateError("Choose a paid plan before starting Stripe checkout.")

    _configure_stripe()
    price_id = _paid_plan_price_ids().get(plan_id)
    if not price_id:
        raise BillingConfigurationError(f"The {plan_id.capitalize()} plan is not configured in Stripe yet.")

    if get_current_plan_id(user) == plan_id and subscription_status_is_active(user.stripe_subscription_status):
        raise BillingStateError(f"Your account is already on the {plan_id.capitalize()} plan.")

    if not get_billing_summary(user)["can_start_checkout"]:
        raise BillingStateError("Use the billing portal to change or cancel an existing Stripe subscription.")

    customer_id = await ensure_stripe_customer(db, user)
    frontend_base_url = settings.FRONTEND_URL.rstrip("/")
    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        mode="subscription",
        customer=customer_id,
        client_reference_id=str(user.id),
        allow_promotion_codes=True,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{frontend_base_url}/settings?plan={plan_id}&checkout=success#billing",
        cancel_url=f"{frontend_base_url}/settings?plan={plan_id}&checkout=cancel#billing",
        metadata={"user_id": str(user.id), "plan_id": plan_id},
        subscription_data={"metadata": {"user_id": str(user.id), "plan_id": plan_id}},
    )

    session_url = session.get("url")
    if not session_url:
        raise BillingStateError("Stripe checkout did not return a redirect URL.")
    return session_url


async def create_billing_portal_session(user: User) -> str:
    if not user.stripe_customer_id:
        raise BillingStateError("No Stripe customer is linked to this account yet.")

    _configure_stripe()
    frontend_base_url = settings.FRONTEND_URL.rstrip("/")
    session = await asyncio.to_thread(
        stripe.billing_portal.Session.create,
        customer=user.stripe_customer_id,
        return_url=f"{frontend_base_url}/settings?portal=return#billing",
    )

    session_url = session.get("url")
    if not session_url:
        raise BillingStateError("Stripe billing portal did not return a redirect URL.")
    return session_url


def _timestamp_to_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    return datetime.fromtimestamp(int(value), tz=timezone.utc)


def _extract_metadata_user_id(payload: Any) -> str | None:
    metadata = payload.get("metadata") or {}
    return metadata.get("user_id")


def _extract_subscription_price_id(subscription: Any) -> str | None:
    items = subscription.get("items") or {}
    data = items.get("data") or []
    if not data:
        return None

    first_item = data[0] or {}
    price = first_item.get("price") or {}
    return price.get("id")


async def _find_user_for_billing_event(
    db: AsyncSession,
    *,
    customer_id: str | None = None,
    user_id: str | None = None,
) -> User | None:
    if user_id and user_id.isdigit():
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if user:
            return user

    if customer_id:
        result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
        user = result.scalar_one_or_none()
        if user:
            return user

    return None


async def _apply_subscription_state(
    db: AsyncSession,
    user: User,
    subscription: Any,
    *,
    customer_id: str | None = None,
) -> None:
    user.stripe_customer_id = customer_id or user.stripe_customer_id
    user.stripe_subscription_id = subscription.get("id")
    user.stripe_price_id = _extract_subscription_price_id(subscription)
    user.stripe_subscription_status = subscription.get("status")
    user.stripe_current_period_end = _timestamp_to_datetime(subscription.get("current_period_end"))
    await db.commit()


async def _handle_checkout_completed(db: AsyncSession, payload: Any) -> None:
    if payload.get("mode") != "subscription":
        return

    customer_id = payload.get("customer")
    user = await _find_user_for_billing_event(
        db,
        customer_id=customer_id,
        user_id=payload.get("client_reference_id") or _extract_metadata_user_id(payload),
    )
    if not user:
        return

    if customer_id and user.stripe_customer_id != customer_id:
        user.stripe_customer_id = customer_id
        await db.commit()

    subscription_id = payload.get("subscription")
    if not subscription_id:
        return

    _configure_stripe()
    subscription = await asyncio.to_thread(stripe.Subscription.retrieve, subscription_id)
    await _apply_subscription_state(db, user, subscription, customer_id=customer_id)


async def _handle_subscription_event(db: AsyncSession, payload: Any) -> None:
    customer_id = payload.get("customer")
    user = await _find_user_for_billing_event(
        db,
        customer_id=customer_id,
        user_id=_extract_metadata_user_id(payload),
    )
    if not user:
        return

    await _apply_subscription_state(db, user, payload, customer_id=customer_id)


async def handle_webhook_event(db: AsyncSession, event: Any) -> None:
    event_type = event.get("type")
    payload = (event.get("data") or {}).get("object") or {}

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(db, payload)
        return

    if event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        await _handle_subscription_event(db, payload)