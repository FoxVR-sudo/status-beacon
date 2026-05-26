from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False, poolclass=NullPool)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
SCHEMA_LOCK_ID = 82024051


class Base(DeclarativeBase):
    pass


async def init_models() -> None:
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.execute(text(f"SELECT pg_advisory_lock({SCHEMA_LOCK_ID})"))
        try:
            await conn.run_sync(Base.metadata.create_all)
            await _ensure_runtime_schema(conn)
        finally:
            await conn.execute(text(f"SELECT pg_advisory_unlock({SCHEMA_LOCK_ID})"))


async def _ensure_runtime_schema(conn) -> None:
    if conn.dialect.name != "postgresql":
        return

    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS tags JSON NOT NULL DEFAULT '[]'::json"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS basic_auth_username VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS basic_auth_password VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS check_noscript BOOLEAN NOT NULL DEFAULT false"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS performance_budgets JSON NULL"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS tls_baseline JSON NULL"))
    await conn.execute(text("ALTER TABLE websites ADD COLUMN IF NOT EXISTS tls_baseline_approved_at TIMESTAMPTZ NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS seo_report JSON NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS header_report JSON NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS tls_report JSON NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS ttfb DOUBLE PRECISION NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS noscript_report JSON NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS screenshot_report JSON NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS performance_report JSON NULL"))
    await conn.execute(text("ALTER TABLE checks ADD COLUMN IF NOT EXISTS network_report JSON NULL"))
    await conn.execute(text("ALTER TABLE website_render_states ADD COLUMN IF NOT EXISTS screenshot_hash VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE website_render_states ADD COLUMN IF NOT EXISTS screenshot_current_preview TEXT NULL"))
    await conn.execute(text("ALTER TABLE website_render_states ADD COLUMN IF NOT EXISTS screenshot_previous_preview TEXT NULL"))
    await conn.execute(text("ALTER TABLE website_render_states ADD COLUMN IF NOT EXISTS screenshot_changed_at TIMESTAMPTZ NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR NOT NULL DEFAULT ''"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR NOT NULL DEFAULT ''"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR NOT NULL DEFAULT 'active'"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT false"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_status VARCHAR NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMPTZ NULL"))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_stripe_customer_id ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL"))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_stripe_subscription_id ON users (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL"))
    await conn.execute(text("UPDATE users SET account_status = 'active' WHERE account_status IS NULL OR account_status = ''"))
    # Existing users were created before verification existed, so mark them verified.
    await conn.execute(text("UPDATE users SET is_email_verified = true WHERE is_email_verified = false AND email_verified_at IS NULL"))


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
