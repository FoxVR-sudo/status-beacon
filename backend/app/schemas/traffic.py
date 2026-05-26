from datetime import datetime

from pydantic import BaseModel, field_validator


class TrafficIngestRequest(BaseModel):
    request_count: int
    error_count: int = 0
    suspicious_count: int = 0
    window_minutes: int = 1
    source: str | None = None

    @field_validator("request_count", "error_count", "suspicious_count")
    @classmethod
    def validate_non_negative(cls, value: int) -> int:
        if value < 0:
            raise ValueError("Value must be non-negative")
        return value

    @field_validator("window_minutes")
    @classmethod
    def validate_window_minutes(cls, value: int) -> int:
        if value <= 0 or value > 60:
            raise ValueError("window_minutes must be between 1 and 60")
        return value

    @field_validator("source")
    @classmethod
    def normalize_source(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class TrafficIngestResponse(BaseModel):
    stored: bool
    requests_per_minute: float
    alerts: list[str]


class WebsiteTrafficSnapshot(BaseModel):
    traffic_ingest_token: str | None = None
    traffic_ingest_url: str | None = None
    last_traffic_requests: int | None = None
    last_traffic_errors: int | None = None
    last_suspicious_requests: int | None = None
    last_traffic_window_minutes: int | None = None
    last_traffic_sampled_at: datetime | None = None