declare module '*.ttf' {
  const url: string;
  export default url;
}
declare module 'physics-worker' {
  /** Source code of the bundled physics worker (see esbuild.config.mjs). */
  const source: string;
  export default source;
}
declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
