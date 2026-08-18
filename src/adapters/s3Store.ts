import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Sidecar, Store } from '../domain/ports.js';

const SidecarSchema = z.object({
  ref: z.string(), issueNumber: z.number(), issueUrl: z.string(), kind: z.enum(['bug', 'feature', 'contact']), title: z.string(),
  createdAt: z.string(), email: z.string().nullable(), consent: z.boolean(), screenshotKey: z.string().nullable(),
  acknowledgedAt: z.string().nullable(), closeEmailAt: z.string().nullable(),
});

/** Private S3 prefix: `sidecar/<ref>.json`, `idem/<sha256(key)>`, `screenshots/…`. Bucket is private, encrypted, expiring. */
export function s3Store(bucket: string): Store {
  let client: import('@aws-sdk/client-s3').S3Client | undefined;
  const sdk = async () => { const m = await import('@aws-sdk/client-s3'); client ??= new m.S3Client({}); return { ...m, client }; };
  const getText = async (key: string): Promise<string | undefined> => {
    const { client, GetObjectCommand } = await sdk();
    try { return await (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body?.transformToString(); }
    catch (err) { if ((err as { name?: string }).name === 'NoSuchKey') return undefined; throw err; }
  };
  const putText = async (key: string, body: string, contentType: string) => {
    const { client, PutObjectCommand } = await sdk();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  };
  return {
    async getSidecar(ref) { const t = await getText(`sidecar/${ref}.json`); return t ? SidecarSchema.parse(JSON.parse(t)) : undefined; },
    async putSidecar(s: Sidecar) { await putText(`sidecar/${s.ref}.json`, JSON.stringify(s), 'application/json'); },
    async getIdem(key) { return getText(`idem/${createHash('sha256').update(key).digest('hex')}`); },
    async putIdem(key, ref) { await putText(`idem/${createHash('sha256').update(key).digest('hex')}`, ref, 'text/plain'); },
    async putBlob(key, bytes, contentType) {
      const { client, PutObjectCommand } = await sdk();
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async blobUrl(key, ttlSeconds) {
      const { client, GetObjectCommand } = await sdk();
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSeconds });
    },
  };
}
