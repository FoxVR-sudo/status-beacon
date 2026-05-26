from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.database import get_db
from app.models.alert import Alert
from app.models.website import Website
from app.models.user import User
from app.schemas.check import AlertResponse
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("/", response_model=List[AlertResponse])
async def list_alerts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ids_result = await db.execute(
        select(Website.id).where(Website.user_id == current_user.id)
    )
    website_ids = list(ids_result.scalars().all())

    if not website_ids:
        return []

    alerts_result = await db.execute(
        select(Alert)
        .where(Alert.website_id.in_(website_ids))
        .order_by(Alert.sent_at.desc())
        .limit(50)
    )
    return alerts_result.scalars().all()
