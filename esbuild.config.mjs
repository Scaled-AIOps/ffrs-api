import { build } from 'esbuild';

// AWS SDK v3 ships in the Node 22 Lambda runtime — keep it external to shrink the bundle.
await build({
  entryPoints: ['src/handler.ts'],
  outfile: 'dist/handler.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: true,
  external: ['@aws-sdk/client-*'], // presigner + smithy get bundled
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
});
