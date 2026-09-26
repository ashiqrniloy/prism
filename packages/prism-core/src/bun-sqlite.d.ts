// @types/bun's globals add fetch.preconnect and reject undefined SQL binds.
// types: ["node"] stays. Delete this when call sites accept SQLQueryBindings.
declare module "bun:sqlite" {
  class Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  class Database {
    constructor(filename: string, options?: { readonly?: boolean });
    exec(sql: string): this;
    prepare(sql: string): Statement;
    transaction<F extends (...args: any[]) => any>(fn: F): F;
    close(): void;
  }
  export { Database, Statement };
}
