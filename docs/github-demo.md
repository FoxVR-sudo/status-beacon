# GitHub Demo Walkthrough

This repository already has a lightweight GitHub-friendly demo path through a public deployment.

Live URL: replace this with your own public demo deployment if you want one.

## Fastest path

1. Open the landing page.
2. Find `Demo route`.
3. Click `View demo data`.
4. Review the sample monitoring snapshot without creating an account.

This public surface is meant to answer three questions quickly:

- What kind of monitoring evidence does the product collect?
- How readable is the output for a non-technical operator or team lead?
- Is the product focused on incidents and workflow instead of raw logs only?

## What the demo is meant to show

### Landing page

- Positioning for the product
- Public monitoring snapshot with realistic output
- Pricing and billing entry points
- Security and platform framing

### Dashboard

After sign-in, the dashboard is the main operating surface.

Key areas:

- active incident review
- rendered content drift
- SEO issues such as canonical and metadata gaps
- performance budget breaches
- network waterfall summaries
- traffic telemetry and suspicious request visibility

### Settings

The settings surface shows how the product handles delivery and monetization:

- Telegram connect flow
- test alert delivery
- billing summary
- Stripe checkout and portal actions

## Best GitHub talking points

If you are presenting the project from GitHub, these are the strongest short points:

- Full-stack synthetic monitoring, not just uptime checks
- Render-aware checks with SEO and performance evidence in the same workflow
- Incident-first dashboard instead of deeply nested report views
- Telegram and email alert routing
- Stripe-backed billing flow already wired into the product
- Full-stack product built with FastAPI, React, Celery, Redis, PostgreSQL, and nginx

## Suggested 2-minute demo script

1. Show the landing page and explain the product in one sentence.
2. Open `Demo route` and click `View demo data`.
3. Point out rendered output, SEO gaps, and alert status from the sample snapshot.
4. Explain that Dashboard owns runtime signal while Settings owns routing and billing.
5. Close on the fact that the product can be shown through a dedicated public demo deployment and that the repository contains the full implementation.

## Repo surfaces worth opening while presenting

- [README.md](../README.md)
- [frontend/src/pages/Landing.tsx](../frontend/src/pages/Landing.tsx)
- [frontend/src/pages/Dashboard.tsx](../frontend/src/pages/Dashboard.tsx)
- [frontend/src/pages/Settings.tsx](../frontend/src/pages/Settings.tsx)
- [backend/app/services/monitor.py](../backend/app/services/monitor.py)

