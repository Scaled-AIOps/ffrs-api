import { createHash } from 'node:crypto';
import type { StatusView } from './domain/status.js';
import type { Res } from './http.js';
import type { Tenant } from './tenants.js';

/**
 * The central status page, `/status/?ref=…`, for tenants that don't host their own. Rendered on
 * the server, so it needs no JavaScript: a lookup form, the item's timeline, and the tenant's name
 * and colour. Every interpolated value is escaped; the only inline style is pinned by its hash.
 */
const STATUS: Record<StatusView['status'], string> = { routed: 'Received', responded: 'In progress', closed: 'Closed' };
// Only shown once closed — "Closed" alone reads as fixed, even when the answer was "not planned".
const OUTCOME: Record<string, string> = {
  fixed: 'Fixed', shipped: 'Shipped', answered: 'Answered', declined: 'Not planned', wontfix: 'Won’t fix', duplicate: 'Duplicate of another report',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

export interface StatusPageInput {
  tenant: Tenant | undefined;   // unknown until a ref resolves; the page then renders unbranded
  ref: string | undefined;
  view: StatusView | undefined;
  sent: boolean;                // the no-JS form redirected here after a successful submit
  error: string | undefined;    // … or with the validation message
}

export function statusPage({ tenant, ref, view, sent, error }: StatusPageInput): Res {
  const accent = tenant?.brand ?? '#0f2a4d';
  const style = `:root{--a:${accent}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0b1b30;background:#f4f6fa}main{width:100%;max-width:28rem;background:#fff;border:1px solid #e4e9f1;border-radius:14px;padding:28px}h1{margin:0 0 6px;font-size:1.25rem;color:var(--a)}p{margin:0 0 16px;color:#56677e}form{display:flex;gap:8px}input{flex:1;padding:9px 11px;font:inherit;border:1px solid #e4e9f1;border-radius:8px}button{padding:9px 16px;font:inherit;font-weight:600;border:0;border-radius:8px;background:var(--a);color:#fff;cursor:pointer}dl{margin:20px 0 0;padding:16px;border-radius:10px;background:#f4f6fa}dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#56677e}dd{margin:0 0 10px;font-weight:600}dd:last-child{margin:0}.ok,.err{padding:10px 12px;border-radius:8px}.ok{background:#e7f6ec;color:#067647}.err{background:#fdecea;color:#b42318}a{color:var(--a)}footer{margin-top:22px;font-size:.85rem;color:#56677e}`;
  const csp = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

  const row = (t: string, v: string | null) => (v ? `<dt>${t}</dt><dd>${esc(v)}</dd>` : '');
  const result = !ref ? '' : view
    ? `<dl>${row('Reference', view.ref)}${row('Status', STATUS[view.status])}${view.outcome ? row('Outcome', OUTCOME[view.outcome] ?? view.outcome) : ''}${row('Received', day(view.createdAt))}${row('First response', day(view.respondedAt))}${row('Closed', day(view.closedAt))}</dl>`
    : `<p class="err">No feedback found for ${esc(ref)}.</p>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Feedback status${tenant ? ` — ${esc(tenant.name)}` : ''}</title><style>${style}</style></head><body><main>
<h1>${tenant ? `${esc(tenant.name)} feedback` : 'Feedback status'}</h1>
${sent && ref ? `<p class="ok">Thanks — it’s logged. Keep your reference, ${esc(ref)}, to check back here.</p>` : ''}
${error ? `<p class="err">Not sent — ${esc(error)}. Please go back and try again.</p>` : ''}
<p>Enter the reference you were given to see where it stands.</p>
<form method="get" action="/status/"><input name="ref" value="${esc(ref ?? '')}" placeholder="FB-XXXXXX" required pattern="FB-[A-Za-z0-9]{6}" aria-label="Reference"><button type="submit">Look up</button></form>
${result}
<footer>${tenant ? `<a href="${esc(tenant.siteUrl)}">Back to ${esc(tenant.name)}</a> · ` : ''}Fast Feedback Resolution System</footer>
</main></body></html>`;

  return {
    statusCode: ref && !view ? 404 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
    body: html,
  };
}
