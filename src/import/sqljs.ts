import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';

/** SQLite for imports, started on first use; the wasm is bundled into main.js, so nothing is fetched. */
let loading: Promise<SqlJsStatic> | null = null;
export function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer });
  return loading;
}
