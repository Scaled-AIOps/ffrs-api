# FFRS as an independent service

One FFRS, run by ScaledAIOps at `ffrs.scaledaiops.org`, used by many sites. Each site is a
**tenant**: the service owns the capture pipeline and the research dataset; each tenant owns its
feedback. Tenants other than scaledaiops.org are not named here — in the paper they appear only
as pseudonyms (`S2`, `S3`, …).

## Decisions (2026-09-23)

| # | Decision | Why |
|---|---|---|
| D1 | **One codebase: this repo.** Earlier per-site forks were merged in and retired | Two codebases is how sites stop being comparable in the paper |
| D2 | **One deployment** in the `scaledaiops` AWS account (`eu-central-1`): a Lambda Function URL behind CloudFront at `ffrs.scaledaiops.org`, from `aiops-tf-infra` module `ffrs` | One account, one bill, one kill switch. No API Gateway, the only per-request cost the design had |
| D3 | **One tracker repo per tenant**, in the tenant's own GitHub org, with a token scoped to that repo | A commercial site's feedback is its own data; a shared public tracker would leak it. Per-tenant repos are also what the agent needs to open PRs against that site |
| D4 | **Research data is item-level, anonymised and opt-in per tenant** — pseudonym, kind, severity, timestamps, outcome, agent path; never text, contact, IP or link | Metrics are recomputed from rows, so a result can be reproduced and re-cut for a reviewer. Opt-in lets a tenant stay out cleanly |
| D5 | **The widget tag names its tenant** (`data-site`), and the page's origin must be on that tenant's list; `https://*.example.com` covers subdomains | A copied slug on a foreign host gets a 403 |
| D6 | **A central status page**, `ffrs.scaledaiops.org/status/?ref=`, rendered on the server and branded per tenant; a tenant may host its own instead (`feedback_page`) | New sites need to ship nothing to adopt the widget |
| D7 | **Email from `feedback@scaledaiops.org`**, the tenant's name in the subject | One SES identity, already out of the sandbox |

## Onboarding a tenant

A tenant is a folder of SSM parameters, `/ffrs/tenants/<slug>/`, plus one tag on the site. Nothing
is deployed; the service re-reads tenants every five minutes. Fields are listed in the README.

1. The tenant creates a private tracker repo in its own org, and a fine-grained token with
   **Issues read and write on that one repo**. The token goes straight into SSM or over a
   one-time channel — never by email or chat.
2. The operator runs `scripts/tenant.sh add <slug>`: it prompts for each field, checks the token
   against the repo, assigns the next pseudonym and prints the tag.
3. The tenant adds the tag to its pages, allows `ffrs.scaledaiops.org` in its CSP
   (`script-src`, `connect-src`, and `form-action` if it hosts the no-JS form), and names the
   research use in its privacy notice if `research` is on (and passes `data-privacy` so the widget
   links it). For closing emails, it adds the repo webhook with the tenant's `webhook_secret`.
4. The operator submits one test item from the site, sees the issue land, closes it, and checks
   the status page shows it closed.

`scripts/tenant.sh show|enable|disable|remove <slug>` covers the rest. Removing deletes the
parameters and the tenant's screenshots; the tracker repo and its issues stay with the tenant.

## The paper

- Each tenant's privacy notice names the research use; exports carry no text, contact or IP;
  tenants appear only as pseudonyms, and the slug↔pseudonym mapping lives only in SSM. A tenant
  can opt out and its rows are dropped from later exports.
- Exported CSVs (`research/<week>.csv`) are versioned in `ffrs-paper/data/`, so a result can be
  reproduced from the file it was computed from.
- With *n* sites on one instrument, threats to validity shrink — same code, same metrics, same
  clock — and the evaluation gains cross-site comparison (agent share, TTFR with and without it).

## Cost

One Lambda, one CloudFront distribution, two buckets, SES per email. Per tenant the marginal cost
is SSM parameters (free) and the tenant's own GitHub token.
