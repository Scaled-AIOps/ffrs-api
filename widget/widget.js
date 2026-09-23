// FFRS feedback widget. Attach to any page with one tag; remove the tag to detach:
//   <script src="https://ffrs.scaledaiops.org/widget.js" data-site="example" defer></script>
// data-site names the tenant; the page's origin must be on that tenant's list. Optional:
// data-label="Feedback", data-position="right|left", data-privacy="/privacy/" (linked beside the
// consent box).
// Renders in a Shadow DOM with a constructed stylesheet, so host CSS can't reach it and a strict
// host CSP only needs script-src + connect-src for this host (no inline styles).
(() => {
  if (window.rkFeedback) return; // loaded twice — keep the first
  const tag = document.currentScript;
  const API = new URL('/api/feedback', tag.src).href;
  const site = tag.dataset.site;
  if (!site) { console.error('ffrs widget: data-site is required'); return; }
  const label = tag.dataset.label || 'Feedback';
  const side = tag.dataset.position === 'left' ? 'left' : 'right';
  const privacy = tag.dataset.privacy;

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .tab { position: fixed; ${side}: 0; top: 50%; transform: translateY(-50%); z-index: 2147483000;
      writing-mode: vertical-rl; padding: 14px 8px; border: 0; cursor: pointer;
      border-radius: ${side === 'right' ? '10px 0 0 10px' : '0 10px 10px 0'};
      background: #0f2a4d; color: #fff; font-size: 12px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
    .tab:hover, .tab:focus-visible { background: #2f9bf5; }
    .veil { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 16px; background: rgba(5,17,34,.55); }
    .veil[hidden] { display: none; }
    .modal { width: 100%; max-width: 400px; max-height: 100%; overflow: auto; background: #fff; color: #0b1b30; border-radius: 14px; }
    .bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #e4e9f1; }
    h2 { margin: 0; font-size: 16px; color: #0f2a4d; }
    .x { border: 0; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: #56677e; }
    form { display: grid; gap: 10px; padding: 16px 18px 18px; }
    label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: #0f2a4d; }
    .check { display: flex; gap: 8px; align-items: center; font-weight: 400; color: #56677e; }
    .privacy { margin: -4px 0 0; font-size: 12px; color: #56677e; }
    input, select, textarea { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #e4e9f1; border-radius: 8px; color: #0b1b30; background: #fff; }
    input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #2f9bf5; outline-offset: 1px; }
    .hp { position: absolute; left: -9999px; width: 1px; height: 1px; }
    .send { justify-self: start; padding: 10px 18px; border: 0; border-radius: 8px; background: #0f2a4d; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
    .send:disabled { opacity: .6; cursor: default; }
    .msg { margin: 0; font-size: 13px; min-height: 1em; }
    .msg.ok { color: #067647; } .msg.err { color: #b42318; }
    a { color: #2f9bf5; }
    [hidden] { display: none !important; }`;

  const host = document.createElement('div');
  host.setAttribute('data-ffrs', site);
  const root = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `
    <button class="tab" type="button" aria-haspopup="dialog">${label}</button>
    <div class="veil" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ffrs-title">
        <div class="bar"><h2 id="ffrs-title">Send feedback</h2><button class="x" type="button" aria-label="Close">&times;</button></div>
        <form novalidate>
          <label>What is it?
            <select name="kind">
              <option value="feature">An idea or request</option>
              <option value="bug">Something is broken</option>
              <option value="contact">A question</option>
            </select>
          </label>
          <label class="sev" hidden>How bad is it?
            <select name="severity">
              <option value="low">Minor</option>
              <option value="medium" selected>Annoying</option>
              <option value="high">Blocks me</option>
              <option value="critical">Everything is down</option>
            </select>
          </label>
          <label>Title <input name="title" required minlength="3" maxlength="140"></label>
          <label>Details <textarea name="body" required minlength="10" maxlength="5000" rows="4"></textarea></label>
          <label>Email <input name="email" type="email" maxlength="254" placeholder="optional"></label>
          <label class="check"><input type="checkbox" name="consent"> You may contact me about this</label>
          <p class="privacy" hidden>How we use this: <a target="_blank" rel="noopener">privacy</a>.</p>
          <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="send" type="submit">Send</button>
          <p class="msg" role="status" aria-live="polite"></p>
        </form>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  if (privacy) { $('.privacy a').href = new URL(privacy, location.href).href; $('.privacy').hidden = false; }
  const veil = $('.veil');
  const form = $('form');
  const msg = $('.msg');
  const send = $('.send');
  let key; // one Idempotency-Key per draft, so a retried submit can't file twice

  const say = (text, cls) => { msg.className = `msg ${cls || ''}`; msg.textContent = text; };
  const open = () => { veil.hidden = false; key ??= crypto.randomUUID(); form.title.focus(); };
  const close = () => { veil.hidden = true; };
  const syncSeverity = () => { $('.sev').hidden = form.kind.value !== 'bug'; };

  $('.tab').addEventListener('click', open);
  $('.x').addEventListener('click', close);
  veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  form.kind.addEventListener('change', syncSeverity);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const f = form.elements;
    const email = f.email.value.trim();
    if (f.consent.checked && !email) return say('Add an email so we can contact you.', 'err');
    const payload = {
      site, kind: f.kind.value, title: f.title.value.trim(), body: f.body.value.trim(),
      pageUrl: location.href.slice(0, 2000), consent: f.consent.checked,
      ...(f.kind.value === 'bug' ? { severity: f.severity.value } : {}),
      ...(email ? { email } : {}),
      ...(f.website.value ? { website: f.website.value } : {}),
    };
    send.disabled = true;
    say('Sending…');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ref) {
        const detail = d.error?.details?.map((x) => x.message).join('; ') || d.error?.message;
        return say(res.status === 429 ? 'Too many submissions — try again in a minute.' : `Not sent — ${detail || 'please try again'}.`, 'err');
      }
      form.reset();
      syncSeverity();
      key = crypto.randomUUID();
      msg.className = 'msg ok';
      msg.textContent = `Thanks — reference ${d.ref}. `;
      if (d.statusUrl) {
        const link = document.createElement('a');
        link.href = d.statusUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Check its status';
        msg.append(link);
      }
    } catch {
      say('Could not reach the server — check your connection.', 'err');
    } finally {
      send.disabled = false;
    }
  });

  document.body.append(host);
  // Programmatic control, e.g. a "Report a problem" link: rkFeedback.open(). detach() removes it.
  window.rkFeedback = { open, close, detach: () => { host.remove(); delete window.rkFeedback; } };
})();
