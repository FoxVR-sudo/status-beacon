import asyncio
import base64
import hashlib
import re
import ssl
import socket
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from playwright.async_api import TimeoutError as PlaywrightTimeoutError, async_playwright

from app.services.performance_budgets import effective_performance_budgets


BROWSER_TIMEOUT_MS = 15000
SCREENSHOT_VIEWPORT = {'width': 1280, 'height': 800}
SCREENSHOT_QUALITY = 45
SUGGESTION_LIMIT = 8
RENDER_SIGNATURE_LIMIT = 12
RENDER_SUMMARY_LIMIT = 3
IMPORTANT_RESPONSE_HEADERS = (
    'content-type',
    'cache-control',
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'x-robots-tag',
    'server-timing',
)
SUGGESTION_BLOCKLIST = {
    'accept',
    'decline',
    'privacy policy',
    'terms of service',
    'this site uses cookies',
    'we use cookies to improve your experience, analyze traffic, and personalize content.',
}


async def _get_ssl_days_left(hostname: str) -> int:
    """Blocking SSL check wrapped in a thread to avoid blocking the event loop."""
    def _check() -> int:
        ctx = ssl.create_default_context()
        with socket.create_connection((hostname, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
                expire = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
                expire = expire.replace(tzinfo=timezone.utc)
                return (expire - datetime.now(timezone.utc)).days

    return await asyncio.to_thread(_check)


def _isoformat_utc(value: datetime | None) -> str | None:
    if value is None:
        return None

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


async def _get_tls_report(hostname: str) -> dict[str, Any]:
    """Blocking TLS certificate check wrapped in a thread to avoid blocking the event loop."""

    def _check() -> dict[str, Any]:
        ctx = ssl.create_default_context()
        with socket.create_connection((hostname, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert_der = ssock.getpeercert(binary_form=True)
                cert = x509.load_der_x509_certificate(cert_der)

                valid_from = getattr(cert, 'not_valid_before_utc', None)
                if valid_from is None:
                    valid_from = cert.not_valid_before.replace(tzinfo=timezone.utc)

                valid_to = getattr(cert, 'not_valid_after_utc', None)
                if valid_to is None:
                    valid_to = cert.not_valid_after.replace(tzinfo=timezone.utc)

                subject_alt_names: list[str] = []
                try:
                    san_extension = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
                    subject_alt_names = [str(item.value) for item in san_extension.value]
                except x509.ExtensionNotFound:
                    subject_alt_names = []

                spki_der = cert.public_key().public_bytes(
                    encoding=serialization.Encoding.DER,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo,
                )

                return {
                    'applicable': True,
                    'valid': True,
                    'hostname': hostname,
                    'subject': cert.subject.rfc4514_string(),
                    'issuer': cert.issuer.rfc4514_string(),
                    'serial_number': format(cert.serial_number, 'x'),
                    'subject_alt_names': subject_alt_names,
                    'certificate_sha256': hashlib.sha256(cert_der).hexdigest(),
                    'public_key_pin_sha256': base64.b64encode(hashlib.sha256(spki_der).digest()).decode('ascii'),
                    'not_before': _isoformat_utc(valid_from),
                    'not_after': _isoformat_utc(valid_to),
                    'days_left': (valid_to - datetime.now(timezone.utc)).days,
                    'issues': [],
                }

    return await asyncio.to_thread(_check)


def _parse_keywords(raw_keyword: Optional[str]) -> list[str]:
    if not raw_keyword:
        return []

    return [part.strip() for part in re.split(r"[,\n]+", raw_keyword) if part.strip()]


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _normalized_or_none(value: str) -> str | None:
    normalized = _normalize_text(value)
    return normalized or None


def _title_fragments(value: str) -> list[str]:
    value = _normalize_text(value)
    if not value:
        return []

    fragments = re.split(r"\s+(?:\||:|–|—|-)\s+", value)
    return [value, *fragments] if len(fragments) > 1 else [value]


def _sentence_fragments(value: str) -> list[str]:
    value = _normalize_text(value)
    if not value:
        return []

    fragments = [part.strip() for part in re.split(r"[.;]\s+", value) if part.strip()]
    return [value, *fragments] if len(fragments) > 1 else [value]


def _is_suggestion_candidate(value: str) -> bool:
    lowered = value.casefold()
    if not value or len(value) < 4 or len(value) > 90:
        return False
    if lowered in SUGGESTION_BLOCKLIST:
        return False
    return any(character.isalpha() for character in value)


def _dedupe_candidates(candidates: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()

    for candidate in candidates:
        normalized = _normalize_text(candidate)
        key = normalized.casefold()
        if not normalized or key in seen:
            continue
        seen.add(key)
        unique.append(normalized)

    return unique


def _is_render_signature_candidate(value: str) -> bool:
    lowered = value.casefold()
    if not value or len(value) < 8 or len(value) > 180:
        return False
    if lowered in SUGGESTION_BLOCKLIST:
        return False

    alpha_count = sum(character.isalpha() for character in value)
    digit_count = sum(character.isdigit() for character in value)
    return alpha_count >= 4 and digit_count <= alpha_count


def _build_render_signature_parts(snapshot: dict[str, Any]) -> list[str]:
    candidates = [
        snapshot.get('title', ''),
        snapshot.get('metaDescription', ''),
        *snapshot.get('headings', []),
        *snapshot.get('bodyLines', []),
    ]

    parts: list[str] = []
    for candidate in _dedupe_candidates(candidates):
        if not _is_render_signature_candidate(candidate):
            continue
        parts.append(candidate)
        if len(parts) >= RENDER_SIGNATURE_LIMIT:
            break

    return parts


def _hash_render_signature(parts: list[str]) -> str | None:
    if not parts:
        return None

    payload = "\n".join(part.casefold() for part in parts)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def _summarize_render_signature(parts: list[str]) -> str | None:
    if not parts:
        return None

    return " | ".join(parts[:RENDER_SUMMARY_LIMIT])


def _encode_screenshot_preview(image_bytes: bytes) -> str:
    payload = base64.b64encode(image_bytes).decode('ascii')
    return f"data:image/jpeg;base64,{payload}"


def _hash_image_bytes(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()


def _round_metric(value: Any, digits: int = 1) -> float | None:
    if not isinstance(value, (int, float)):
        return None

    normalized = float(value)
    if normalized < 0:
        return None

    return round(normalized, digits)


def _to_kilobytes(value: Any) -> float | None:
    bytes_value = _round_metric(value, 1)
    if bytes_value is None:
        return None

    return round(bytes_value / 1024, 1)


def _normalized_host(value: str) -> str | None:
    parsed = urlparse(value)
    host = parsed.netloc.casefold()
    if not host:
        return None
    if host.startswith('www.'):
        host = host[4:]
    return host


def _request_duration_ms(timing: Any) -> float | None:
    if not isinstance(timing, dict):
        return None

    for key in ('responseEnd', 'responseStart'):
        value = timing.get(key)
        if isinstance(value, (int, float)) and value >= 0:
            return round(float(value), 1)

    return None


def _collect_network_requests(page: Any, page_url: str) -> tuple[list[dict[str, Any]], Any]:
    origin_host = _normalized_host(page_url)
    requests: list[dict[str, Any]] = []
    request_entries: dict[int, dict[str, Any]] = {}
    pending_updates: set[asyncio.Task[Any]] = set()

    def _ensure_entry(request: Any) -> dict[str, Any] | None:
        request_url = getattr(request, 'url', None)
        if not isinstance(request_url, str) or request_url.startswith(('data:', 'blob:')):
            return None

        request_key = id(request)
        entry = request_entries.get(request_key)
        if entry is not None:
            return entry

        request_host = _normalized_host(request_url)
        entry = {
            'url': request_url,
            'host': request_host,
            'method': getattr(request, 'method', None),
            'resource_type': getattr(request, 'resource_type', None),
            'status': None,
            'duration_ms': None,
            'transfer_size_kb': None,
            'failed': False,
            'failure': None,
            'is_third_party': bool(origin_host and request_host and request_host != origin_host),
            'is_navigation_request': bool(request.is_navigation_request()),
        }
        request_entries[request_key] = entry
        requests.append(entry)
        return entry

    async def _record_finished_request(request: Any) -> None:
        entry = _ensure_entry(request)
        if entry is None:
            return

        response = None
        try:
            response = await request.response()
        except Exception:
            response = None

        entry['status'] = response.status if response is not None else None

        sizes = None
        if response is not None:
            try:
                sizes = await request.sizes()
            except Exception:
                sizes = None

        transfer_size_kb = None
        if isinstance(sizes, dict):
            headers_size = sizes.get('responseHeadersSize')
            body_size = sizes.get('responseBodySize')
            if isinstance(headers_size, (int, float)) and isinstance(body_size, (int, float)) and headers_size >= 0 and body_size >= 0:
                transfer_size_kb = round((float(headers_size) + float(body_size)) / 1024, 1)

        entry['duration_ms'] = _request_duration_ms(getattr(request, 'timing', None))
        entry['transfer_size_kb'] = transfer_size_kb

    async def _record_failed_request(request: Any) -> None:
        entry = _ensure_entry(request)
        if entry is None:
            return

        entry['duration_ms'] = _request_duration_ms(getattr(request, 'timing', None))
        entry['failed'] = True
        entry['failure'] = getattr(request, 'failure', None)

    def _track(coroutine: Any) -> None:
        task = asyncio.create_task(coroutine)
        pending_updates.add(task)
        task.add_done_callback(pending_updates.discard)

    def _on_request(request: Any) -> None:
        _ensure_entry(request)

    def _on_request_finished(request: Any) -> None:
        _track(_record_finished_request(request))

    def _on_request_failed(request: Any) -> None:
        _track(_record_failed_request(request))

    page.on('request', _on_request)
    page.on('requestfinished', _on_request_finished)
    page.on('requestfailed', _on_request_failed)

    async def _flush_requests() -> list[dict[str, Any]]:
        if pending_updates:
            await asyncio.gather(*tuple(pending_updates), return_exceptions=True)

        return requests

    return requests, _flush_requests


def _build_httpx_auth(username: str | None, password: str | None) -> httpx.BasicAuth | None:
    if not username or password is None:
        return None

    return httpx.BasicAuth(username, password)


def _build_playwright_http_credentials(username: str | None, password: str | None) -> dict[str, str] | None:
    if not username or password is None:
        return None

    return {
        'username': username,
        'password': password,
    }


def _check_expected_keywords(search_text: str, keyword: Optional[str]) -> tuple[bool | None, list[str]]:
    expected_keywords = _parse_keywords(keyword)
    if not expected_keywords:
        return None, []

    response_text = search_text.casefold()
    missing_keywords = [item for item in expected_keywords if item.casefold() not in response_text]
    return len(missing_keywords) == 0, missing_keywords


async def _render_page_snapshot(
    url: str,
    *,
    basic_auth_username: str | None = None,
    basic_auth_password: str | None = None,
    java_script_enabled: bool = True,
    include_screenshot: bool = False,
) -> dict[str, Any]:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=['--disable-dev-shm-usage', '--no-sandbox'],
        )
        context = None
        page = None

        try:
            context = await browser.new_context(
                ignore_https_errors=True,
                http_credentials=_build_playwright_http_credentials(basic_auth_username, basic_auth_password),
                java_script_enabled=java_script_enabled,
                viewport=SCREENSHOT_VIEWPORT,
            )
            page = await context.new_page()
            _, flush_requests = _collect_network_requests(page, url)
            if java_script_enabled:
                await page.add_init_script(
                                        r"""
                                        window.__statusBeaconPerf = { lcp: null, cls: 0, tbt: 0 };

                                        try {
                                            new PerformanceObserver((list) => {
                                                const entries = list.getEntries();
                                                const last = entries[entries.length - 1];
                                                if (last) {
                                                    window.__statusBeaconPerf.lcp = last.startTime;
                                                }
                                            }).observe({ type: 'largest-contentful-paint', buffered: true });
                                        } catch (error) {
                                            // Ignore unsupported performance entry types.
                                        }

                                        try {
                                            new PerformanceObserver((list) => {
                                                for (const entry of list.getEntries()) {
                                                    if (!entry.hadRecentInput) {
                                                        window.__statusBeaconPerf.cls += entry.value;
                                                    }
                                                }
                                            }).observe({ type: 'layout-shift', buffered: true });
                                        } catch (error) {
                                            // Ignore unsupported performance entry types.
                                        }

                                        try {
                                            new PerformanceObserver((list) => {
                                                for (const entry of list.getEntries()) {
                                                    window.__statusBeaconPerf.tbt += Math.max(0, entry.duration - 50);
                                                }
                                            }).observe({ type: 'longtask', buffered: true });
                                        } catch (error) {
                                            // Ignore unsupported performance entry types.
                                        }
                                        """
                            )
            await page.goto(url, wait_until='domcontentloaded', timeout=BROWSER_TIMEOUT_MS)
            try:
                await page.wait_for_load_state('networkidle', timeout=3000)
            except PlaywrightTimeoutError:
                pass

            await page.wait_for_selector('body', state='attached', timeout=3000)
            if java_script_enabled:
                await page.evaluate(
                    """() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"""
                )
            snapshot = await page.evaluate(
                r"""() => {
                    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
                    const listText = (selector) => Array.from(document.querySelectorAll(selector))
                      .map((node) => normalize(node.innerText || node.textContent || ''))
                      .filter(Boolean);
                    const splitLines = (value) => (value || '')
                      .split(/\n+/)
                      .map((part) => normalize(part))
                      .filter(Boolean);
                                        const canonicalLinks = Array.from(document.querySelectorAll('link[rel="canonical"]'))
                                            .map((node) => normalize(node.getAttribute('href') || ''))
                                            .filter(Boolean);
                                        const twitterCard = normalize(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') || '');
                                        const twitterTitle = normalize(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') || '');
                                        const twitterDescription = normalize(document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') || '');
                                        const twitterImage = normalize(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || '');
                                        const images = Array.from(document.images || []);
                                        const imagesMissingAlt = images.filter((image) => !normalize(image.getAttribute('alt') || '')).length;
                                        const navigation = performance.getEntriesByType('navigation')[0];
                                        const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];
                                        const perf = window.__statusBeaconPerf || { lcp: null, cls: 0, tbt: 0 };

                    return {
                      title: normalize(document.title),
                      metaDescription: normalize(document.querySelector('meta[name="description"]')?.getAttribute('content') || ''),
                                                                                        canonical: canonicalLinks[0] || '',
                                                                                        canonicalCount: canonicalLinks.length,
                                                                                        viewport: normalize(document.querySelector('meta[name="viewport"]')?.getAttribute('content') || ''),
                                                                                        charset: normalize(document.characterSet || ''),
                                            metaRobots: normalize(document.querySelector('meta[name="robots"]')?.getAttribute('content') || ''),
                                            htmlLang: normalize(document.documentElement?.getAttribute('lang') || ''),
                                            h1: listText('h1'),
                      headings: listText('h1, h2, h3'),
                      actions: listText('button, a'),
                                            openGraphTitle: normalize(document.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''),
                                            openGraphDescription: normalize(document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''),
                                            openGraphImage: normalize(document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''),
                                                                                        twitterCard,
                                                                                        twitterTitle,
                                                                                        twitterDescription,
                                                                                        twitterImage,
                                                                                        hasTwitterCard: twitterCard.length > 0,
                                                                                        hasStructuredData: document.querySelectorAll('script[type="application/ld+json"]').length > 0,
                                                                                        imageCount: images.length,
                                                                                        imagesMissingAlt,
                      bodyText: normalize(document.body?.innerText || ''),
                      bodyLines: splitLines(document.body?.innerText || ''),
                                            performance: {
                                                domContentLoaded: navigation?.domContentLoadedEventEnd || null,
                                                loadEvent: navigation?.loadEventEnd || null,
                                                transferSize: navigation?.transferSize || null,
                                                encodedBodySize: navigation?.encodedBodySize || null,
                                                decodedBodySize: navigation?.decodedBodySize || null,
                                                firstContentfulPaint: firstContentfulPaint?.startTime || null,
                                                largestContentfulPaint: perf.lcp,
                                                cumulativeLayoutShift: perf.cls,
                                                totalBlockingTime: perf.tbt,
                                            },
                    };
                }"""
            )

            if include_screenshot:
                screenshot_bytes = await page.screenshot(
                    type='jpeg',
                    quality=SCREENSHOT_QUALITY,
                    full_page=False,
                    animations='disabled',
                )
                snapshot['screenshotHash'] = _hash_image_bytes(screenshot_bytes)
                snapshot['screenshotPreview'] = _encode_screenshot_preview(screenshot_bytes)

            snapshot['requests'] = await flush_requests()

            return snapshot
        finally:
            if page is not None:
                await page.close()
            if context is not None:
                await context.close()
            await browser.close()


def _build_keyword_search_text(snapshot: dict[str, Any]) -> str:
    parts = [
        snapshot.get('title', ''),
        snapshot.get('metaDescription', ''),
        *snapshot.get('headings', []),
        *snapshot.get('actions', []),
        snapshot.get('bodyText', ''),
    ]
    return "\n".join(part for part in parts if part)


def _build_seo_report(snapshot: dict[str, Any], headers: httpx.Headers, *, final_url: str | None = None) -> dict[str, Any]:
    title = _normalized_or_none(snapshot.get('title', ''))
    meta_description = _normalized_or_none(snapshot.get('metaDescription', ''))
    canonical = _normalized_or_none(snapshot.get('canonical', ''))
    canonical_count_raw = snapshot.get('canonicalCount', 0)
    canonical_count = canonical_count_raw if isinstance(canonical_count_raw, int) else 0
    viewport = _normalized_or_none(snapshot.get('viewport', ''))
    charset = _normalized_or_none(snapshot.get('charset', ''))
    meta_robots = _normalized_or_none(snapshot.get('metaRobots', ''))
    html_lang = _normalized_or_none(snapshot.get('htmlLang', ''))
    h1_values = _dedupe_candidates(snapshot.get('h1', []))
    og_title = _normalized_or_none(snapshot.get('openGraphTitle', ''))
    og_description = _normalized_or_none(snapshot.get('openGraphDescription', ''))
    og_image = _normalized_or_none(snapshot.get('openGraphImage', ''))
    twitter_card = _normalized_or_none(snapshot.get('twitterCard', ''))
    twitter_title = _normalized_or_none(snapshot.get('twitterTitle', ''))
    twitter_description = _normalized_or_none(snapshot.get('twitterDescription', ''))
    twitter_image = _normalized_or_none(snapshot.get('twitterImage', ''))
    has_twitter_card = bool(snapshot.get('hasTwitterCard', False))
    has_structured_data = bool(snapshot.get('hasStructuredData', False))
    image_count_raw = snapshot.get('imageCount', 0)
    image_count = image_count_raw if isinstance(image_count_raw, int) else 0
    images_missing_alt_raw = snapshot.get('imagesMissingAlt', 0)
    images_missing_alt = images_missing_alt_raw if isinstance(images_missing_alt_raw, int) else 0
    x_robots_tag = _normalized_or_none(headers.get('x-robots-tag', ''))

    title_length = len(title) if title else None
    meta_description_length = len(meta_description) if meta_description else None
    robots_signals = " ".join(value for value in (meta_robots, x_robots_tag) if value).casefold()
    noindex_detected = 'noindex' in robots_signals
    parsed_final_url = urlparse(final_url) if final_url else None

    issues: list[str] = []
    if not title:
        issues.append('Missing page title')
    elif title_length is not None and title_length < 20:
        issues.append('Title is shorter than 20 characters')
    elif title_length is not None and title_length > 60:
        issues.append('Title is longer than 60 characters')

    if not meta_description:
        issues.append('Missing meta description')
    elif meta_description_length is not None and meta_description_length < 50:
        issues.append('Meta description is shorter than 50 characters')
    elif meta_description_length is not None and meta_description_length > 160:
        issues.append('Meta description is longer than 160 characters')

    if not canonical:
        issues.append('Missing canonical URL')
    elif canonical:
        parsed_canonical = urlparse(canonical)
        if parsed_canonical.scheme not in ('http', 'https') or not parsed_canonical.netloc:
            issues.append('Canonical URL should be absolute (https://...)')
        if parsed_canonical.fragment:
            issues.append('Canonical URL should not include a #fragment')
        if parsed_final_url and parsed_final_url.netloc and parsed_canonical.netloc and parsed_canonical.netloc.casefold() != parsed_final_url.netloc.casefold():
            issues.append('Canonical host differs from final response host')

    if canonical_count > 1:
        issues.append('Multiple canonical links found')

    if not viewport:
        issues.append('Missing viewport meta tag')
    else:
        viewport_lower = viewport.casefold()
        if 'width=device-width' not in viewport_lower:
            issues.append('Viewport meta tag is missing width=device-width')
        if 'initial-scale' not in viewport_lower:
            issues.append('Viewport meta tag is missing initial-scale')

    if not charset:
        issues.append('Missing charset declaration')
    elif charset.casefold() != 'utf-8':
        issues.append('Charset is not UTF-8')

    if not html_lang:
        issues.append('Missing html lang attribute')

    if len(h1_values) == 0:
        issues.append('Missing H1 heading')
    elif len(h1_values) > 1:
        issues.append('Multiple H1 headings found')

    if noindex_detected:
        issues.append('Page is marked noindex')
        if canonical:
            issues.append('Page is marked noindex despite having a canonical URL')

    if not og_title:
        issues.append('Missing Open Graph title')

    if not og_description:
        issues.append('Missing Open Graph description')

    if not og_image:
        issues.append('Missing Open Graph image')

    if not has_twitter_card:
        issues.append('Missing Twitter card meta tag')
    else:
        if not twitter_title:
            issues.append('Twitter card is missing a title')
        if not twitter_description:
            issues.append('Twitter card is missing a description')
        if twitter_card == 'summary_large_image' and not twitter_image:
            issues.append('Twitter large image card is missing an image')

    if not has_structured_data:
        issues.append('No structured data (JSON-LD) found')

    if image_count > 0 and images_missing_alt > 0:
        issues.append(f'{images_missing_alt} image' + ('' if images_missing_alt == 1 else 's') + ' missing alt text')

    return {
        'applicable': True,
        'title': title,
        'title_length': title_length,
        'meta_description': meta_description,
        'meta_description_length': meta_description_length,
        'canonical': canonical,
        'canonical_count': canonical_count,
        'viewport': viewport,
        'charset': charset,
        'robots': meta_robots or x_robots_tag,
        'meta_robots': meta_robots,
        'x_robots_tag': x_robots_tag,
        'lang': html_lang,
        'h1': h1_values,
        'h1_count': len(h1_values),
        'og_title': og_title,
        'og_description': og_description,
        'og_image': og_image,
        'twitter_card': twitter_card,
        'twitter_title': twitter_title,
        'twitter_description': twitter_description,
        'twitter_image': twitter_image,
        'has_twitter_card': has_twitter_card,
        'has_structured_data': has_structured_data,
        'image_count': image_count,
        'images_missing_alt': images_missing_alt,
        'issues': issues,
    }


def _build_non_html_seo_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['SEO checks require an HTML page response'],
    }


def _build_failed_seo_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Could not render the page for SEO checks'],
    }


def _build_performance_report(
    snapshot: dict[str, Any],
    *,
    ttfb_seconds: float | None,
    budgets: dict[str, float] | None,
) -> dict[str, Any]:
    performance = snapshot.get('performance') or {}
    active_budgets = effective_performance_budgets(budgets)
    metrics = {
        'ttfb_ms': round(ttfb_seconds * 1000, 1) if ttfb_seconds is not None else None,
        'first_contentful_paint_ms': _round_metric(performance.get('firstContentfulPaint')),
        'largest_contentful_paint_ms': _round_metric(performance.get('largestContentfulPaint')),
        'cumulative_layout_shift': _round_metric(performance.get('cumulativeLayoutShift'), 3),
        'total_blocking_time_ms': _round_metric(performance.get('totalBlockingTime')),
        'dom_content_loaded_ms': _round_metric(performance.get('domContentLoaded')),
        'load_event_ms': _round_metric(performance.get('loadEvent')),
        'transfer_size_kb': _to_kilobytes(performance.get('transferSize')),
        'encoded_body_size_kb': _to_kilobytes(performance.get('encodedBodySize')),
        'decoded_body_size_kb': _to_kilobytes(performance.get('decodedBodySize')),
    }

    issues: list[str] = []
    issue_labels = {
        'ttfb_ms': 'TTFB is above 800 ms',
        'first_contentful_paint_ms': 'First Contentful Paint is above 1.8 s',
        'largest_contentful_paint_ms': 'Largest Contentful Paint is above 2.5 s',
        'cumulative_layout_shift': 'Cumulative Layout Shift is above 0.1',
        'total_blocking_time_ms': 'Total Blocking Time is above 200 ms',
        'dom_content_loaded_ms': 'DOMContentLoaded is above 1.5 s',
        'transfer_size_kb': 'Transferred page weight is above 512 KB',
    }

    evaluated_metrics = 0
    passing_metrics = 0
    for metric_name, budget in active_budgets.items():
        value = metrics.get(metric_name)
        if value is None:
            continue
        evaluated_metrics += 1
        if value <= budget:
            passing_metrics += 1
        else:
            issues.append(issue_labels[metric_name])

    return {
        'applicable': True,
        'metrics': metrics,
        'budgets': active_budgets,
        'evaluated_metrics': evaluated_metrics,
        'passing_metrics': passing_metrics,
        'issues': issues,
    }


def _build_non_html_performance_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Performance budgets require an HTML page response'],
    }


def _build_failed_performance_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Could not render the page for performance budgets'],
    }


def _build_network_report(snapshot: dict[str, Any]) -> dict[str, Any]:
    requests = snapshot.get('requests') or []
    request_count = len(requests)
    failed_count = sum(1 for item in requests if item.get('failed') is True)
    error_status_count = sum(
        1 for item in requests if isinstance(item.get('status'), int) and int(item['status']) >= 400
    )
    third_party_count = sum(1 for item in requests if item.get('is_third_party') is True)

    total_transfer_kb = None
    if requests:
        total_transfer_kb = round(
            sum(float(item.get('transfer_size_kb') or 0) for item in requests),
            1,
        )

    slowest_requests = sorted(
        requests,
        key=lambda item: item.get('duration_ms') if isinstance(item.get('duration_ms'), (int, float)) else -1,
        reverse=True,
    )[:5]
    slowest_request_ms = None
    if slowest_requests:
        slowest_request_ms = slowest_requests[0].get('duration_ms')

    issues: list[str] = []
    if failed_count:
        issues.append(f'{failed_count} request failure' + ('' if failed_count == 1 else 's') + ' during render')
    if error_status_count:
        issues.append(f'{error_status_count} request' + ('' if error_status_count == 1 else 's') + ' returned 4xx/5xx')
    if isinstance(slowest_request_ms, (int, float)) and slowest_request_ms >= 1000:
        issues.append(f'Slowest request took {round(float(slowest_request_ms))} ms')

    return {
        'applicable': True,
        'request_count': request_count,
        'failed_count': failed_count,
        'error_status_count': error_status_count,
        'third_party_count': third_party_count,
        'total_transfer_kb': total_transfer_kb,
        'slowest_request_ms': slowest_request_ms,
        'slowest_requests': slowest_requests,
        'issues': issues,
    }


def _build_non_html_network_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Waterfall capture requires an HTML page response'],
    }


def _build_failed_network_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Could not capture network waterfall data for this page'],
    }


def _build_screenshot_report() -> dict[str, Any]:
    return {
        'applicable': True,
        'baseline_available': False,
        'changed': None,
        'issues': [],
    }


def _build_non_html_screenshot_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Screenshot compare requires an HTML page response'],
    }


def _build_failed_screenshot_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Could not capture a rendered screenshot for this page'],
    }


def _build_noscript_report(snapshot: dict[str, Any], keyword: Optional[str]) -> dict[str, Any]:
    title = _normalized_or_none(snapshot.get('title', ''))
    body_text = _normalized_or_none(snapshot.get('bodyText', '')) or ''
    h1_values = _dedupe_candidates(snapshot.get('h1', []))
    keyword_ok, missing_keywords = _check_expected_keywords(_build_keyword_search_text(snapshot), keyword)

    issues: list[str] = []
    if not body_text and not h1_values:
        issues.append('Page looks empty with JavaScript disabled')
    elif len(body_text) < 120 and not h1_values:
        issues.append('Very little content is visible with JavaScript disabled')

    if keyword_ok is False:
        issues.append('Configured phrases are missing with JavaScript disabled')

    return {
        'applicable': True,
        'title': title,
        'h1': h1_values,
        'body_text_length': len(body_text),
        'keyword_ok': keyword_ok,
        'missing_keywords': missing_keywords,
        'issues': issues,
    }


def _build_non_html_noscript_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['NoScript checks require an HTML page response'],
    }


def _build_failed_noscript_report(content_type: str | None) -> dict[str, Any]:
    return {
        'applicable': False,
        'content_type': content_type,
        'issues': ['Could not render the page with JavaScript disabled'],
    }


def _build_header_report(headers: httpx.Headers, *, is_https: bool) -> dict[str, Any]:
    values = {header: _normalized_or_none(headers.get(header, '')) for header in IMPORTANT_RESPONSE_HEADERS}
    issues: list[str] = []

    required_headers = [
        'cache-control',
        'content-security-policy',
        'x-content-type-options',
        'x-frame-options',
        'referrer-policy',
        'permissions-policy',
    ]
    if is_https:
        required_headers.append('strict-transport-security')

    for header in required_headers:
        if not values.get(header):
            issues.append(f'Missing {header} header')

    return {
        'values': values,
        'issues': issues,
    }


async def _get_keyword_search_text(
    url: str,
    fallback_text: str,
    *,
    basic_auth_username: str | None = None,
    basic_auth_password: str | None = None,
) -> str:
    try:
        snapshot = await _render_page_snapshot(
            url,
            basic_auth_username=basic_auth_username,
            basic_auth_password=basic_auth_password,
        )
        rendered_text = _build_keyword_search_text(snapshot)
        return rendered_text or fallback_text
    except Exception:
        return fallback_text


async def suggest_keywords(
    url: str,
    *,
    basic_auth_username: str | None = None,
    basic_auth_password: str | None = None,
    limit: int = SUGGESTION_LIMIT,
) -> list[str]:
    snapshot = await _render_page_snapshot(
        url,
        basic_auth_username=basic_auth_username,
        basic_auth_password=basic_auth_password,
        include_screenshot=False,
    )
    candidates = [
        * _title_fragments(snapshot.get('title', '')),
        * _sentence_fragments(snapshot.get('metaDescription', '')),
        * snapshot.get('headings', []),
        * snapshot.get('actions', []),
        * snapshot.get('bodyLines', []),
    ]

    suggestions: list[str] = []
    for candidate in _dedupe_candidates(candidates):
        if not _is_suggestion_candidate(candidate):
            continue
        suggestions.append(candidate)
        if len(suggestions) >= limit:
            break

    return suggestions


async def check_website(
    url: str,
    keyword: Optional[str] = None,
    *,
    basic_auth_username: str | None = None,
    basic_auth_password: str | None = None,
    check_noscript: bool = False,
    performance_budgets: dict[str, float] | None = None,
) -> dict:
    tls_target_url = url
    result: dict = {
        "status_code": None,
        "response_time": None,
        "ttfb": None,
        "ssl_days_left": None,
        "keyword_ok": None,
        "missing_keywords": [],
        "rendered_content_hash": None,
        "rendered_content_summary": None,
        "seo_report": None,
        "header_report": None,
        "tls_report": None,
        "noscript_report": None,
        "screenshot_report": None,
        "performance_report": None,
        "network_report": None,
        "screenshot_hash": None,
        "screenshot_preview": None,
    }

    try:
        auth = _build_httpx_auth(basic_auth_username, basic_auth_password)
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, auth=auth) as client:
            clock = asyncio.get_running_loop()
            start = clock.time()

            async with client.stream('GET', url) as response:
                result["ttfb"] = round(clock.time() - start, 3)
                await response.aread()
                elapsed = clock.time() - start
                final_url = str(response.url)
                final_is_https = final_url.startswith("https://")
                tls_target_url = final_url

                result["status_code"] = response.status_code
                result["response_time"] = round(elapsed, 3)
                result["header_report"] = _build_header_report(response.headers, is_https=final_is_https)

                content_type = _normalized_or_none(response.headers.get('content-type', ''))
                is_html_response = bool(content_type and 'html' in content_type.casefold())

                rendered_search_text = response.text
                if is_html_response:
                    try:
                        snapshot = await _render_page_snapshot(
                            url,
                            basic_auth_username=basic_auth_username,
                            basic_auth_password=basic_auth_password,
                            include_screenshot=True,
                        )
                        rendered_search_text = _build_keyword_search_text(snapshot) or response.text
                        signature_parts = _build_render_signature_parts(snapshot)
                        result["rendered_content_hash"] = _hash_render_signature(signature_parts)
                        result["rendered_content_summary"] = _summarize_render_signature(signature_parts)
                        result["seo_report"] = _build_seo_report(snapshot, response.headers, final_url=final_url)
                        result["performance_report"] = _build_performance_report(
                            snapshot,
                            ttfb_seconds=result["ttfb"],
                            budgets=performance_budgets,
                        )
                        result["network_report"] = _build_network_report(snapshot)
                        result["screenshot_hash"] = snapshot.get("screenshotHash")
                        result["screenshot_preview"] = snapshot.get("screenshotPreview")
                        result["screenshot_report"] = _build_screenshot_report()
                    except Exception:
                        result["seo_report"] = _build_failed_seo_report(content_type)
                        result["performance_report"] = _build_failed_performance_report(content_type)
                        result["network_report"] = _build_failed_network_report(content_type)
                        result["screenshot_report"] = _build_failed_screenshot_report(content_type)

                    if check_noscript:
                        try:
                            noscript_snapshot = await _render_page_snapshot(
                                url,
                                basic_auth_username=basic_auth_username,
                                basic_auth_password=basic_auth_password,
                                java_script_enabled=False,
                                include_screenshot=False,
                            )
                            result["noscript_report"] = _build_noscript_report(noscript_snapshot, keyword)
                        except Exception:
                            result["noscript_report"] = _build_failed_noscript_report(content_type)
                else:
                    result["seo_report"] = _build_non_html_seo_report(content_type)
                    result["performance_report"] = _build_non_html_performance_report(content_type)
                    result["network_report"] = _build_non_html_network_report(content_type)
                    result["screenshot_report"] = _build_non_html_screenshot_report(content_type)
                    if check_noscript:
                        result["noscript_report"] = _build_non_html_noscript_report(content_type)

                keyword_ok, missing_keywords = _check_expected_keywords(rendered_search_text, keyword)
                result["keyword_ok"] = keyword_ok
                result["missing_keywords"] = missing_keywords
    except httpx.TimeoutException:
        result["status_code"] = 0     # timeout
    except Exception:
        result["status_code"] = -1    # connection error

    # SSL expiry check (HTTPS only)
    parsed_url = urlparse(tls_target_url)
    hostname = parsed_url.hostname
    is_https = parsed_url.scheme == 'https'
    if is_https and hostname:
        try:
            result["tls_report"] = await _get_tls_report(hostname)
            result["ssl_days_left"] = result["tls_report"].get("days_left")
        except Exception:
            result["ssl_days_left"] = -1  # SSL error / unreachable
            result["tls_report"] = {
                'applicable': True,
                'valid': False,
                'hostname': hostname,
                'issues': ['TLS handshake failed or the certificate could not be validated'],
            }

    return result
