/** Lo mínimo de la interfaz de D1 que usa el servidor (sin depender de @cloudflare/workers-types). */
export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta?: { changes?: number } }

export interface D1Stmt {
  bind(...args: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(col: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<D1Result[]>;
}
