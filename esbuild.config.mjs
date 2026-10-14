import esbuild from 'esbuild';
import { readFile } from 'fs/promises';

const watch = process.argv.includes('dev');
// jsPDF lazily imports these only for its html() and SVG helpers, which the plugin does not use.
const unusedJspdfDeps = {
  name: 'unused-jspdf-deps',
  setup(build) {
    build.onResolve({ filter: /^(html2canvas|canvg|dompurify)$/ }, (args) => ({ path: args.path, namespace: 'unused' }));
    build.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({ contents: 'export default undefined;' }));
  },
};
// Code paths the plugin never runs, cut so the bundle holds no script loader and no Node file access:
// jsPDF's «pdfobjectnewwindow» output fetches pdfobject from a CDN; sql.js takes Obsidian for Node and keeps
// fs/path/crypto for reading the wasm from disk, while the plugin passes the wasm itself (src/import/sqljs.ts).
const unusedCodePaths = {
  name: 'unused-code-paths',
  setup(build) {
    const patch = (filter, edit) => build.onLoad({ filter }, async (args) => {
      const before = await readFile(args.path, 'utf8');
      const after = edit(before);
      if (after === before) throw new Error(`unused-code-paths: nothing to cut in ${args.path}; check the dependency's new version`);
      return { contents: after, loader: 'js' };
    });
    patch(/jspdf[\\/]dist[\\/]jspdf\.es\.min\.js$/, (code) => code.replace(/case"pdfobjectnewwindow":[\s\S]*?(?=case"pdfjsnewwindow")/, 'case"pdfobjectnewwindow":throw new Error("pdfobjectnewwindow is not supported");'));
    patch(/sql\.js[\\/]dist[\\/]sql-wasm\.js$/, (code) => code
      .replace('"string"==typeof process.versions.node', 'false')
      .replace(/require\("(fs|path|crypto)"\)/g, '({})'));
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
  external: ['obsidian'],
  loader: { '.ttf': 'dataurl', '.wasm': 'binary' },
  plugins: [unusedJspdfDeps, unusedCodePaths, physicsWorker],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};
if (watch) {
  const context = await esbuild.context(config);
  await context.watch();
} else {
  await esbuild.build(config);
}
