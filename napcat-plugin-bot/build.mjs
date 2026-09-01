import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  packages: 'external',
  outfile: 'dist/index.mjs',
  sourcemap: 'inline',
  logLevel: 'info',
});

console.log('build ok -> dist/index.mjs');
