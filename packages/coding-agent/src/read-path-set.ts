/** Session-scoped paths successfully read via the read tool (host-owned, not checkpointed). */
export interface ReadPathSet {
  has(path: string): boolean;
  add(path: string): void;
  list(): readonly string[];
  clear(): void;
}

export function createReadPathSet(): ReadPathSet {
  const paths = new Set<string>();
  return {
    has(path) {
      return paths.has(path);
    },
    add(path) {
      paths.add(path);
    },
    list() {
      return [...paths];
    },
    clear() {
      paths.clear();
    },
  };
}

export interface ReadBeforeWriteOptions {
  requireReadBeforeWrite?: boolean;
  readPathSet?: ReadPathSet;
}

/** Returns refusal message, or null when the mutation may proceed. */
export function refuseReadBeforeWrite(
  operation: "write" | "edit",
  displayPath: string,
  absolutePath: string,
  options: ReadBeforeWriteOptions | undefined,
  force: boolean,
): string | null {
  if (!options?.requireReadBeforeWrite || force) return null;
  if (options.readPathSet?.has(absolutePath)) return null;
  return `Refusing ${operation} to ${displayPath}: not read in this session. Read first or pass force=true.`;
}

/** Checkpoint namespace for the host-owned read-path set (plan 015 Task 4). */
export const READ_PATH_SET_NAMESPACE = "prism.coding-agent.read-path-set" as const;
/** Persistence bounds (plan 015 Task 4): paths are names, not contents. */
export const DEFAULT_MAX_PERSISTED_READ_PATHS = 1024;
export const DEFAULT_MAX_PERSISTED_READ_PATH_CHARS = 1024;

export interface CreateReadPathSetPersistenceOptions {
  /** Host-owned generic checkpoint store (ownership-scoped). */
  readonly checkpoints: import("@arnilo/prism").CheckpointStore;
  /** Checkpoint key, typically the session id. */
  readonly key: string;
  /** Ownership scope; part of the trust boundary — restore under another scope fails closed. */
  readonly ownership?: import("@arnilo/prism").OwnershipScope;
  /** Path-count cap (default 1024). */
  readonly maxPaths?: number;
  /** Per-path char cap (default 1024). */
  readonly maxPathChars?: number;
}

export interface ReadPathSetPersistence {
  /** Write the current set (CAS read-modify-write; conflicts surface to the host). */
  save(set: ReadPathSet): Promise<void>;
  /** Read persisted paths back into the set; returns how many were restored. */
  restore(set: ReadPathSet): Promise<number>;
}

/**
 * Opt-in persistence for the host-owned read-path set (plan 015 Task 4): names only,
 * bounded, ownership-scoped, fail-closed on malformed or oversized payloads. Default off.
 */
export function createReadPathSetPersistence(options: CreateReadPathSetPersistenceOptions): ReadPathSetPersistence {
  const maxPaths = Math.max(1, options.maxPaths ?? DEFAULT_MAX_PERSISTED_READ_PATHS);
  const maxPathChars = Math.max(1, options.maxPathChars ?? DEFAULT_MAX_PERSISTED_READ_PATH_CHARS);
  return {
    async save(set) {
      const paths = set.list();
      if (paths.length > maxPaths) {
        throw new Error(`Read-path set exceeds ${maxPaths} persisted paths (${paths.length})`);
      }
      for (const path of paths) {
        if (typeof path !== "string" || path.length > maxPathChars) {
          throw new Error(`Read-path exceeds ${maxPathChars} chars and cannot be persisted`);
        }
      }
      const existing = await options.checkpoints.loadCheckpoint({
        namespace: READ_PATH_SET_NAMESPACE,
        key: options.key,
        ...options.ownership,
      });
      await options.checkpoints.saveCheckpoint({
        namespace: READ_PATH_SET_NAMESPACE,
        key: options.key,
        version: (existing?.version ?? 0) + 1,
        expectedVersion: existing?.version ?? 0,
        value: paths,
        category: "session-state",
        ...options.ownership,
      });
    },
    async restore(set) {
      const record = await options.checkpoints.loadCheckpoint({
        namespace: READ_PATH_SET_NAMESPACE,
        key: options.key,
        ...options.ownership,
      });
      if (!record?.value) return 0;
      const paths = record.value;
      if (
        !Array.isArray(paths) ||
        paths.length > maxPaths ||
        paths.some((path) => typeof path !== "string" || path.length > maxPathChars)
      ) {
        throw new Error("Persisted read-path set is malformed or exceeds bounds; refusing to restore");
      }
      for (const path of paths) set.add(path);
      return paths.length;
    },
  };
}
