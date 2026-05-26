from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
import stripe
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.billing import BillingConfigurationError, handle_webhook_event

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.post("/webhook", status_code=status.HTTP_204_NO_CONTENT)
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not settings.STRIPE_SECRET_KEY or not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Stripe billing is not configured")

    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=signature, secret=settings.STRIPE_WEBHOOK_SECRET)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe payload") from exc
    except stripe.error.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature") from exc
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    await handle_webhook_event(db, event)
    return Response(status_code=status.HTTP_204_NO_CONTENT)