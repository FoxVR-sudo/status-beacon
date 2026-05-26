# Local setup

This guide keeps setup intentionally short. The fastest path is Docker Compose. Manual mode is included for contributors who want tighter feedback loops.

## Prerequisites

- Docker Desktop or Docker Engine with the Compose plugin
- Optional for manual mode: Python 3.12, Node.js 20, PostgreSQL, and Redis

## Fast path: Docker Compose

1. Copy `.env.example` to `.env`.
2. Keep these local defaults unless you are testing a real external deployment:

   - `FRONTEND_URL=http://localhost`
   - `CORS_ORIGINS=http://localhost:3000,http://localhost`

3. Start the stack:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost`.

What starts:

- `db` on port `5432`
- `redis` on port `6379`
- `backend` on port `8000`
- `nginx` on port `80`

Notes:

- `python -m app.bootstrap` runs automatically inside the backend, worker, and beat containers to create missing tables.
- SMTP, Telegram, Stripe, and Turnstile are optional for a basic local bring-up. Leave them blank if you only want the core monitoring flow.

## Manual development mode

If you want to run backend and frontend directly on your machine, adjust `.env` first:

- Change `DATABASE_URL` so the hostname is `localhost` instead of `db`
- Change `REDIS_URL` so the hostname is `localhost` instead of `redis`

### Backend

From `backend/`:

```bash
pip install -r requirements.txt
playwright install chromium
python -m app.bootstrap
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

In separate shells, also start:

```bash
celery -A app.workers.celery_app worker --loglevel=info --pool=solo
celery -A app.workers.celery_app beat --loglevel=info
```

### Frontend

From `frontend/`:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000` for Vite or `http://localhost` if you are going through nginx.

## Useful checks

- Backend syntax check: `cd backend && python -m compileall app`
- Frontend build: `cd frontend && npm run build`

## Optional integrations

- SMTP powers email alerts and password reset flows.
- Telegram powers chat delivery and connect flow.
- Stripe powers paid plan checkout and portal flows.
- Turnstile powers the bot-check field on public auth forms.

All of them can stay disabled while you work on the monitoring core.