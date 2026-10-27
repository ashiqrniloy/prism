import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MemoryInvalidationRecord, MemoryShareGrant, SourceAccessGrant } from "../types.js";

/** Control state and derived file index sidecars for the markdown store. */

export interface ThreadState {
  invalidations: Record<string, MemoryInvalidationRecord>;
  grants: Record<string, SourceAccessGrant>;
  shares: Record<string, MemoryShareGrant>;
  generation?: number | { readonly $bigint: string };
}

export interface ResourceState {
  readonly version: 1;
  readonly tenantId: string;
  readonly resourceId: string;
  threads: Record<string, ThreadState>;
  /** Per-resource counters (the scope clock); canonical here because files cannot derive them. */
  counters?: Record<string, number>;
}

export interface IndexedFile {
  readonly path: string;
  readonly id: string;
  readonly scope: { readonly tenantId: string; readonly resourceId: string; readonly threadId: string };
  readonly mtimeMs: number;
  readonly size: number;
  readonly hash: string;
  readonly kind?: string;
  readonly title: string;
  readonly description: string;
  readonly dir: string;
  /** Trust-scan flags from the last indexed version; lets the store log a `flagged` transition. */
  readonly flags?: readonly string[];
  /** Why this version cannot read the note (for example `version>1`); the file is kept as written. */
  readonly unreadable?: string;
}

export type FileMap = Record<string, IndexedFile>;

/** Temp file + `rename`, so a crash never leaves a half-written state or map. */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function readResourceState(path: string): Promise<ResourceState | undefined> {
  return readJson<ResourceState>(path);
}

export function writeResourceState(path: string, state: ResourceState): Promise<void> {
  return atomicWriteFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

export async function readFileMap(path: string): Promise<FileMap> {
  return (await readJson<FileMap>(path)) ?? {};
}

export function writeFileMap(path: string, map: FileMap): Promise<void> {
  return atomicWriteFile(path, `${JSON.stringify(map, null, 2)}\n`);
}

export function serializeGeneration(value: bigint | number): number | { readonly $bigint: string } {
  return typeof value === "bigint" ? { $bigint: value.toString() } : value;
}

export function deserializeGeneration(value: ThreadState["generation"]): bigint | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return /^\d+$/.test(value.$bigint) ? BigInt(value.$bigint) : undefined;
}
