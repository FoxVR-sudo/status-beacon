import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.workers.celery_app import celery_app
from app.database import AsyncSessionLocal
from app.services.tls_baseline import annotate_tls_report


def _utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Dispatcher — runs every minute via Celery Beat
# ---------------------------------------------------------------------------

@celery_app.task(name="app.workers.tasks.dispatch_checks")
def dispatch_checks():
    asyncio.run(_dispatch_checks())


async def _dispatch_checks():
    from app.models.website import Website
    from app.models.check import Check

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Website))
        websites = result.scalars().all()

        for website in websites:
            if website.is_paused:
                continue

            latest_result = await db.execute(
                select(Check)
                .where(Check.website_id == website.id)
                .order_by(Check.checked_at.desc())
                .limit(1)
            )
            last_check = latest_result.scalar_one_or_none()

            if last_check is None or (
                datetime.now(timezone.utc) - _utc(last_check.checked_at)
                >= timedelta(minutes=website.check_interval)
            ):
                run_check.delay(website.id)


# ---------------------------------------------------------------------------
# Individual website check
# ---------------------------------------------------------------------------

@celery_app.task(name="app.workers.tasks.run_check")
def run_check(website_id: int, force: bool = False):
    asyncio.run(_run_check(website_id, force))


async def _run_check(website_id: int, force: bool = False):
    from app.models.website import Website
    from app.models.check import Check
    from app.models.user import User
    from app.models.website_render_state import WebsiteRenderState
    from app.services.monitor import check_website
    from app.services.notifications import send_email, send_telegram

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Website).where(Website.id == website_id))
        website = result.scalar_one_or_none()
        if not website or (website.is_paused and not force):
            return

        render_state_result = await db.execute(
            select(WebsiteRenderState).where(WebsiteRenderState.website_id == website.id)
        )
        render_state = render_state_result.scalar_one_or_none()

        previous_result = await db.execute(
            select(Check)
            .where(Check.website_id == website.id)
            .order_by(Check.checked_at.desc())
            .limit(1)
        )
        previous_check = previous_result.scalar_one_or_none()

        data = await check_website(
            website.url,
            website.keyword,
            basic_auth_username=website.basic_auth_username,
            basic_auth_password=website.basic_auth_password,
            check_noscript=website.check_noscript,
            performance_budgets=website.performance_budgets,
        )
        data["screenshot_report"] = _build_screenshot_report(data, render_state)
        data["tls_report"] = annotate_tls_report(
            data.get("tls_report"),
            website.tls_baseline,
            website.tls_baseline_approved_at,
        )

        check = Check(
            website_id=website.id,
            status_code=data["status_code"],
            response_time=data["response_time"],
            ttfb=data["ttfb"],
            ssl_days_left=data["ssl_days_left"],
            keyword_ok=data["keyword_ok"],
            seo_report=data["seo_report"],
            header_report=data["header_report"],
            tls_report=data["tls_report"],
            noscript_report=data["noscript_report"],
            screenshot_report=data["screenshot_report"],
            performance_report=data["performance_report"],
            network_report=data["network_report"],
        )
        db.add(check)
        await db.flush()

        # Fetch owner for notifications
        user_result = await db.execute(select(User).where(User.id == website.user_id))
        user = user_result.scalar_one_or_none()

        _update_render_state(db, website.id, render_state, data)

        # Build alerts
        alerts = _build_alerts(website, data, previous_check, render_state)

        from app.models.alert import Alert as AlertModel
        for alert in alerts:
            db.add(AlertModel(
                website_id=website.id,
                type=alert["type"],
                message=alert["message"],
            ))

        await db.commit()

        # Notify after commit so IDs exist
        if user and alerts:
            for alert in alerts:
                msg = f"🚨 {alert['message']}"
                await send_email(user.email, f"Alert: {alert['type']}", alert["message"])
                if user.telegram_chat_id:
                    await send_telegram(user.telegram_chat_id, msg)


def _status_state(status_code: int | None) -> str | None:
    if status_code is None:
        return None
    if status_code == 0:
        return "timeout"
    if status_code == -1:
        return "error"
    if status_code >= 400:
        return "http_error"
    return "healthy"


def _status_message(website, status_code: int | None) -> dict | None:
    state = _status_state(status_code)
    if state == "timeout":
        return {
            "type": "timeout",
            "message": (
                f"{website.name} did not respond before the monitor timeout window. "
                "The origin may be stalled, overloaded, or blocking requests before a full response is returned."
            ),
        }
    if state == "error":
        return {
            "type": "error",
            "message": (
                f"{website.name} could not be reached at {website.url}. "
                "This usually points to DNS, TLS, firewall, or origin connectivity trouble."
            ),
        }
    if state == "http_error":
        return {
            "type": "http_error",
            "message": (
                f"{website.name} responded with HTTP {status_code}. "
                "The endpoint is reachable, but it returned an error response instead of a healthy page."
            ),
        }
    return None


def _ssl_threshold(previous_days: int | None, current_days: int | None) -> int | None:
    if current_days is None or current_days < 0:
        return None

    thresholds = (7, 14, 30)
    for threshold in thresholds:
        if current_days <= threshold and (previous_days is None or previous_days > threshold):
            return threshold
    return None


def _issue_present(report: dict | None, issue: str) -> bool:
    if not report:
        return False

    issues = report.get("issues")
    return isinstance(issues, list) and issue in issues


def _build_alerts(website, data: dict, previous_check, render_state) -> list[dict]:
    alerts = []
    current_status = data["status_code"]
    previous_status = previous_check.status_code if previous_check else None

    current_status_alert = _status_message(website, current_status)
    previous_status_state = _status_state(previous_status)
    current_status_state = _status_state(current_status)

    if current_status_alert and (
        previous_status_state != current_status_state or previous_status != current_status
    ):
        alerts.append(current_status_alert)

    ssl_days = data["ssl_days_left"]
    previous_ssl_days = previous_check.ssl_days_left if previous_check else None
    threshold = _ssl_threshold(previous_ssl_days, ssl_days)
    if threshold is not None:
        alerts.append({
            "type": "ssl_expiry",
            "message": (
                f"SSL certificate for {website.name} expires in {ssl_days} day(s) and has crossed the {threshold}-day warning threshold. "
                "Renew it before browsers start showing certificate warnings."
            ),
        })

    current_tls_report = data.get("tls_report")
    if isinstance(current_tls_report, dict) and current_tls_report.get("changed_public_key"):
        alerts.append({
            "type": "tls_public_key_change",
            "message": (
                f"TLS public key changed on {website.name}. The observed certificate no longer matches the previous trusted check. "
                "If you rotated certificates, changed CDN or replaced edge TLS, review and accept the new baseline. Otherwise investigate possible interception or an unexpected certificate replacement."
            ),
        })

    current_header_report = data.get("header_report")
    previous_header_report = previous_check.header_report if previous_check else None
    hsts_issue = "Missing strict-transport-security header"
    if _issue_present(current_header_report, hsts_issue) and not _issue_present(previous_header_report, hsts_issue):
        alerts.append({
            "type": "hsts_missing",
            "message": (
                f"{website.name} is serving HTTPS without a Strict-Transport-Security header. "
                "Without HSTS, first-visit downgrade and some interception scenarios are easier for an attacker on the network path."
            ),
        })

    previous_keyword_ok = previous_check.keyword_ok if previous_check else None
    if data["keyword_ok"] is False and previous_keyword_ok is not False:
        missing_keywords = data.get("missing_keywords") or [website.keyword]
        missing_keywords_text = ", ".join(f"'{item}'" for item in missing_keywords)
        alerts.append({
            "type": "keyword_missing",
            "message": (
                f"{website.name} loaded, but the required rendered text {missing_keywords_text} was not found on the page. "
                "This usually means the content changed or the monitor phrase needs updating."
            ),
        })

    current_noscript_report = data.get("noscript_report")
    previous_noscript_report = previous_check.noscript_report if previous_check else None
    current_noscript_ok = _noscript_keyword_ok(current_noscript_report)
    previous_noscript_ok = _noscript_keyword_ok(previous_noscript_report)
    if current_noscript_ok is False and previous_noscript_ok is not False:
        missing_keywords = current_noscript_report.get("missing_keywords") or [website.keyword]
        missing_keywords_text = ", ".join(f"'{item}'" for item in missing_keywords)
        alerts.append({
            "type": "noscript_missing",
            "message": (
                f"{website.name} only shows the required text after JavaScript runs. With JavaScript disabled, {missing_keywords_text} is missing, "
                "so bots and fallback clients may see incomplete content."
            ),
        })

    if _rendered_content_changed(current_status, render_state, data):
        summary = (data.get("rendered_content_summary") or "Rendered content differs from the previous successful snapshot").rstrip(".! ")
        alerts.append({
            "type": "rendered_change",
            "message": (
                f"Rendered content changed on {website.name}: {summary}. "
                "Review whether this UI or content change was expected before accepting a new baseline."
            ),
        })

    return alerts


def _noscript_keyword_ok(report: dict | None) -> bool | None:
    if not report or not report.get("applicable"):
        return None

    return report.get("keyword_ok")


def _build_screenshot_report(data: dict, render_state) -> dict | None:
    report = data.get("screenshot_report")
    if not report:
        return None

    if not report.get("applicable"):
        return report

    current_hash = data.get("screenshot_hash")
    previous_hash = render_state.screenshot_hash if render_state else None
    report["baseline_available"] = bool(previous_hash)
    report["changed"] = bool(current_hash and previous_hash and current_hash != previous_hash)
    return report


def _rendered_content_changed(current_status: int | None, render_state, data: dict) -> bool:
    if current_status is None or current_status < 200 or current_status >= 400:
        return False

    next_hash = data.get("rendered_content_hash")
    previous_hash = render_state.last_hash if render_state else None
    return bool(next_hash and previous_hash and previous_hash != next_hash)


def _update_render_state(db, website_id: int, render_state, data: dict) -> None:
    current_status = data.get("status_code")
    next_hash = data.get("rendered_content_hash")
    next_summary = data.get("rendered_content_summary")

    next_screenshot_hash = data.get("screenshot_hash")
    next_screenshot_preview = data.get("screenshot_preview")
    is_success = current_status is not None and 200 <= current_status < 400

    if not is_success or (not next_hash and not next_screenshot_hash):
        return

    if render_state is None:
        from app.models.website_render_state import WebsiteRenderState

        render_state = WebsiteRenderState(website_id=website_id)
        db.add(render_state)

    if next_hash:
        if render_state.last_hash and render_state.last_hash != next_hash:
            render_state.last_changed_at = datetime.now(timezone.utc)
            render_state.last_change_summary = next_summary

        render_state.last_hash = next_hash
        render_state.last_summary = next_summary

    if next_screenshot_hash and next_screenshot_preview:
        if render_state.screenshot_hash and render_state.screenshot_hash != next_screenshot_hash:
            render_state.screenshot_previous_preview = render_state.screenshot_current_preview
            render_state.screenshot_changed_at = datetime.now(timezone.utc)

        render_state.screenshot_hash = next_screenshot_hash
        render_state.screenshot_current_preview = next_screenshot_preview
