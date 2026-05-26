from pydantic import BaseModel
from datetime import datetime
from typing import Any, Optional


class CheckResponse(BaseModel):
    id: int
    website_id: int
    status_code: Optional[int] = None
    response_time: Optional[float] = None
    ttfb: Optional[float] = None
    ssl_days_left: Optional[int] = None
    keyword_ok: Optional[bool] = None
    seo_report: Optional[dict[str, Any]] = None
    header_report: Optional[dict[str, Any]] = None
    tls_report: Optional[dict[str, Any]] = None
    noscript_report: Optional[dict[str, Any]] = None
    screenshot_report: Optional[dict[str, Any]] = None
    performance_report: Optional[dict[str, Any]] = None
    network_report: Optional[dict[str, Any]] = None
    checked_at: datetime

    model_config = {"from_attributes": True}


class AlertResponse(BaseModel):
    id: int
    website_id: int
    type: str
    message: str
    sent_at: datetime

    model_config = {"from_attributes": True}
