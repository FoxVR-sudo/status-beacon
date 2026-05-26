import secrets
from statistics import mean

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.traffic_sample import TrafficSample
from app.models.website import Website
from app.models.website_traffic_config import WebsiteTrafficConfig

BASELINE_WINDOW = 12


def requests_per_minute(request_count: int, window_minutes: int) -> float:
    return round(request_count / max(window_minutes, 1), 2)


def error_rate(request_count: int, error_count: int) -> float:
    if request_count <= 0:
        return 0.0
    return error_count / request_count


def suspicious_ratio(request_count: int, suspicious_count: int) -> float:
    if request_count <= 0:
        return 0.0
    return suspicious_count / request_count


def build_traffic_ingest_url(token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/api/traffic/ingest/{token}"


async def ensure_traffic_config(db: AsyncSession, website_id: int) -> WebsiteTrafficConfig:
    result = await db.execute(
        select(WebsiteTrafficConfig).where(WebsiteTrafficConfig.website_id == website_id)
    )
    config = result.scalar_one_or_none()
    if config:
        return config

    config = WebsiteTrafficConfig(
        website_id=website_id,
        ingest_token=secrets.token_urlsafe(24),
    )
    db.add(config)
    await db.flush()
    return config


async def latest_traffic_sample(db: AsyncSession, website_id: int) -> TrafficSample | None:
    result = await db.execute(
        select(TrafficSample)
        .where(TrafficSample.website_id == website_id)
        .order_by(TrafficSample.sampled_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def recent_traffic_samples(db: AsyncSession, website_id: int, limit: int = BASELINE_WINDOW) -> list[TrafficSample]:
    result = await db.execute(
        select(TrafficSample)
        .where(TrafficSample.website_id == website_id)
        .order_by(TrafficSample.sampled_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


def detect_traffic_alerts(website: Website, current: TrafficSample, previous_samples: list[TrafficSample]) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []

    current_rpm = requests_per_minute(current.request_count, current.window_minutes)
    previous = previous_samples[0] if previous_samples else None
    previous_rpm = requests_per_minute(previous.request_count, previous.window_minutes) if previous else 0.0
    baseline_values = [requests_per_minute(sample.request_count, sample.window_minutes) for sample in previous_samples]
    baseline_rpm = mean(baseline_values) if baseline_values else 0.0
    spike_threshold = max(settings.TRAFFIC_SPIKE_MIN_REQUESTS_PER_MINUTE, baseline_rpm * settings.TRAFFIC_SPIKE_FACTOR)

    if current_rpm >= spike_threshold and previous_rpm < spike_threshold:
        alerts.append({
            "type": "traffic_spike",
            "message": f"Traffic spike on {website.name}: {current_rpm:.0f} req/min vs baseline {baseline_rpm:.0f} req/min.",
        })

    current_error_rate = error_rate(current.request_count, current.error_count)
    previous_error_rate = error_rate(previous.request_count, previous.error_count) if previous else 0.0
    if current.request_count >= 50 and current_error_rate >= settings.TRAFFIC_ERROR_RATE_THRESHOLD and previous_error_rate < settings.TRAFFIC_ERROR_RATE_THRESHOLD:
        alerts.append({
            "type": "traffic_error_spike",
            "message": f"Traffic error rate spiked on {website.name}: {current.error_count} errors across {current.request_count} requests in the last {current.window_minutes} minute(s).",
        })

    current_suspicious_ratio = suspicious_ratio(current.request_count, current.suspicious_count)
    previous_suspicious_ratio = suspicious_ratio(previous.request_count, previous.suspicious_count) if previous else 0.0
    suspicious_threshold = max(
        settings.TRAFFIC_SUSPICIOUS_MIN_COUNT,
        int(current.request_count * settings.TRAFFIC_SUSPICIOUS_RATIO_THRESHOLD),
    )
    if current.suspicious_count >= suspicious_threshold and previous_suspicious_ratio < settings.TRAFFIC_SUSPICIOUS_RATIO_THRESHOLD:
        alerts.append({
            "type": "suspicious_traffic",
            "message": f"Suspicious traffic on {website.name}: {current.suspicious_count} flagged requests in the last {current.window_minutes} minute(s).",
        })

    return alerts


def serialize_traffic_snapshot(config: WebsiteTrafficConfig | None, sample: TrafficSample | None) -> dict:
    token = config.ingest_token if config else None
    return {
        "traffic_ingest_token": token,
        "traffic_ingest_url": build_traffic_ingest_url(token) if token else None,
        "last_traffic_requests": sample.request_count if sample else None,
        "last_traffic_errors": sample.error_count if sample else None,
        "last_suspicious_requests": sample.suspicious_count if sample else None,
        "last_traffic_window_minutes": sample.window_minutes if sample else None,
        "last_traffic_sampled_at": sample.sampled_at if sample else None,
    }