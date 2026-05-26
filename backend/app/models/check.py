from sqlalchemy import Column, Integer, Float, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Check(Base):
    __tablename__ = "checks"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_time = Column(Float, nullable=True)   # seconds
    ttfb = Column(Float, nullable=True)   # seconds
    ssl_days_left = Column(Integer, nullable=True)
    keyword_ok = Column(Boolean, nullable=True)
    seo_report = Column(JSON, nullable=True)
    header_report = Column(JSON, nullable=True)
    tls_report = Column(JSON, nullable=True)
    noscript_report = Column(JSON, nullable=True)
    screenshot_report = Column(JSON, nullable=True)
    performance_report = Column(JSON, nullable=True)
    network_report = Column(JSON, nullable=True)
    checked_at = Column(DateTime(timezone=True), server_default=func.now())

    website = relationship("Website", back_populates="checks")
