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
