from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/websitemonitor"
    REDIS_URL: str = "redis://redis:6379/0"
    FRONTEND_URL: str = "http://localhost"

    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    PASSWORD_RESET_EXPIRE_MINUTES: int = 30
    EMAIL_VERIFICATION_EXPIRE_HOURS: int = 24

    CORS_ORIGINS: str = "http://localhost:3000,http://localhost"

    # Email (SMTP)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    FROM_EMAIL: str = ""

    # Cloudflare Turnstile
    TURNSTILE_SECRET_KEY: str = ""
    TURNSTILE_SITE_KEY: str = ""

    # Stripe billing
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_PRO_MONTHLY: str = ""
    STRIPE_PRICE_AGENCY_MONTHLY: str = ""

    # Comma-separated bootstrap list for admin users.
    ADMIN_EMAILS: str = ""

    # Telegram
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""
    TELEGRAM_CONNECT_EXPIRE_MINUTES: int = 10
    TELEGRAM_WEBHOOK_SECRET: str = ""

    # Traffic telemetry
    TRAFFIC_SPIKE_FACTOR: float = 3.0
    TRAFFIC_SPIKE_MIN_REQUESTS_PER_MINUTE: int = 500
    TRAFFIC_ERROR_RATE_THRESHOLD: float = 0.2
    TRAFFIC_SUSPICIOUS_RATIO_THRESHOLD: float = 0.15
    TRAFFIC_SUSPICIOUS_MIN_COUNT: int = 25

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
