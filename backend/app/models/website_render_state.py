from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class WebsiteRenderState(Base):
    __tablename__ = "website_render_states"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    last_hash = Column(String, nullable=True)
    last_summary = Column(String, nullable=True)
    last_changed_at = Column(DateTime(timezone=True), nullable=True)
    last_change_summary = Column(String, nullable=True)
    screenshot_hash = Column(String, nullable=True)
    screenshot_current_preview = Column(Text, nullable=True)
    screenshot_previous_preview = Column(Text, nullable=True)
    screenshot_changed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    website = relationship("Website", back_populates="render_state")