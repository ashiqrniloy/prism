import { createSessionIndex } from "@arnilo/prism";
import { createSqlitePersistence, sqliteStore } from "@arnilo/prism-extensions/store-sqlite";

/** One SQLite file, listed on every agent. Not `AgentConfig.store`. */
export function sqlitePackage(path: string) {
  return sqliteStore({ path });
}

/** A second handle on the same file. Delegate children are not in it. */
export function sessionIndex(filename: string) {
  return createSessionIndex(createSqlitePersistence({ filename }));
}
