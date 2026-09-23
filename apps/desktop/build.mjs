import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const node = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  conditions: ['development'], // bundle workspace packages from src/*.ts
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};
await mkdir('dist', { recursive: true });
await build({
  ...node,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main.mjs',
  format: 'esm',
  // CommonJS dependencies inside an ESM bundle need a real require for node builtins. The import is aliased because
  // bundled ESM (fflate) imports `createRequire` too and esbuild doesn't rename around banner text.
  banner: {
    js: "import { createRequire as __flCreateRequire } from 'node:module'; const require = __flCreateRequire(import.meta.url);",
  },
});
await build({
  ...node,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
  format: 'cjs',
});
await build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  entryPoints: ['src/renderer/renderer.ts'],
  outfile: 'dist/renderer.js',
  sourcemap: true,
  logLevel: 'info',
});
await cp('src/renderer/index.html', 'dist/index.html');
await cp('src/renderer/styles.css', 'dist/styles.css');
