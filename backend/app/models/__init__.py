# Import all models here so SQLAlchemy registers them before create_all()
from app.models.user import User       # noqa: F401
from app.models.website import Website  # noqa: F401
from app.models.check import Check     # noqa: F401
from app.models.alert import Alert     # noqa: F401
from app.models.telegram_connection import TelegramConnection  # noqa: F401
from app.models.website_render_state import WebsiteRenderState  # noqa: F401
from app.models.website_traffic_config import WebsiteTrafficConfig  # noqa: F401
from app.models.traffic_sample import TrafficSample  # noqa: F401
