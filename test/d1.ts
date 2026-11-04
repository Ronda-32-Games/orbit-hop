// D1 de mentira para las pruebas: misma interfaz (prepare, bind, first, all, run, batch) sobre el
// SQLite de Node. D1 también es SQLite, así que las consultas son las mismas.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1, D1Stmt } from '../src/server/d1.ts';

export function makeD1(): D1 & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async first(col?: string) {
      const row = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined;
      if (!row) return null;
      return (col ? row[col] : { ...row }) as never;
    },
    async all() {
      return { success: true, results: (db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]).map(r => ({ ...r })) as never[] };
    },
    async run() {
      const r = db.prepare(sql).run(...(args as never[]));
      return { success: true, results: [], meta: { changes: Number(r.changes) } };
    },
  });
  return {
    raw: db,
    prepare: (sql: string) => stmt(sql),
    async batch(stmts: D1Stmt[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
