import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
};

const configs = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
  { ...shared, entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js' },
];

if (watch) {
  for (const config of configs) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
  }
  console.log('Watching for changes...');
} else {
  for (const config of configs) {
    await esbuild.build(config);
  }
  console.log('Build complete.');
}
