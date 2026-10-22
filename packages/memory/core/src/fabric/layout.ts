import { basename, dirname, join, resolve, sep } from "node:path";
import { MemoryValidationError } from "../errors.js";
import type { MemoryVectorRecord } from "../types.js";

/**
 * On-disk layout for the markdown fabric store (plan 188.1 Task 4).
 *
 * Files are canonical; the SQLite index is a rebuildable cache. Every path is derived from
 * validated segments, so a note id, tenant, or resource can never traverse out of the root.
 */

/** One kind → directory map. Plan 188.2 adds `preferences` with a single entry here. */
export const KIND_DIRECTORIES: Readonly<Record<string, string>> = Object.freeze({
  fact: "facts",
  preference: "preferences",
  procedure: "procedures",
  episode: "episodes",
});
export const DEFAULT_DIRECTORY = "entries";
export const ARCHIVE_DIRECTORY = "archive";
export const INDEX_FILE = "index.md";
export const LOG_FILE = "log.md";
export const LOCK_FILE = ".lock";
export const INDEX_DB_FILE = ".index.sqlite";
export const FILE_MAP_FILE = ".index-files.json";
export const STATE_FILE = ".state.json";
export const WORKING_DIRECTORY = "working";

const RESOURCE_SEGMENT_CAP = 4;

export function directoryForKind(kind: string | undefined): string {
  return (kind !== undefined && KIND_DIRECTORIES[kind]) || DEFAULT_DIRECTORY;
}

/** `file` notes are index-only: the user's file is the source, and file reconcile re-derives them. */
export function isIndexOnlyKind(kind: string | undefined): boolean {
  return kind === "file";
}

/** The fabric kind under `metadata.fabric.kind`, or undefined for a plain record. */
export function fabricKind(record: Pick<MemoryVectorRecord, "metadata">): string | undefined {
  const raw = record.metadata?.fabric;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const kind = (raw as { kind?: unknown }).kind;
  return typeof kind === "string" && kind.length > 0 ? kind : undefined;
}

function assertSegment(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new MemoryValidationError(`${label} must be a non-empty string`);
  if (value.includes("\0")) throw new MemoryValidationError(`${label} must not contain NUL`);
  if (value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new MemoryValidationError(`${label} must be a single path segment`);
  }
  return encodeURIComponent(value);
}

/** `<tenant>/<resource segment>/...` — `resourceId` splits on `/`, 1–4 non-empty validated segments. */
export function scopeDirectory(tenantId: string, resourceId: string): string {
  if (typeof resourceId !== "string" || resourceId.length === 0) {
    throw new MemoryValidationError("resourceId must be a non-empty string");
  }
  const parts = resourceId.split("/");
  if (parts.length < 1 || parts.length > RESOURCE_SEGMENT_CAP) {
    throw new MemoryValidationError(`resourceId must have 1–${RESOURCE_SEGMENT_CAP} path segments`);
  }
  return [assertSegment(tenantId, "tenantId"), ...parts.map((part) => assertSegment(part, "resourceId segment"))].join("/");
}

/** Lowercase hyphenated slug; empty input falls back to `note`. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "note";
}

/** First non-empty line, capped, for the OKF `title`. */
export function noteTitle(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .find((value) => value.trim().length > 0)
      ?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line.length > 0 ? line : "Memory note";
}

/** One-line summary for the OKF `description`. */
export function noteDescription(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

function fabricValidTo(record: Pick<MemoryVectorRecord, "metadata">): string | undefined {
  const raw = record.metadata?.fabric;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as { validTo?: unknown }).validTo;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Trust-scan flags under `metadata.fabric.flags`; empty when clean. */
export function fabricFlags(record: Pick<MemoryVectorRecord, "metadata">): readonly string[] {
  const raw = record.metadata?.fabric;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const value = (raw as { flags?: unknown }).flags;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** Write provenance actor from top-level `metadata.generated.by`, when present. */
export function provenanceActor(record: Pick<MemoryVectorRecord, "metadata">): string | undefined {
  const raw = record.metadata?.generated;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const by = (raw as { by?: unknown }).by;
  return typeof by === "string" && by.length > 0 ? by : undefined;
}

/** Superseded, expired, archived, or invalidated notes file under `archive/<dir>`. */
export function isArchived(record: Pick<MemoryVectorRecord, "metadata">, invalidated: boolean, nowMs: number): boolean {
  if (invalidated) return true;
  if (record.metadata?.status === "archived") return true;
  const validTo = fabricValidTo(record);
  return validTo !== undefined && Number.isFinite(Date.parse(validTo)) && Date.parse(validTo) <= nowMs;
}

export interface NotePathInput {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly kind: string | undefined;
  readonly text: string;
  readonly archived: boolean;
  readonly id: string;
  /** Full id used when the 8-char prefix is taken by a different note. */
  readonly fullId?: boolean;
}

/** `<tenant>/<resource-path>/<dir>/<slug>--<id8>.md` (relative to the store root). */
export function noteRelPath(input: NotePathInput): string {
  const directory = directoryForKind(input.kind);
  const dir = input.archived ? `${ARCHIVE_DIRECTORY}/${directory}` : directory;
  const suffix = input.fullId ? input.id : input.id.slice(0, 8);
  return `${scopeDirectory(input.tenantId, input.resourceId)}/${dir}/${slugify(noteTitle(input.text))}--${suffix}.md`;
}

export function workingRelPath(tenantId: string, resourceId: string, threadId: string): string {
  return `${scopeDirectory(tenantId, resourceId)}/${WORKING_DIRECTORY}/${encodeURIComponent(threadId)}.md`;
}

export function stateRelPath(tenantId: string, resourceId: string): string {
  return `${scopeDirectory(tenantId, resourceId)}/${STATE_FILE}`;
}

/** True when a relative path is a note file (its parent directory is a kind directory). */
export function isNoteRelPath(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.length < 3) return false;
  const file = parts.at(-1)!;
  if (!file.endsWith(".md")) return false;
  if (file === INDEX_FILE || file === LOG_FILE || /^log-\d{4}\.md$/.test(file)) return false;
  const dir = parts.at(-2)!;
  return Object.values(KIND_DIRECTORIES).includes(dir) || dir === DEFAULT_DIRECTORY;
}

/** Real path of the longest existing ancestor of `target`, with the missing tail re-joined. */
export async function realPathNearest(target: string): Promise<string> {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      const { realpath } = await import("node:fs/promises");
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      tail.push(basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** Fail closed when `target` (or a symlinked ancestor) escapes `root`. */
export async function assertInsideRoot(root: string, target: string): Promise<void> {
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  if (!isInside(rootAbs, targetAbs)) throw new MemoryValidationError(`path escapes the markdown store root: ${target}`);
  const realRoot = await realPathNearest(rootAbs);
  const realTarget = await realPathNearest(targetAbs);
  if (!isInside(realRoot, realTarget)) throw new MemoryValidationError(`path escapes the markdown store root through a symlink: ${target}`);
}
