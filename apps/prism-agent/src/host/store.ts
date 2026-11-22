import { type AgentConfig, createSessionIndex } from "@arnilo/prism";
import { createSqlitePersistence, sqliteStore } from "@arnilo/prism-extensions/store-sqlite";
import type { HostConfig } from "./config.js";

/** One SQLite file, listed on every agent. Not `AgentConfig.store`. */
export function sqlitePackage(path: string) {
  return sqliteStore({ path });
}

/** A second handle on the same file. Delegate children are not in it. */
export function sessionIndex(filename: string) {
  return createSessionIndex(createSqlitePersistence({ filename }));
}

/** With `recovery` on, runs are recorded in the same SQLite file so `prism-agent recover` can list the interrupted ones. */
export function runLedgerConfig(config: HostConfig): Pick<AgentConfig, "runLedger"> {
  return config.recovery === undefined ? {} : { runLedger: createSqlitePersistence({ filename: config.storePath }) };
}
