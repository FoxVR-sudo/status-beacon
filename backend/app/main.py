from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_models
from app.services.telegram_connect import register_telegram_webhook


@asynccontextmanager
async def lifespan(application: FastAPI):
    await init_models()
    await register_telegram_webhook()
    yield


app = FastAPI(title="Website Monitor API", version="1.0.0", lifespan=lifespan)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.routes import auth, websites, alerts, settings as settings_router, telegram, traffic, admin, billing  # noqa: E402

app.include_router(auth.router)
app.include_router(websites.router)
app.include_router(alerts.router)
app.include_router(settings_router.router)
app.include_router(billing.router)
app.include_router(telegram.router)
app.include_router(traffic.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
