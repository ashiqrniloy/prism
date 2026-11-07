import { type Agent, createAgent, type ModelSpec, type PackageInput } from "@arnilo/prism";
import { sqliteStore } from "@arnilo/prism-store-sqlite";

export interface HostOptions {
  readonly model: ModelSpec;
  readonly providers: readonly PackageInput[];
  /** SQLite database file for sessions. Absent: sessions live in memory. */
  readonly dbPath?: string;
}

export async function createHost(options: HostOptions): Promise<Agent> {
  return createAgent({
    model: options.model,
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    packages: [...options.providers, ...(options.dbPath ? [sqliteStore({ path: options.dbPath })] : [])],
  });
}
