from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Website(Base):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    url = Column(String, nullable=False)
    check_interval = Column(Integer, default=30)  # minutes
    keyword = Column(String, nullable=True)
    basic_auth_username = Column(String, nullable=True)
    basic_auth_password = Column(String, nullable=True)
    check_noscript = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    performance_budgets = Column(JSON, nullable=True)
    tags = Column(JSON, nullable=False, default=list, server_default=text("'[]'::json"))
    is_paused = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def has_basic_auth(self) -> bool:
        return bool(self.basic_auth_username and self.basic_auth_password)

    user = relationship("User", back_populates="websites")
    checks = relationship("Check", back_populates="website", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="website", cascade="all, delete-orphan")
    render_state = relationship("WebsiteRenderState", back_populates="website", cascade="all, delete-orphan", uselist=False)
    traffic_config = relationship("WebsiteTrafficConfig", back_populates="website", cascade="all, delete-orphan", uselist=False)
    traffic_samples = relationship("TrafficSample", back_populates="website", cascade="all, delete-orphan")
