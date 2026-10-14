import esbuild from 'esbuild';

const watch = process.argv.includes('dev');
// jsPDF lazily imports these only for its html() and SVG helpers, which the plugin does not use.
const unusedJspdfDeps = {
  name: 'unused-jspdf-deps',
  setup(build) {
    build.onResolve({ filter: /^(html2canvas|canvg|dompurify)$/ }, (args) => ({ path: args.path, namespace: 'unused' }));
    build.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({ contents: 'export default undefined;' }));
  },
};
// The physics worker is bundled separately and embedded into main.js as a string, so the plugin stays one file.
const physicsWorker = {
  name: 'physics-worker',
  setup(build) {
    build.onResolve({ filter: /^physics-worker$/ }, () => ({ path: 'physics-worker', namespace: 'physics-worker' }));
    build.onLoad({ filter: /.*/, namespace: 'physics-worker' }, async () => {
      const result = await esbuild.build({
        entryPoints: ['src/physics.worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: !watch,
      });
      return { contents: result.outputFiles[0].text, loader: 'text', watchFiles: ['src/physics.worker.ts', 'src/physics.ts', 'src/layout.ts', 'src/scene.ts', 'src/model.ts'] };
    });
  },
};
const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  outfile: 'main.js',
  // sql.js mentions Node modules for its own Node build; Obsidian desktop provides them, and the plugin passes the wasm itself.
  external: ['obsidian', 'electron', 'fs', 'path', 'crypto'],
  loader: { '.ttf': 'dataurl', '.wasm': 'binary' },
  plugins: [unusedJspdfDeps, physicsWorker],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};
if (watch) {
  const context = await esbuild.context(config);
  await context.watch();
} else {
  await esbuild.build(config);
}
