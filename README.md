# ffrs-api

Capture API of the **Fast Feedback Resolution System** (FFRS), run by ScaledAIOps as one service
for many sites. Dependency-minimal by design: **GitHub Issues is the system of record**, one Node 22
Lambda routes to it, and a private S3 prefix holds the only personal data (a per-item sidecar with
the submitter's email). No database.

**Live at `https://ffrs.scaledaiops.org`** — a Lambda Function URL behind CloudFront. Every site is a
**tenant**: its own tracker repo and token, allowed origins, branding and options, configured in
SSM and picked up within five minutes, no deploy. Infrastructure: `aiops-tf-infra`, module `ffrs`.
Plan and rationale: `docs/independent-service.md`.

## Embed on any page

```html
<script src="https://ffrs.scaledaiops.org/widget.js" data-site="<slug>" defer></script>
```

One tag attaches the feedback tab; removing it detaches it. `data-site` names the tenant, and the
page's origin must be on that tenant's list — a copied slug on another host gets a 403. Optional:
`data-label`, `data-position="left"`, `data-privacy="/privacy/"` (linked beside the consent box);
`rkFeedback.open()` / `.detach()` for programmatic control.
The widget renders in a Shadow DOM with a constructed stylesheet, so host CSS can't reach it and a
strict host CSP needs only `script-src` + `connect-src` for `ffrs.scaledaiops.org`.

The original scaledaiops.org widget (`assets/js/ffrs-widget.js` in the site repo) still posts to
`/api/feedback` with no `site` and is served by the **default tenant** — unchanged for the paper's
measurement period.

## Tenants

```bash
scripts/tenant.sh add <slug>       # prompts for each field, validates the token, assigns the pseudonym, prints the tag
scripts/tenant.sh show|enable|disable|remove <slug>
```

| Field (SSM `/ffrs/tenants/<slug>/…`) | Required | Notes |
|---|---|---|
| `name`, `site_url`, `origins` | yes | Branding, status links, and every host allowed to embed. `https://*.example.com` covers every subdomain but not the bare domain, which is listed on its own |
| `tracker_repo`, `github_token` (secret) | yes | Issues read/write on that one repo, created by the tenant |
| `research` | yes | Opt-in to the anonymised export |
| `pseudonym` | set by operator | `S1`, `S2`… — the only tenant identifier that reaches the paper |
| `feedback_page` | no | The tenant's own status page + no-JS form; default is the central `https://ffrs.scaledaiops.org/status/` |
| `webhook_secret` (secret) | for closing emails | Add a repo webhook → `https://ffrs.scaledaiops.org/api/webhooks/github`, JSON, events Issues + Issue comments, this secret |
| `alert_email`, `turnstile_secret`, `agent_target_repo`, `rate_limit_per_min` | no | |
| `brand` | no | `#rrggbb` accent for the central status page |
| `enabled` | yes | Per-tenant kill switch; `/ffrs/enabled` stops everything |

A request names its tenant with `site` (the widget's `data-site`); with no `site`, the page's
Origin decides, and with neither, the default tenant serves it.

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
| `POST /api/feedback` | Resolve tenant → validate (Zod) → guards (per-tenant rate limit, honeypot, Turnstile) → screenshot to S3 (`screenshots/<tenant>/…`, presigned 7-day link in the issue) → **create issue** in the tenant's repo → ack + alert email (best-effort) → sidecar → `202 {ref, statusUrl}`. Idempotent on `Idempotency-Key`. GitHub down ⇒ `502 route_failed`. Form-encoded → 303 to the tenant's `feedback_page`. |
| `GET /api/feedback/:ref` | Public timeline from GitHub + sidecar (timestamps only, never email/body). Refs are global; the sidecar knows its tenant. |
| `GET /status/?ref=` | The central status page, rendered on the server (no JavaScript), branded for the item's tenant. Default `feedback_page` for tenants without their own; also takes `?sent=1` / `?error=` from the no-JS form. |
| `POST /api/webhooks/github` | Tenant = the repository in the payload; HMAC-verified with that tenant's `webhook_secret`. `issues.closed` → closing email once; `reopened` re-arms; agent-comment footers stripped. |
| EventBridge weekly (`{job:"weekly_report"}`) | Per tenant: metrics per kind × ISO week filed as an issue labelled `ffrs-report`. Across opted-in tenants: `research/<week>.csv` in the data bucket — pseudonym, kind, severity, timestamps, outcome, agent path; no text, contact, IP or link. |

## Agentic Respond stage (Phase 8)

`agent/run.mjs` + `agent/workflows/ffrs-agent.yml` run a headless coding-agent CLI (`AGENT_CMD`) from GitHub Actions in the tracker repo: open a PR on the target repo (code/content path) or post a proposal with the `/accept` · `/confirm` · `/reject` protocol; `/confirm` by a maintainer executes. Metrics distinguish TTFR (any first response, agent included), TTHR (first human) and agent share (labels `agent:*`). See `agent/README.md`. Per tenant, `agent_target_repo` says where PRs may go; absent means no agent.

## Env (service-wide)

| Var | Notes |
|---|---|
| `DATA_BUCKET` | private S3 bucket: `sidecar/`, `idem/`, `screenshots/<tenant>/`, `research/` |
| `SSM_PREFIX` | `/ffrs` — tenants under `<prefix>/tenants/`, kill switch at `<prefix>/enabled` (cached 60 s) |
| `DEFAULT_TENANT` | slug served when a request names no site |
| `FROM_EMAIL` | SES sender; absent disables every email |
| `TENANT_TTL_S` | tenant refresh interval, default 300 |
| `SERVICE_URL` | the service host, for the central status page links |

## Develop and deploy

```bash
npm install
npm run check        # typecheck + vitest (in-memory Tracker/Store, no network) + esbuild + zip → dist/handler.zip
scripts/deploy.sh    # check, terraform apply (aiops-tf-infra, enable_ffrs=true), publish widget.js
GITHUB_TOKEN=… GITHUB_REPO=Scaled-AIOps/feedback npm run metrics > metrics.csv   # one tenant's metrics straight from GitHub
GITHUB_TOKEN=… GITHUB_REPO=Scaled-AIOps/feedback npm run export  > feedback.csv  # anonymised rows
```

## Layout

```
src/handler.ts        Lambda entry: config → tenant registry (SSM, TTL) → per-tenant runtimes → app; job dispatch
src/tenants.ts        Tenant schema, SSM loader, registry (by slug / origin / repo)
src/app.ts            HTTP routing: tenant resolution, origin rule, guards
src/statusPage.ts     the central /status/ page (server-rendered, hash-pinned CSP)
src/domain/           ports (Tracker, Store), capture(), status view, metrics + research rows, webhook, schema, ref
src/adapters/         githubTracker (REST), s3Store, memory twins for tests
src/effects/          templates (ack, alert, close, issue body), SES mailer
src/guards/           honeypot, rateLimit, turnstile
widget/widget.js      the embeddable tab, served at /widget.js
scripts/              tenant.sh, deploy.sh, export.ts
```
