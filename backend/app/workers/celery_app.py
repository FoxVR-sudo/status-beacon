from celery import Celery

from app.config import settings

celery_app = Celery(
    "worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.workers.tasks"],
)

celery_app.conf.timezone = "UTC"

# Dispatcher runs every 60 seconds and queues checks that are due
celery_app.conf.beat_schedule = {
    "dispatch-checks-every-minute": {
        "task": "app.workers.tasks.dispatch_checks",
        "schedule": 60.0,
    },
}
