from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone

from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    VerifyEmailRequest,
)
from app.config import settings
from app.services.notifications import send_email
from app.services.captcha import verify_turnstile_token
from app.services.email_templates import (
    build_password_changed_message,
    build_password_reset_message,
    build_verify_email_message,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def create_password_reset_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": email, "type": "password_reset", "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def create_email_verification_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.EMAIL_VERIFICATION_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": email, "type": "email_verification", "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_password_reset_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token") from exc

    if payload.get("type") != "password_reset" or not payload.get("sub"):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    return str(payload["sub"])


def decode_email_verification_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token") from exc

    if payload.get("type") != "email_verification" or not payload.get("sub"):
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    return str(payload["sub"])


def _admin_email_set() -> set[str]:
    return {item.strip().lower() for item in settings.ADMIN_EMAILS.split(",") if item.strip()}


@router.post("/register", status_code=201)
async def register(data: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    await verify_turnstile_token(data.captcha_token, request.client.host if request.client else None)

    first_name = data.first_name.strip()
    last_name = data.last_name.strip()
    if not first_name or not last_name:
        raise HTTPException(status_code=400, detail="First name and last name are required")

    admin_emails = _admin_email_set()
    is_admin = data.email.lower() in admin_emails

    user = User(
        email=data.email,
        first_name=first_name,
        last_name=last_name,
        company_name=data.company_name.strip() if data.company_name else None,
        password_hash=pwd_context.hash(data.password),
        account_status="active",
        is_email_verified=False,
        is_admin=is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    verification_token = create_email_verification_token(user.email)
    verify_url = f"{settings.FRONTEND_URL.rstrip('/')}/verify-email?token={verification_token}"
    subject, text_body, html_body = build_verify_email_message(user.first_name, verify_url)
    await send_email(user.email, subject, text_body, html_body)

    return {"message": "Registration successful. Check your email to verify your account before signing in."}


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await verify_turnstile_token(data.captcha_token, request.client.host if request.client else None)

    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not pwd_context.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.account_status == "suspended":
        raise HTTPException(status_code=403, detail="This account is suspended. Contact support or an administrator.")
    if user.account_status == "disabled":
        raise HTTPException(status_code=403, detail="This account has been disabled.")
    if not user.is_email_verified:
        raise HTTPException(status_code=403, detail="Verify your email before signing in")
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/forgot-password", status_code=200)
async def forgot_password(data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    # Always return 200 to prevent email enumeration
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if user:
        token = create_password_reset_token(user.email)
        reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token}"
        subject, text_body, html_body = build_password_reset_message(reset_url)
        await send_email(user.email, subject, text_body, html_body)
    return {"message": "If that email exists, a reset link has been sent."}


@router.post("/reset-password", status_code=200)
async def reset_password(data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    email = decode_password_reset_token(data.token)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.password_hash = pwd_context.hash(data.password)
    await db.commit()
    subject, text_body, html_body = build_password_changed_message()
    await send_email(user.email, subject, text_body, html_body)
    return {"message": "Password updated successfully."}


@router.post("/verify-email", status_code=200)
async def verify_email(data: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    email = decode_email_verification_token(data.token)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    if not user.is_email_verified:
        user.is_email_verified = True
        user.email_verified_at = datetime.now(timezone.utc)
        await db.commit()

    return {"message": "Email verified successfully. You can now sign in."}
