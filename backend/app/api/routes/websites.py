from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from typing import List

from app.database import get_db
from app.models.website import Website
from app.models.check import Check
from app.models.user import User
from app.schemas.website import KeywordSuggestionRequest, KeywordSuggestionResponse, WebsiteCreate, WebsiteResponse, WebsiteUpdate, WebsiteWithStatus
from app.schemas.check import CheckResponse
from app.api.deps import get_current_user
from app.services.billing import get_current_monitor_limit, get_current_plan_id
from app.services.traffic import ensure_traffic_config, latest_traffic_sample, serialize_traffic_snapshot
from app.services.performance_budgets import DEFAULT_PERFORMANCE_BUDGETS

router = APIRouter(prefix="/api/websites", tags=["websites"])
_UNSET = object()


def _validate_basic_auth(username: str | None, password: str | None) -> None:
    if bool(username) != bool(password):
        raise HTTPException(status_code=422, detail="Basic auth requires both username and password")


def _apply_basic_auth_update(website: Website, payload: dict) -> None:
    username = payload.pop("basic_auth_username", _UNSET)
    password = payload.pop("basic_auth_password", _UNSET)

    if username is _UNSET and password is _UNSET:
        return

    next_username = website.basic_auth_username if username is _UNSET else username
    next_password = website.basic_auth_password if password is _UNSET else password

    if next_username is None and next_password is None:
        website.basic_auth_username = None
        website.basic_auth_password = None
        return

    if next_username is None or next_password is None:
        raise HTTPException(status_code=422, detail="Basic auth requires both username and password")

    if (
        username is not _UNSET
        and username != website.basic_auth_username
        and password is _UNSET
        and website.basic_auth_password is not None
    ):
        raise HTTPException(status_code=422, detail="Enter the password again when changing the basic auth username")

    website.basic_auth_username = next_username
    website.basic_auth_password = next_password


@router.get("/", response_model=List[WebsiteWithStatus])
async def list_websites(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.website_render_state import WebsiteRenderState

    result = await db.execute(
        select(Website).where(Website.user_id == current_user.id).order_by(Website.created_at.desc())
    )
    websites = result.scalars().all()

    response = []
    for website in websites:
        traffic_config = await ensure_traffic_config(db, website.id)
        render_state_result = await db.execute(
            select(WebsiteRenderState).where(WebsiteRenderState.website_id == website.id)
        )
        render_state = render_state_result.scalar_one_or_none()
        latest_result = await db.execute(
            select(Check)
            .where(Check.website_id == website.id)
            .order_by(Check.checked_at.desc())
            .limit(1)
        )
        latest = latest_result.scalar_one_or_none()
        traffic_sample = await latest_traffic_sample(db, website.id)

        ws = WebsiteWithStatus.model_validate(website)
        if ws.performance_budgets is None:
            ws.performance_budgets = DEFAULT_PERFORMANCE_BUDGETS.copy()
        if latest:
            ws.last_status_code = latest.status_code
            ws.last_response_time = latest.response_time
            ws.last_ssl_days_left = latest.ssl_days_left
            ws.last_keyword_ok = latest.keyword_ok
            ws.last_checked_at = latest.checked_at
        if render_state:
            ws.screenshot_current_preview = render_state.screenshot_current_preview
            ws.screenshot_previous_preview = render_state.screenshot_previous_preview
            ws.screenshot_changed_at = render_state.screenshot_changed_at
        for field, value in serialize_traffic_snapshot(traffic_config, traffic_sample).items():
            setattr(ws, field, value)
        response.append(ws)

    await db.commit()

    return response


@router.post("/suggest-keywords", response_model=KeywordSuggestionResponse)
async def suggest_keywords_for_website(
    data: KeywordSuggestionRequest,
    current_user: User = Depends(get_current_user),
):
    del current_user

    from app.services.monitor import suggest_keywords

    suggestions = await suggest_keywords(
        str(data.url),
        basic_auth_username=data.basic_auth_username,
        basic_auth_password=data.basic_auth_password,
    )
    return KeywordSuggestionResponse(suggestions=suggestions, source='rendered_browser')


@router.post("/", response_model=WebsiteResponse, status_code=201)
async def create_website(
    data: WebsiteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _validate_basic_auth(data.basic_auth_username, data.basic_auth_password)

    monitor_limit = get_current_monitor_limit(current_user)
    if monitor_limit is not None:
        existing_monitors = (
            await db.execute(
                select(func.count()).select_from(Website).where(Website.user_id == current_user.id)
            )
        ).scalar_one()
        if existing_monitors >= monitor_limit:
            current_plan_id = get_current_plan_id(current_user)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"The {current_plan_id.capitalize()} plan includes up to {monitor_limit} "
                    f"monitor{'s' if monitor_limit != 1 else ''}. Upgrade to Pro or Agency to add more."
                ),
            )

    website = Website(
        user_id=current_user.id,
        name=data.name,
        url=str(data.url),
        check_interval=data.check_interval,
        keyword=data.keyword,
        basic_auth_username=data.basic_auth_username,
        basic_auth_password=data.basic_auth_password,
        check_noscript=data.check_noscript,
        performance_budgets=data.performance_budgets,
        tags=data.tags,
    )
    db.add(website)
    await db.commit()
    await db.refresh(website)

    traffic_config = await ensure_traffic_config(db, website.id)
    await db.commit()

    # Kick off an immediate first check
    from app.workers.tasks import run_check
    if not website.is_paused:
        run_check.delay(website.id)

    response = WebsiteResponse.model_validate(website)
    if response.performance_budgets is None:
        response.performance_budgets = DEFAULT_PERFORMANCE_BUDGETS.copy()
    traffic_sample = await latest_traffic_sample(db, website.id)
    for field, value in serialize_traffic_snapshot(traffic_config, traffic_sample).items():
        setattr(response, field, value)
    return response


@router.patch("/{website_id}", response_model=WebsiteResponse)
async def update_website(
    website_id: int,
    data: WebsiteUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == current_user.id)
    )
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    payload = data.model_dump(exclude_unset=True)
    changed_fields = set(payload.keys())
    _apply_basic_auth_update(website, payload)

    for field, value in payload.items():
        setattr(website, field, str(value) if field == "url" and value is not None else value)

    await db.commit()
    await db.refresh(website)

    traffic_config = await ensure_traffic_config(db, website.id)
    traffic_sample = await latest_traffic_sample(db, website.id)

    if changed_fields.intersection({"url", "keyword", "check_interval", "basic_auth_username", "basic_auth_password", "check_noscript", "performance_budgets"}):
        from app.workers.tasks import run_check
        if not website.is_paused:
            run_check.delay(website.id)
    elif "is_paused" in changed_fields and website.is_paused is False:
        from app.workers.tasks import run_check
        run_check.delay(website.id)

    response = WebsiteResponse.model_validate(website)
    if response.performance_budgets is None:
        response.performance_budgets = DEFAULT_PERFORMANCE_BUDGETS.copy()
    for field, value in serialize_traffic_snapshot(traffic_config, traffic_sample).items():
        setattr(response, field, value)
    return response


@router.get("/{website_id}/checks", response_model=List[CheckResponse])
async def get_checks(
    website_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Website not found")

    checks_result = await db.execute(
        select(Check)
        .where(Check.website_id == website_id)
        .order_by(Check.checked_at.desc())
        .limit(50)
    )
    return checks_result.scalars().all()


@router.post("/{website_id}/check", status_code=202)
async def trigger_check(
    website_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Website not found")

    from app.workers.tasks import run_check
    run_check.delay(website_id, True)
    return {"message": "Check queued"}


@router.delete("/{website_id}", status_code=204)
async def delete_website(
    website_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == current_user.id)
    )
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    await db.delete(website)
    await db.commit()
