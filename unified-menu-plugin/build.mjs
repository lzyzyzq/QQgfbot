import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'fs';

mkdirSync('dist', { recursive: true });
rmSync('dist/webui', { recursive: true, force: true });
cpSync('src/webui', 'dist/webui', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  legalComments: 'none',
});

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  legalComments: 'none',
});

console.log('build ok: dist/index.mjs + dist/index.cjs + dist/webui/');
