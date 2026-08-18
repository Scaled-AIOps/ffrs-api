import { describe, expect, it } from 'vitest';
import { evt, testApp, validBug, validFeature } from './helpers.js';

const body = (r: { body?: string | undefined }) => JSON.parse(r.body ?? '{}');

describe('POST /api/feedback', () => {
  it('captures and returns 202 with a ref; GET exposes only the timeline', async () => {
    const { app, repo } = testApp();
    const res = await app(evt('POST', '/api/feedback', validBug));
    expect(res.statusCode).toBe(202);
    const { ref } = body(res);
    expect(ref).toMatch(/^FB-/);
    expect(repo.rows[0]!.email).toBe('v@example.org');

    const get = await app(evt('GET', `/api/feedback/${ref}`));
    expect(get.statusCode).toBe(200);
    expect(body(get)).toMatchObject({ ref, kind: 'bug', status: 'new' });
    expect(body(get)).not.toHaveProperty('body');
    expect(body(get)).not.toHaveProperty('email');
  });
  it('drops the email when there is no consent', async () => {
    const { app, repo } = testApp();
    await app(evt('POST', '/api/feedback', { ...validBug, consent: false }));
    expect(repo.rows[0]!.email).toBeNull();
  });
  it('is idempotent on Idempotency-Key', async () => {
    const { app, repo } = testApp();
    const h = { 'idempotency-key': 'k1' };
    const a = await app(evt('POST', '/api/feedback', validFeature, h));
    const b = await app(evt('POST', '/api/feedback', validFeature, h));
    expect([a.statusCode, b.statusCode]).toEqual([202, 200]);
    expect(body(a).ref).toBe(body(b).ref);
    expect(repo.rows).toHaveLength(1);
  });
  it('400s invalid input with field paths, 400s bad JSON', async () => {
    const { app } = testApp();
    const r = await app(evt('POST', '/api/feedback', { kind: 'bug', title: 'x', body: 'short' }));
    expect(r.statusCode).toBe(400);
    expect(body(r).error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['title', 'body', 'severity']));
    const j = await app({ ...evt('POST', '/api/feedback'), body: '{nope' });
    expect(body(j).error.code).toBe('invalid_json');
  });
  it('honeypot → fake 202, nothing stored', async () => {
    const { app, repo } = testApp();
    const r = await app(evt('POST', '/api/feedback', { ...validFeature, website: 'http://spam' }));
    expect(r.statusCode).toBe(202);
    expect(repo.rows).toHaveLength(0);
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
    const r = await app(evt('POST', '/api/feedback', validFeature));
    expect(r.statusCode).toBe(503);
    expect(body(r).error.code).toBe('ffrs_disabled');
  });
  it('screenshots: rejected without a blob store, stored with one', async () => {
    const shot = 'data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64');
    const none = testApp();
    expect(body(await none.app(evt('POST', '/api/feedback', { ...validBug, screenshot: shot }))).error.code).toBe('screenshots_disabled');
    const puts: string[] = [];
    const withBlobs = testApp({ blobs: { put: async (k) => { puts.push(k); }, url: async (k) => `https://s3/${k}` } });
    const r = await withBlobs.app(evt('POST', '/api/feedback', { ...validBug, screenshot: shot }));
    expect(r.statusCode).toBe(202);
    expect(puts[0]).toMatch(/^\d{4}-\d{2}-\d{2}\/FB-[A-Z0-9]{6}\.jpg$/);
    expect(withBlobs.repo.rows[0]!.screenshotKey).toBe(puts[0]);
  });
  it('CORS only for allowed origins; 404 for unknown routes', async () => {
    const { app } = testApp();
    const ok = await app(evt('OPTIONS', '/api/feedback', undefined, { origin: 'https://embedder.example' }));
    expect(ok.headers?.['access-control-allow-origin']).toBe('https://embedder.example');
    const no = await app(evt('OPTIONS', '/api/feedback', undefined, { origin: 'https://evil.example' }));
    expect(no.headers?.['access-control-allow-origin']).toBeUndefined();
    expect((await app(evt('GET', '/api/nope'))).statusCode).toBe(404);
  });
});

describe('POST /api/feedback (form, no-JS)', () => {
  it('redirects to /feedback/?sent=1&ref=… on success and ?error= on validation failure', async () => {
    const { app, repo } = testApp();
    const form = 'kind=feature&title=Add+RSS&body=A+feed+of+framework+changes+please&email=&consent=&website=';
    const ok = await app({ ...evt('POST', '/api/feedback', undefined, { 'content-type': 'application/x-www-form-urlencoded' }), body: form });
    expect(ok.statusCode).toBe(303);
    expect(String(ok.headers?.['location'])).toMatch(/^https:\/\/www\.scaledaiops\.org\/feedback\/\?sent=1&ref=FB-[A-Z0-9]{6}$/);
    expect(repo.rows[0]!.email).toBeNull();
    const bad = await app({ ...evt('POST', '/api/feedback', undefined, { 'content-type': 'application/x-www-form-urlencoded' }), body: 'kind=bug&title=x&body=short' });
    expect(bad.statusCode).toBe(303);
    expect(decodeURIComponent(String(bad.headers?.['location'] ?? ''))).toContain('?error=title:');
  });
});
