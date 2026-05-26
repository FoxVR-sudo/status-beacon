from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)    # http_error | ssl_expiry | keyword_missing | timeout
    message = Column(String, nullable=False)
    sent_at = Column(DateTime(timezone=True), server_default=func.now())

    website = relationship("Website", back_populates="alerts")
