from sqlalchemy import Boolean, Column, DateTime, Integer, String, text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


ACCOUNT_STATUSES = ("active", "suspended", "disabled")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    first_name = Column(String, nullable=False, default="", server_default="")
    last_name = Column(String, nullable=False, default="", server_default="")
    company_name = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    account_status = Column(String, nullable=False, default="active", server_default="active")
    is_email_verified = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    is_admin = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    telegram_chat_id = Column(String, nullable=True)
    stripe_customer_id = Column(String, nullable=True, unique=True)
    stripe_subscription_id = Column(String, nullable=True, unique=True)
    stripe_price_id = Column(String, nullable=True)
    stripe_subscription_status = Column(String, nullable=True)
    stripe_current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    websites = relationship("Website", back_populates="user", cascade="all, delete-orphan")
