/**
 * Storage durability classifier. Reads declared kind and constructor name only.
 */

/** Classifies a store by declared kind/durability and constructor name — never reads contents or connection strings (plan 084 Task 4 reuses it for run-bundle snapshots). */
export function describeStorage(store: unknown, checkpoints: unknown): { kind: string; durable: boolean } {
  const target = store ?? checkpoints;
  if (!target || typeof target !== "object") {
    return { kind: "none", durable: false };
  }

  const record = target as Record<string, unknown>;
  const constructorName = (target as { constructor?: { name?: string } }).constructor?.name ?? "";
  const declaredKind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";

  // Explicit in-memory implementations are NEVER durable.
  if (
    constructorName.includes("Memory") ||
    declaredKind.includes("memory") ||
    record.durable === false ||
    record.durability === "ephemeral"
  ) {
    return { kind: declaredKind || "memory", durable: false };
  }

  // Postgres, SQLite, or explicitly durable stores
  if (
    record.durable === true ||
    record.durability === "durable" ||
    constructorName.includes("Postgres") ||
    constructorName.includes("Sqlite") ||
    declaredKind.includes("postgres") ||
    declaredKind.includes("sqlite")
  ) {
    return { kind: declaredKind || constructorName.toLowerCase() || "durable", durable: true };
  }

  // Any store with saveCheckpoint / appendEntry / queryEntries without explicit durable: true is in-memory
  if (
    typeof record.saveCheckpoint === "function" ||
    typeof record.appendEntry === "function" ||
    typeof record.queryEntries === "function" ||
    typeof record.append === "function"
  ) {
    return { kind: declaredKind || "memory", durable: false };
  }

  // Unknown store without explicit durable flag is treated as non-durable memory
  return { kind: declaredKind || "memory", durable: false };
}
