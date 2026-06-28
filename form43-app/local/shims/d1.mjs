/**
 * D1Database shim backed by Node's built-in node:sqlite.
 *
 * Implements the subset of the D1 API the form43-app route modules use:
 *   db.prepare(sql).bind(...args).run() / .first() / .all()
 *   db.prepare(sql).all()                 (bind is optional)
 *   db.exec(sql)
 *
 * Mirrors D1 return shapes so the Worker code runs unchanged on Node.
 */
import { DatabaseSync } from 'node:sqlite';

function coerce(v) {
  // node:sqlite returns BigInt for INTEGER; D1/JSON expect Number.
  return typeof v === 'bigint' ? Number(v) : v;
}

function coerceRow(row) {
  if (!row || typeof row !== 'object') return row ?? null;
  const out = {};
  for (const k of Object.keys(row)) out[k] = coerce(row[k]);
  return out;
}

class D1PreparedStatement {
  constructor(sqlite, sql) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args.map((a) => (a === undefined ? null : a));
    return this;
  }
  first(colName) {
    const stmt = this.sqlite.prepare(this.sql);
    const row = stmt.get(...this.args);
    const obj = coerceRow(row);
    if (obj == null) return null;
    return colName ? obj[colName] : obj;
  }
  all() {
    const stmt = this.sqlite.prepare(this.sql);
    const rows = stmt.all(...this.args).map(coerceRow);
    return { results: rows, success: true, meta: {} };
  }
  run() {
    const stmt = this.sqlite.prepare(this.sql);
    const info = stmt.run(...this.args);
    return {
      success: true,
      meta: {
        last_row_id: coerce(info.lastInsertRowid),
        changes: coerce(info.changes),
      },
    };
  }
}

export class D1Sqlite {
  constructor(filePath) {
    this.sqlite = new DatabaseSync(filePath);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(sql) {
    return new D1PreparedStatement(this.sqlite, sql);
  }
  exec(sql) {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }
  get raw() {
    return this.sqlite;
  }
}
