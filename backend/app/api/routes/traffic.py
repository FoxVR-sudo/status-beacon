from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.alert import Alert
from app.models.traffic_sample import TrafficSample
from app.models.user import User
from app.models.website import Website
from app.models.website_traffic_config import WebsiteTrafficConfig
from app.schemas.traffic import TrafficIngestRequest, TrafficIngestResponse
from app.services.notifications import send_email, send_telegram
from app.services.traffic import detect_traffic_alerts, recent_traffic_samples, requests_per_minute

router = APIRouter(prefix="/api/traffic", tags=["traffic"])


@router.post("/ingest/{token}", response_model=TrafficIngestResponse)
async def ingest_traffic_sample(
    token: str,
    data: TrafficIngestRequest,
    db: AsyncSession = Depends(get_db),
):
    config_result = await db.execute(
        select(WebsiteTrafficConfig).where(WebsiteTrafficConfig.ingest_token == token)
    )
    config = config_result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Traffic ingest token not found")

    website_result = await db.execute(select(Website).where(Website.id == config.website_id))
    website = website_result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    previous_samples = await recent_traffic_samples(db, website.id)

    sample = TrafficSample(
        website_id=website.id,
        request_count=data.request_count,
        error_count=data.error_count,
        suspicious_count=data.suspicious_count,
        window_minutes=data.window_minutes,
        source=data.source,
    )
    db.add(sample)

    alert_payloads = detect_traffic_alerts(website, sample, previous_samples)
    for alert in alert_payloads:
        db.add(Alert(website_id=website.id, type=alert["type"], message=alert["message"]))

    owner_result = await db.execute(select(User).where(User.id == website.user_id))
    owner = owner_result.scalar_one_or_none()

    await db.commit()

    if owner and alert_payloads:
        for alert in alert_payloads:
            await send_email(owner.email, f"Alert: {alert['type']}", alert["message"])
            if owner.telegram_chat_id:
                await send_telegram(owner.telegram_chat_id, f"🚨 {alert['message']}")

    return TrafficIngestResponse(
        stored=True,
        requests_per_minute=requests_per_minute(data.request_count, data.window_minutes),
        alerts=[alert["type"] for alert in alert_payloads],
    )