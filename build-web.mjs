import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist/web', { recursive: true });

// Plugin: copy index.html into the output dir after every (re)build, so
// editing the HTML during `npm run dev` is reflected without a restart.
// Also drop a .nojekyll marker so GitHub Pages serves the files as-is
// (Jekyll otherwise ignores files/dirs beginning with an underscore).
const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(() => {
      copyFileSync('src/web/index.html', 'dist/web/index.html');
      writeFileSync('dist/web/.nojekyll', '');
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ['src/web/app.ts', 'src/web/worker.ts'],
  bundle: true,
  format: 'esm',
  outdir: 'dist/web',
  splitting: false,
  loader: { '.ts': 'ts' },
  sourcemap: true,
  logLevel: 'info',
  plugins: [copyStaticPlugin],
});

const serve = process.argv.includes('--serve');
if (serve) {
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist/web', port: 8000 });
  console.log(`Serving on http://localhost:${port}/`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Built to dist/web/');
}
