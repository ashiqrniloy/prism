// Plan 218.3 Task 10: the subset of better-sqlite3 that Mem0 3.3.1 uses (`new Database(path)`, `prepare` with
// positional `run`/`get`/`all`, `exec`, `transaction`, `close`), served by bun:sqlite. Mem0's own SQL runs unchanged.
import { Database as BunDatabase } from "bun:sqlite";

export default class Database extends BunDatabase {
  constructor(path = ":memory:", options = {}) {
    super(path, { create: !options.readonly, readonly: Boolean(options.readonly) });
  }
  prepare(sql) {
    const statement = super.prepare(sql);
    return {
      run: (...args) => statement.run(...args),
      get: (...args) => statement.get(...args) ?? undefined,
      all: (...args) => statement.all(...args),
      iterate: (...args) => statement.iterate(...args),
    };
  }
  pragma(text) {
    return this.query(`PRAGMA ${text}`).all();
  }
}
