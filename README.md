# ffrs-api

Capture API of the **Fast Feedback Response System** (FFRS). Dependency-minimal by design: **GitHub Issues is the system of record**, one Node 22 Lambda routes to it, and a private S3 prefix holds the only personal data (a per-item sidecar with the submitter's email). No database. Reference implementation for scaledaiops.org; reusable by any site via one `<script>` tag (widget) and a handful of env vars. Plan: `scaledaiops.org/docs/ffrs-plan.md`.

## How the FFRS stages map

| Stage | Where it is recorded |
|---|---|
| Capture / Route | the GitHub issue (`created_at`), labels `ffrs`, `kind:*`, `severity:*`, hidden marker `<!-- ffrs:FB-XXXXXX -->` |
| Acknowledge | ack email (consented submitters) — `acknowledgedAt` in the S3 sidecar |
| Respond | first comment by a human on the issue (GitHub) |
| Close | issue closed (GitHub); outcome = `outcome:*` label › `state_reason` › kind default; closing email via webhook — `closeEmailAt` in the sidecar |

## Routes

| Route | Purpose |
|---|---|
| `POST /api/feedback` | Validate (Zod) → guards (rate limit, honeypot, Turnstile) → screenshot to S3 (private, presigned 7-day link in the issue) → **create issue** → ack + alert email (best-effort) → sidecar → `202 {ref}`. Idempotent on `Idempotency-Key`. GitHub down ⇒ `502 route_failed` (nothing half-stored; widget retries). Also accepts form-encoded → 303 to `/feedback/`. |
| `GET /api/feedback/:ref` | Public timeline from GitHub + sidecar (timestamps only, never email/body). |
| `POST /api/webhooks/github` | HMAC-verified. `issues.closed` → closing email once; `reopened` re-arms. 404 unless `GITHUB_WEBHOOK_SECRET`. |
| EventBridge weekly (`{job:"weekly_report"}`) | Metrics per kind × ISO week (TTFR p50/p90, TTC p50, loop closure, signal) computed from the Issues API, filed as an issue labelled `ffrs-report`. |

## Env

| Var | Required | Notes |
|---|---|---|
| `GITHUB_REPO`, `GITHUB_TOKEN` | yes | `owner/repo`; fine-grained token with Issues read/write on that repo (token via SSM) |
| `DATA_BUCKET` | yes | private S3 bucket: `sidecar/`, `idem/`, `screenshots/` |
| `SITE_NAME`, `SITE_URL` | yes / default | branding + status links |
| `FROM_EMAIL`, `ALERT_EMAIL` | opt | SES sender (enables ack/close emails) and maintainer alert inbox |
| `TURNSTILE_SECRET` | prod | absent = guard off (warned) |
| `GITHUB_WEBHOOK_SECRET` | loop | enables the webhook route |
| `SSM_PREFIX` | prod | `/ffrs` → secrets read at cold start (`github_token`, `github_webhook_secret`, `turnstile_secret`); kill switch `${SSM_PREFIX}/enabled` cached 60 s |
| `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MIN`, `FFRS_ENABLED` | opt | CORS embedders; default 5/min per hashed IP; env fallback for the kill switch |

## Develop

```bash
npm install
npm run check      # typecheck + vitest (in-memory Tracker/Store, no network) + esbuild + zip → dist/handler.zip
GITHUB_TOKEN=… GITHUB_REPO=Scaled-AIOps/feedback npm run metrics > metrics.csv   # paper data
GITHUB_TOKEN=… GITHUB_REPO=Scaled-AIOps/feedback npm run export  > feedback.csv  # anonymised rows
```

## GitHub setup (once)

Repo labels are created on first use. Webhook: Settings → Webhooks → `https://<site>/api/webhooks/github`, JSON, events **Issues**, secret = SSM `/ffrs/github_webhook_secret`. Add `outcome:*` labels before closing to override the inferred outcome; label `spam` to exclude from the signal ratio.

## Layout

```
src/handler.ts        Lambda entry: SSM secrets → config → adapters → app; job dispatch
src/app.ts            HTTP routing + guards
src/domain/           ports (Tracker, Store), capture(), status view, metrics, webhook, schema, ref
src/adapters/         githubTracker (REST), s3Store, memory twins for tests
src/effects/          templates (ack, alert, close, issue body), SES mailer
src/guards/           honeypot, rateLimit, turnstile
src/reports/          weekly report + runner
scripts/export.ts     CSV export CLI
```
