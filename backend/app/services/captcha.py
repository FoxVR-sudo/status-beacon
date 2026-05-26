import httpx
from fastapi import HTTPException

from app.config import settings


async def verify_turnstile_token(token: str, remote_ip: str | None = None) -> None:
    # Allow local/dev environments without Turnstile configured.
    if not settings.TURNSTILE_SECRET_KEY:
        return

    if not token:
        raise HTTPException(status_code=400, detail="Captcha verification is required")

    payload = {
        "secret": settings.TURNSTILE_SECRET_KEY,
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data=payload,
            )
            response.raise_for_status()
            result = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Captcha provider is unavailable") from exc

    if not result.get("success", False):
        raise HTTPException(status_code=400, detail="Captcha validation failed")
