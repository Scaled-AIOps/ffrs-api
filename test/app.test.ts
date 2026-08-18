import { describe, expect, it } from 'vitest';
import { body, evt, testApp, validBug, validFeature } from './helpers.js';

describe('POST /api/feedback', () => {
  it('files a GitHub issue, keeps email only in the sidecar, sends ack + alert, returns 202 with a ref', async () => {
    const { app, tracker, store, sent } = testApp();
    const res = await app(evt('POST', '/api/feedback', validBug));
    expect(res.statusCode).toBe(202);
    const { ref } = body(res);
    expect(ref).toMatch(/^FB-/);
    const issue = tracker.issues[0]!;
    expect(issue.labels).toEqual(['ffrs', 'kind:bug', 'severity:medium']);
    expect(issue.body).toContain(`<!-- ffrs:${ref} -->`);
    expect(issue.body).not.toContain('v@example.org');
    const s = store.sidecars.get(ref)!;
    expect(s).toMatchObject({ email: 'v@example.org', consent: true, issueNumber: 1 });
    expect(s.acknowledgedAt).not.toBeNull();
    expect(sent.map((m) => m.to)).toEqual(['v@example.org', 'team@example.org']);
    expect(sent[0]!.subject).toBe(`[${ref}] We received your bug report`);
  });
  it('GET exposes only the timeline (routed → responded → closed)', async () => {
    const { app, tracker } = testApp();
    const { ref } = body(await app(evt('POST', '/api/feedback', validBug)));
    let g = body(await app(evt('GET', `/api/feedback/${ref}`)));
    expect(g).toMatchObject({ ref, kind: 'bug', status: 'routed', outcome: null, respondedAt: null, closedAt: null });
    expect(g).not.toHaveProperty('email');
    const t1 = new Date('2026-08-19T09:00:00Z');
    tracker.comment(1, t1);
    g = body(await app(evt('GET', `/api/feedback/${ref}`)));
    expect(g).toMatchObject({ status: 'responded', respondedAt: t1.toISOString() });
    tracker.close(1, new Date('2026-08-20T09:00:00Z'), 'not_planned');
    g = body(await app(evt('GET', `/api/feedback/${ref}`)));
    expect(g).toMatchObject({ status: 'closed', outcome: 'declined' });
    expect((await app(evt('GET', '/api/feedback/FB-ZZZZZZ'))).statusCode).toBe(404);
  });
  it('drops the email and sends no ack without consent', async () => {
    const { app, store, sent } = testApp();
    const { ref } = body(await app(evt('POST', '/api/feedback', { ...validBug, consent: false })));
    expect(store.sidecars.get(ref)!.email).toBeNull();
    expect(sent.map((m) => m.to)).toEqual(['team@example.org']);
  });
  it('is idempotent on Idempotency-Key', async () => {
    const { app, tracker } = testApp();
    const h = { 'idempotency-key': 'k1' };
    const a = await app(evt('POST', '/api/feedback', validFeature, h));
    const b = await app(evt('POST', '/api/feedback', validFeature, h));
    expect([a.statusCode, b.statusCode]).toEqual([202, 200]);
    expect(body(a).ref).toBe(body(b).ref);
    expect(tracker.issues).toHaveLength(1);
  });
  it('502 route_failed when GitHub is down; nothing half-stored', async () => {
    const base = testApp();
    const { app, store } = testApp({ tracker: { ...base.tracker, createIssue: async () => { throw new Error('gh 503'); } } });
    const r = await app(evt('POST', '/api/feedback', validFeature, { 'idempotency-key': 'k2' }));
    expect(r.statusCode).toBe(502);
    expect(body(r).error.code).toBe('route_failed');
    expect(store.sidecars.size).toBe(0);
    expect(await store.getIdem('k2')).toBeUndefined();
  });
  it('mail outage does not lose feedback', async () => {
    const { app, tracker, store } = testApp({ mailer: async () => { throw new Error('ses down'); } });
    const r = await app(evt('POST', '/api/feedback', validBug));
    expect(r.statusCode).toBe(202);
    expect(tracker.issues).toHaveLength(1);
    expect(store.sidecars.get(body(r).ref)!.acknowledgedAt).toBeNull();
  });
  it('400s invalid input with field paths, 400s bad JSON', async () => {
    const { app } = testApp();
    const r = await app(evt('POST', '/api/feedback', { kind: 'bug', title: 'x', body: 'short' }));
    expect(r.statusCode).toBe(400);
    expect(body(r).error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['title', 'body', 'severity']));
    expect(body(await app({ ...evt('POST', '/api/feedback'), body: '{nope' })).error.code).toBe('invalid_json');
  });
  it('honeypot → fake 202, nothing filed', async () => {
    const { app, tracker } = testApp();
    expect((await app(evt('POST', '/api/feedback', { ...validFeature, website: 'http://spam' }))).statusCode).toBe(202);
    expect(tracker.issues).toHaveLength(0);
  });
  it('rate limits per ip', async () => {
    const { app } = testApp();
    for (let i = 0; i < 5; i++) expect((await app(evt('POST', '/api/feedback', validFeature))).statusCode).toBe(202);
    expect((await app(evt('POST', '/api/feedback', validFeature))).statusCode).toBe(429);
    expect((await app(evt('POST', '/api/feedback', validFeature, {}, '198.51.100.1'))).statusCode).toBe(202);
  });
  it('turnstile: required and verified when configured', async () => {
    const { app } = testApp({ turnstile: async (t) => t === 'good' });
    expect(body(await app(evt('POST', '/api/feedback', validFeature))).error.code).toBe('turnstile_required');
    expect((await app(evt('POST', '/api/feedback', { ...validFeature, turnstileToken: 'bad' }))).statusCode).toBe(403);
    expect((await app(evt('POST', '/api/feedback', { ...validFeature, turnstileToken: 'good' }))).statusCode).toBe(202);
  });
  it('kill switch → 503 ffrs_disabled', async () => {
    const { app } = testApp({ isEnabled: async () => false });
    expect(body(await app(evt('POST', '/api/feedback', validFeature))).error.code).toBe('ffrs_disabled');
  });
  it('screenshot stored privately and linked in the issue via presigned url', async () => {
    const { app, tracker, store } = testApp();
    const shot = 'data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64');
    const { ref } = body(await app(evt('POST', '/api/feedback', { ...validBug, screenshot: shot })));
    const key = store.sidecars.get(ref)!.screenshotKey!;
    expect(key).toMatch(/^screenshots\/\d{4}-\d{2}-\d{2}\/FB-[A-Z0-9]{6}\.jpg$/);
    expect(store.blobs.has(key)).toBe(true);
    expect(tracker.issues[0]!.body).toContain(`![screenshot](https://s3.example/${key}?ttl=604800)`);
  });
  it('form-encoded (no-JS) → 303 back to /feedback/', async () => {
    const { app } = testApp();
    const h = { 'content-type': 'application/x-www-form-urlencoded' };
    const ok = await app({ ...evt('POST', '/api/feedback', undefined, h), body: 'kind=feature&title=Add+RSS&body=A+feed+of+framework+changes+please&email=&consent=' });
    expect(ok.statusCode).toBe(303);
    expect(String(ok.headers?.['location'])).toMatch(/^https:\/\/www\.scaledaiops\.org\/feedback\/\?sent=1&ref=FB-[A-Z0-9]{6}$/);
    const bad = await app({ ...evt('POST', '/api/feedback', undefined, h), body: 'kind=bug&title=x&body=short' });
    expect(decodeURIComponent(String(bad.headers?.['location']))).toContain('?error=title:');
  });
  it('CORS only for allowed origins; 404 for unknown routes', async () => {
    const { app } = testApp();
    expect((await app(evt('OPTIONS', '/api/feedback', undefined, { origin: 'https://embedder.example' }))).headers?.['access-control-allow-origin']).toBe('https://embedder.example');
    expect((await app(evt('OPTIONS', '/api/feedback', undefined, { origin: 'https://evil.example' }))).headers?.['access-control-allow-origin']).toBeUndefined();
    expect((await app(evt('GET', '/api/nope'))).statusCode).toBe(404);
  });
});
