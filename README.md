# ffrs-api

Capture API of the **Fast Feedback Response System** (FFRS) — a Node 22 Lambda backed by Neon Postgres. Reference implementation for scaledaiops.org; reusable by any site via one `<script>` tag (widget) and a handful of env vars (API). Plan and rationale: `scaledaiops.org/docs/ffrs-plan.md`.

## Routes

| Route | Purpose |
|---|---|
| `POST /api/feedback` | Capture. Validates (Zod) → guards (rate limit, honeypot, Turnstile) → durable insert + queued side effects → `202 {ref}`. Idempotent on `Idempotency-Key`. |
| `GET /api/feedback/:ref` | Public status timeline (never body/email/screenshot). |
| `POST /api/webhooks/github` | Loop closure. HMAC-verified (`X-Hub-Signature-256`). `issues.closed` → `status=closed`, `outcome` (label `outcome:*` > `state_reason` > kind default), `closed_at`, queues `close_email`; `issues.reopened` → back to `routed`; `issue_comment.created` by a human → `responded_at` (first write). Route is 404 unless `GITHUB_WEBHOOK_SECRET` is set. |
| EventBridge weekly (Mon 07:00 UTC, `{job:"weekly_report"}`) | Posts last week's FFRS metrics (per kind: n, TTA/TTR/TTFR/TTC percentiles, loop closure, signal ratio) as a GitHub issue labelled `ffrs-report`; logs it when GitHub isn't configured. |
| EventBridge (1 min, `{job:"drain_outbox"}`) | Drains the `side_effects` outbox with backoff (1m→6h, then parked). Effects: `ack_email` (stamps `acknowledged_at`), `github_issue` (stamps `routed_at`, status→routed, stores issue URL), `alert_email`. Missing settings ⇒ effect not registered, rows parked with a startup warning. |

## Env

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `SITE_NAME` | yes | e.g. `scaledaiops.org` |
| `TURNSTILE_SECRET` | prod | absent = guard off (warned at startup) |
| `SCREENSHOT_BUCKET` | opt | absent = screenshots rejected with `screenshots_disabled` |
| `ALLOWED_ORIGINS` | opt | comma-separated third-party embedders (CORS); same-origin needs nothing |
| `SSM_PREFIX` | prod | e.g. `/ffrs` → at cold start `DATABASE_URL`/`TURNSTILE_SECRET`/`GITHUB_TOKEN` are read from `${SSM_PREFIX}/<lower_name>` (SecureString) if not in env; runtime kill switch at `${SSM_PREFIX}/enabled`, cached 60 s |
| `FFRS_ENABLED` | opt | `true`/`false` fallback when `SSM_PREFIX` unset |
| `RATE_LIMIT_PER_MIN` | opt | default 5, per hashed IP, per Lambda instance |
| `SITE_URL` | opt | base for status links in emails/issues (default `https://www.scaledaiops.org`) |
| `FROM_EMAIL` | effects | SES sender; enables `ack_email` (and `alert_email` with `ALERT_EMAIL`) |
| `ALERT_EMAIL` | effects | maintainer inbox for new-feedback alerts |
| `GITHUB_WEBHOOK_SECRET` | loop | SSM `/ffrs/github_webhook_secret`; enables the webhook route |
| `GITHUB_REPO` + `GITHUB_TOKEN` | effects | `owner/repo` + token (SSM) → enables `github_issue`; screenshot embedded via 7-day presigned URL |

## Develop

```bash
npm install
npm run check          # typecheck + vitest + esbuild + zip → dist/handler.zip (what Terraform deploys)
DATABASE_URL=… npm run db:migrate   # applies drizzle/*.sql incl. the ffrs_metrics view
DATABASE_URL=… npm run metrics > metrics.csv    # weekly ffrs_metrics view as CSV (paper data)
DATABASE_URL=… npm run export  > feedback.csv   # anonymised per-item rows: no body, email or screenshot
```

Tests use `memoryRepo` — no database needed. `neonRepo` is the production `FeedbackRepo`; both satisfy the same interface (`src/domain/repo.ts`).

## GitHub webhook setup (once)

Repo → Settings → Webhooks → Add: Payload URL `https://www.scaledaiops.org/api/webhooks/github`, content type `application/json`, secret = value of SSM `/ffrs/github_webhook_secret`, events **Issues** + **Issue comments**. Optional labels `outcome:fixed|shipped|answered|declined|wontfix|duplicate` override the inferred outcome when closing.

## Layout

```
src/handler.ts      Lambda entry: wires config → repo/blobs/guards → app; schedule → outbox
src/app.ts          HTTP routing + guards, framework-free
src/domain/         capture() (stage 1), webhook transitions (stages 4–5), Zod input schema, ref generator, repo interfaces
src/db/             drizzle schema, neonRepo, memoryRepo, s3Blobs
src/guards/         honeypot, rateLimit, turnstile
src/effects/        Effect plug-ins: ackEmail, alertEmail, githubIssue; SES mailer; templates; buildEffects(cfg)
src/outbox.ts       claim → run → complete / fail-with-backoff
src/reports/        weekly report (markdown) + runner; src/domain/metrics.ts is the TS twin of the SQL view
scripts/export.ts   CSV export CLI
drizzle/            migrations (0000 schema, 0001 ffrs_metrics view)
```
