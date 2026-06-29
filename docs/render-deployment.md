# Render Deployment

This project should be deployed to Render as a Docker web service, not as a static site. The app needs Next.js API routes, Playwright portal automation, SQLite audit logs, and JSON cache files.

## What Render Uses

- `render.yaml` defines one Docker web service.
- `Dockerfile` installs Node 22, project dependencies, Chromium, and Playwright Linux dependencies.
- A persistent disk is mounted at `/var/data`.
- Runtime application data is stored below `/var/data/hefamaa`.

## Required Secret Variables

Add these in the Render dashboard or through Blueprint sync prompts:

- `GOOGLE_SHEET_ID`
- `OLD_GOOGLE_SHEET_ID` if the old database is enabled
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GEMINI_API_KEY`
- `TERMII_API_KEY` if SMS is enabled
- `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` if Resend is enabled
- `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`, and `GMAIL_SMTP_FROM` if Gmail SMTP reminders are enabled
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` if Gmail intelligence sync is enabled


## Root Directory Requirement

Render must build this service from the repository root. Do not set the Render service Root Directory to `frontend`. The root directory should be blank in the dashboard, or `rootDir: .` should be applied from `render.yaml`. If Root Directory is set to `frontend`, Render will look for `frontend/Dockerfile` and fail with `open Dockerfile: no such file or directory`.

## Portal Automation Note

Render runs without a visible desktop, so `HEFAMAA_PORTAL_HEADLESS=true` is set in `render.yaml`. Local development still opens a visible portal browser by default. For production portal scans, the portal session must be valid through the persisted storage state on the Render disk.

## Deploy Steps

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repository, or create a Docker web service that uses the root `Dockerfile`.
3. Confirm the persistent disk mount is `/var/data`.
4. Add the secret environment variables above.
5. Deploy. The app starts with `npm run start -- -p $PORT -H 0.0.0.0` from inside the container.
