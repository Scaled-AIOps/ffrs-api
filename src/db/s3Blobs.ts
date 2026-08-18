import type { BlobStore } from '../domain/repo.js';

export function s3Blobs(bucket: string): BlobStore {
  let client: import('@aws-sdk/client-s3').S3Client | undefined;
  return {
    async put(key, bytes, contentType) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      client ??= new S3Client({});
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async url(key, ttlSeconds) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      client ??= new S3Client({});
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSeconds });
    },
  };
}
