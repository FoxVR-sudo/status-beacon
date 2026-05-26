from pydantic import AnyHttpUrl, BaseModel, field_validator
from datetime import datetime
from typing import Literal, Optional

from app.schemas.traffic import WebsiteTrafficSnapshot
from app.services.performance_budgets import PERFORMANCE_BUDGET_KEYS, effective_performance_budgets


def _normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_performance_budgets(value: Optional[dict[str, float]]) -> Optional[dict[str, float]]:
    if value is None:
        return None

    unknown_keys = set(value) - set(PERFORMANCE_BUDGET_KEYS)
    if unknown_keys:
        raise ValueError(f"Unknown performance budget keys: {', '.join(sorted(unknown_keys))}")

    for key, raw_value in value.items():
        normalized = float(raw_value)
        if normalized <= 0:
            raise ValueError(f"{key} must be greater than 0")

    return effective_performance_budgets(value)


class WebsiteCreate(BaseModel):
    name: str
    url: AnyHttpUrl
    check_interval: Literal[5, 15, 30] = 30
    keyword: Optional[str] = None
    basic_auth_username: Optional[str] = None
    basic_auth_password: Optional[str] = None
    check_noscript: bool = False
    performance_budgets: Optional[dict[str, float]] = None
    tags: list[str] = []

    @field_validator('name')
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Name is required')
        return value

    @field_validator('keyword', 'basic_auth_username', 'basic_auth_password')
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator('performance_budgets')
    @classmethod
    def normalize_performance_budgets(cls, value: Optional[dict[str, float]]) -> Optional[dict[str, float]]:
        return _normalize_performance_budgets(value)

    @field_validator('tags')
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            tag = " ".join(item.strip().split())
            if not tag:
                continue
            key = tag.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(tag[:32])
        return normalized[:8]


class WebsiteUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[AnyHttpUrl] = None
    check_interval: Optional[Literal[5, 15, 30]] = None
    keyword: Optional[str] = None
    basic_auth_username: Optional[str] = None
    basic_auth_password: Optional[str] = None
    check_noscript: Optional[bool] = None
    performance_budgets: Optional[dict[str, float]] = None
    tags: Optional[list[str]] = None
    is_paused: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError('Name is required')
        return value

    @field_validator('keyword', 'basic_auth_username', 'basic_auth_password')
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)

    @field_validator('performance_budgets')
    @classmethod
    def normalize_performance_budgets(cls, value: Optional[dict[str, float]]) -> Optional[dict[str, float]]:
        return _normalize_performance_budgets(value)

    @field_validator('tags')
    @classmethod
    def normalize_tags(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None

        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            tag = " ".join(item.strip().split())
            if not tag:
                continue
            key = tag.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(tag[:32])
        return normalized[:8]


class KeywordSuggestionRequest(BaseModel):
    url: AnyHttpUrl
    basic_auth_username: Optional[str] = None
    basic_auth_password: Optional[str] = None

    @field_validator('basic_auth_username', 'basic_auth_password')
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_optional_text(value)


class KeywordSuggestionResponse(BaseModel):
    suggestions: list[str]
    source: Literal['rendered_browser']


class WebsiteResponse(WebsiteTrafficSnapshot):
    id: int
    name: str
    url: str
    check_interval: int
    keyword: Optional[str] = None
    basic_auth_username: Optional[str] = None
    has_basic_auth: bool = False
    check_noscript: bool = False
    performance_budgets: Optional[dict[str, float]] = None
    screenshot_current_preview: Optional[str] = None
    screenshot_previous_preview: Optional[str] = None
    screenshot_changed_at: Optional[datetime] = None
    tags: list[str] = []
    is_paused: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class WebsiteWithStatus(WebsiteResponse):
    last_status_code: Optional[int] = None
    last_response_time: Optional[float] = None
    last_ssl_days_left: Optional[int] = None
    last_keyword_ok: Optional[bool] = None
    last_checked_at: Optional[datetime] = None
