import { build } from 'esbuild';
await build({ entryPoints: ['src/ui/dashboard.tsx', 'src/ui/overlay.ts', 'src/ui/slate.ts'], bundle: true,
  outdir: 'output/web', format: 'esm', target: 'chrome110', minify: true, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
