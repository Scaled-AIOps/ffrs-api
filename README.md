# ffrs-api

Capture API of the **Fast Feedback Response System** (FFRS) — a Node 22 Lambda backed by Neon Postgres. Reference implementation for scaledaiops.org; reusable by any site via one `<script>` tag (widget) and a handful of env vars (API). Plan and rationale: `scaledaiops.org/docs/ffrs-plan.md`.

## Routes

| Route | Purpose |
|---|---|
| `POST /api/feedback` | Capture. Validates (Zod) → guards (rate limit, honeypot, Turnstile) → durable insert + queued side effects → `202 {ref}`. Idempotent on `Idempotency-Key`. |
| `GET /api/feedback/:ref` | Public status timeline (never body/email/screenshot). |
| EventBridge (1 min) | Drains the `side_effects` outbox with backoff (1m→6h, then parked). |

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

## Develop

```bash
npm install
npm run check          # typecheck + vitest + esbuild + zip → dist/handler.zip (what Terraform deploys)
DATABASE_URL=… npm run db:migrate   # applies drizzle/*.sql incl. the ffrs_metrics view
```

Tests use `memoryRepo` — no database needed. `neonRepo` is the production `FeedbackRepo`; both satisfy the same interface (`src/domain/repo.ts`).

## Layout

```
src/handler.ts      Lambda entry: wires config → repo/blobs/guards → app; schedule → outbox
src/app.ts          HTTP routing + guards, framework-free
src/domain/         capture() (FFRS stage 1), Zod input schema, ref generator, repo interfaces
src/db/             drizzle schema, neonRepo, memoryRepo, s3Blobs
src/guards/         honeypot, rateLimit, turnstile
src/effects/        Effect plug-in type (implementations land in Phase 3)
src/outbox.ts       claim → run → complete / fail-with-backoff
drizzle/            migrations (0000 schema, 0001 ffrs_metrics view)
```
