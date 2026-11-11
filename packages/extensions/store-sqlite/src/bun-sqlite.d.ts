// @types/bun's globals add fetch.preconnect and reject undefined SQL binds.
// types: ["node"] stays. Delete this when call sites accept SQLQueryBindings.
// Copied from packages/prism-core/src/bun-sqlite.d.ts by plan 153 Task 4: the package's tsconfig scopes
// `types` to node + bun-types/test.d.ts, so the store carries its own ambient declaration.
declare module "bun:sqlite" {
  class Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  class Database {
    constructor(filename: string, options?: { readonly?: boolean; strict?: boolean });
    exec(sql: string): this;
    prepare(sql: string): Statement;
    query<T = any, Params extends any[] = any[]>(sql: string): {
      run(...params: Params): { changes: number; lastInsertRowid: number | bigint };
      get(...params: Params): T | null;
      all(...params: Params): T[];
    };
    transaction<F extends (...args: any[]) => any>(fn: F): F & { immediate: F };
    close(): void;
  }
  export { Database, Statement };
}
