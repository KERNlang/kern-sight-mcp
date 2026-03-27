import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: !watch,
};

const configs = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
  { ...shared, entryPoints: ['src/mcp-server.ts'], outfile: 'dist/mcp-server.js' },
  { ...shared, external: [], entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' },
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
