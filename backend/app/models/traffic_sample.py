from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class TrafficSample(Base):
    __tablename__ = "traffic_samples"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True)
    request_count = Column(Integer, nullable=False)
    error_count = Column(Integer, nullable=False, default=0)
    suspicious_count = Column(Integer, nullable=False, default=0)
    window_minutes = Column(Integer, nullable=False, default=1)
    source = Column(String, nullable=True)
    sampled_at = Column(DateTime(timezone=True), server_default=func.now())

    website = relationship("Website", back_populates="traffic_samples")