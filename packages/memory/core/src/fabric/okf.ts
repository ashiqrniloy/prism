import type { JsonObject } from "@arnilo/prism";
import { MemoryValidationError } from "../errors.js";
import type { MemoryVectorRecord } from "../types.js";
import { fabricKind, noteDescription, noteTitle } from "./layout.js";

/**
 * OKF v0.2 markdown codec for the markdown fabric store (plan 188.1 Task 4).
 *
 * The envelope is OKF; the body is the record text. Every value is emitted as JSON, which is a
 * subset of YAML 1.2, so `Bun.YAML.parse` reads it back without ambiguity and a human can still
 * edit the top-level fields. Embeddings are never written here.
 */

export const OKF_VERSION = "0.2";

// `bun-types/test.d.ts` scopes the Bun globals this package uses and omits YAML; declare it locally
// (module-scoped) instead of shipping a global declaration to consumers.
declare const Bun: {
  readonly YAML: { parse(text: string): unknown; stringify(value: unknown): string };
};

const OKF_TYPE_BY_KIND: Readonly<Record<string, string>> = Object.freeze({
  fact: "Fact",
  preference: "Preference",
  procedure: "Procedure",
  episode: "Episode",
  file: "File",
});
const KIND_BY_OKF_TYPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(OKF_TYPE_BY_KIND).map(([kind, type]) => [type.toLowerCase(), kind])),
);

export function okfTypeForKind(kind: string | undefined): string {
  return (kind !== undefined && OKF_TYPE_BY_KIND[kind]) || "Note";
}

export function kindForOkfType(type: unknown): string | undefined {
  return typeof type === "string" ? KIND_BY_OKF_TYPE[type.toLowerCase()] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function json(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Reserved record metadata the codec owns (never written under `prism.metadata`): `extra` holds top-level
 * frontmatter keys this version does not know, re-emitted on every render; `unreadable` marks a note a newer
 * version wrote, with the whole file in `raw` so every writer re-emits it byte for byte.
 */
export const OKF_METADATA_KEY = "okf";

const KNOWN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  "type",
  "title",
  "description",
  "tags",
  "keywords",
  "status",
  "flags",
  "applies_to",
  "valid_from",
  "valid_to",
  "supersedes",
  "sources",
  "generated",
  "prism",
]);

function okfMetadata(metadata: JsonObject | undefined): Record<string, unknown> | undefined {
  const raw = metadata?.[OKF_METADATA_KEY];
  return isRecord(raw) ? raw : undefined;
}

/** The reason a record was classified unreadable when its file was parsed, if it was. */
export function unreadableReason(record: Pick<MemoryVectorRecord, "metadata">): string | undefined {
  const reason = okfMetadata(record.metadata)?.unreadable;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * Classifies a parsed note. A fabric object whose `v` is above 1 is always unreadable; `classify` adds
 * the reasons only the owning package can know (a field it refuses).
 */
export type NoteClassifier = (record: MemoryVectorRecord) => string | undefined;

function builtinUnreadable(record: MemoryVectorRecord): string | undefined {
  const version = fabricFields(record.metadata)?.v;
  return typeof version === "number" && version > 1 ? "version>1" : undefined;
}

function withoutOkfMetadata(metadata: JsonObject | undefined): JsonObject | undefined {
  if (metadata === undefined || !(OKF_METADATA_KEY in metadata)) return metadata;
  const { [OKF_METADATA_KEY]: _owned, ...rest } = metadata;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

function fabricFields(metadata: JsonObject | undefined): Record<string, unknown> | undefined {
  const raw = metadata?.fabric;
  return isRecord(raw) ? raw : undefined;
}

function encodeGeneration(value: bigint | number): unknown {
  return typeof value === "bigint" ? { $bigint: value.toString() } : value;
}

function decodeGeneration(value: unknown): bigint | number | undefined {
  if (isRecord(value) && typeof value.$bigint === "string" && /^\d+$/.test(value.$bigint)) return BigInt(value.$bigint);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return undefined;
}

function prismMap(record: MemoryVectorRecord): Record<string, unknown> {
  const fabric = fabricFields(record.metadata);
  return {
    id: record.id,
    scope: {
      tenantId: record.tenantId,
      resourceId: record.resourceId,
      ...(typeof fabric?.scope === "string" ? { level: fabric.scope } : {}),
    },
    thread_id: record.threadId,
    sequence: record.sequence,
    created_at: record.createdAt,
    ...(typeof fabric?.key === "string" ? { key: fabric.key } : {}),
    ...(record.importance === undefined ? {} : { importance: record.importance }),
    ...(record.consent === undefined ? {} : { consent: record.consent }),
    ...(record.lastAccessedAt === undefined ? {} : { last_accessed_at: record.lastAccessedAt }),
    ...(record.embedderId === undefined ? {} : { embedder_id: record.embedderId }),
    ...(record.generation === undefined ? {} : { generation: encodeGeneration(record.generation) }),
    ...(fabric?.flags === undefined ? {} : { flags: fabric.flags }),
    ...(withoutOkfMetadata(record.metadata) === undefined ? {} : { metadata: withoutOkfMetadata(record.metadata) }),
  };
}

/** The whole note as an OKF markdown file: frontmatter plus the record text. */
export function renderNoteFile(record: MemoryVectorRecord): string {
  const owned = okfMetadata(record.metadata);
  if (typeof owned?.unreadable === "string" && typeof owned.raw === "string") return owned.raw;
  const fabric = fabricFields(record.metadata);
  const lines = [
    "---",
    `type: ${json(okfTypeForKind(fabricKind(record)))}`,
    `title: ${json(noteTitle(record.text))}`,
    `description: ${json(noteDescription(record.text))}`,
  ];
  if (fabric?.tags !== undefined) lines.push(`tags: ${json(fabric.tags)}`);
  if (fabric?.keywords !== undefined) lines.push(`keywords: ${json(fabric.keywords)}`);
  if (record.metadata?.status !== undefined) lines.push(`status: ${json(record.metadata.status)}`);
  if (fabric?.flags !== undefined) lines.push(`flags: ${json(fabric.flags)}`);
  if (fabric?.appliesTo !== undefined) lines.push(`applies_to: ${json(fabric.appliesTo)}`);
  if (fabric?.validFrom !== undefined) lines.push(`valid_from: ${json(fabric.validFrom)}`);
  if (fabric?.validTo !== undefined) lines.push(`valid_to: ${json(fabric.validTo)}`);
  if (fabric?.supersedes !== undefined) lines.push(`supersedes: ${json(fabric.supersedes)}`);
  if (fabric?.sourceEntryIds !== undefined && Array.isArray(fabric.sourceEntryIds)) {
    lines.push(`sources: ${json(fabric.sourceEntryIds.map((id) => ({ id, resource: `prism-session:${id}` })))}`);
  }
  if (record.metadata?.generated !== undefined) lines.push(`generated: ${json(record.metadata.generated)}`);
  if (isRecord(owned?.extra)) {
    for (const [key, value] of Object.entries(owned.extra)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(key)) lines.push(`${/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : json(key)}: ${json(value)}`);
    }
  }
  lines.push(`prism: ${json(prismMap(record))}`);
  lines.push("---");
  return `${lines.join("\n")}\n\n${record.text}`;
}

function splitFrontmatter(content: string, filePath: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new MemoryValidationError(`note file is missing a frontmatter block: ${filePath}`);
  return { frontmatter: match[1]!, body: content.slice(match[0].length).replace(/^\r?\n/, "") };
}

function requireString(value: unknown, label: string, filePath: string): string {
  if (typeof value !== "string" || value.length === 0) throw new MemoryValidationError(`note ${filePath} is missing ${label}`);
  return value;
}

function requireTimestamp(value: unknown, label: string, filePath: string): string {
  const text = requireString(value, label, filePath);
  if (!Number.isFinite(Date.parse(text))) throw new MemoryValidationError(`note ${filePath} has an invalid ${label}`);
  return text;
}

function setFabric(metadata: JsonObject | undefined, patch: Record<string, unknown>): JsonObject {
  const base = metadata ?? {};
  const fabric = fabricFields(base) ?? {};
  return { ...base, fabric: { v: 1, ...fabric, ...patch } as JsonObject };
}

/** Rebuild one record from its OKF file. Editable OKF fields win over `prism` duplicates. */
export function parseNoteFile(content: string, filePath: string, classify?: NoteClassifier): MemoryVectorRecord {
  const { frontmatter, body } = splitFrontmatter(content, filePath);
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(frontmatter);
  } catch (error) {
    throw new MemoryValidationError(`note ${filePath} has malformed YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new MemoryValidationError(`note ${filePath} has no frontmatter mapping`);
  const prism = isRecord(parsed.prism) ? parsed.prism : undefined;
  if (!prism) throw new MemoryValidationError(`note ${filePath} is missing its prism map`);
  const scope = isRecord(prism.scope) ? prism.scope : {};
  const id = requireString(prism.id, "prism.id", filePath);
  const tenantId = requireString(scope.tenantId, "prism.scope.tenantId", filePath);
  const resourceId = requireString(scope.resourceId, "prism.scope.resourceId", filePath);
  const threadId = requireString(prism.thread_id ?? scope.threadId, "prism.thread_id", filePath);
  if (!Number.isInteger(prism.sequence)) throw new MemoryValidationError(`note ${filePath} has an invalid prism.sequence`);
  const createdAt = requireTimestamp(prism.created_at, "prism.created_at", filePath);
  if (body.trim().length === 0) throw new MemoryValidationError(`note ${filePath} has an empty body`);

  let metadata = isRecord(prism.metadata) ? (structuredClone(prism.metadata) as JsonObject) : undefined;
  const kind = kindForOkfType(parsed.type);
  if (kind !== undefined) metadata = setFabric(metadata, { kind });
  if (parsed.tags !== undefined) metadata = setFabric(metadata, { tags: parsed.tags });
  if (parsed.keywords !== undefined) metadata = setFabric(metadata, { keywords: parsed.keywords });
  if (parsed.valid_from !== undefined) metadata = setFabric(metadata, { validFrom: parsed.valid_from });
  if (parsed.valid_to !== undefined) metadata = setFabric(metadata, { validTo: parsed.valid_to });
  if (parsed.supersedes !== undefined) metadata = setFabric(metadata, { supersedes: parsed.supersedes });
  if (parsed.applies_to !== undefined) metadata = setFabric(metadata, { appliesTo: parsed.applies_to });
  if (typeof prism.key === "string") metadata = setFabric(metadata, { key: prism.key });
  if (isRecord(prism.scope) && typeof prism.scope.level === "string") metadata = setFabric(metadata, { scope: prism.scope.level });
  if (Array.isArray(parsed.sources)) {
    const sourceEntryIds = parsed.sources
      .map((source) => (isRecord(source) && typeof source.id === "string" ? source.id : undefined))
      .filter((value): value is string => value !== undefined);
    metadata = setFabric(metadata, { sourceEntryIds });
  }
  if (parsed.generated !== undefined) metadata = { ...(metadata ?? {}), generated: parsed.generated as JsonObject };
  if (parsed.status !== undefined) metadata = { ...(metadata ?? {}), status: parsed.status as string };
  if (isRecord(prism.flags)) metadata = setFabric(metadata, { flags: prism.flags });
  // The editable frontmatter `flags:` line wins over the `prism` duplicate.
  if (Array.isArray(parsed.flags)) metadata = setFabric(metadata, { flags: parsed.flags });

  const extra = Object.fromEntries(Object.entries(parsed).filter(([key]) => !KNOWN_FRONTMATTER_KEYS.has(key)));
  if (Object.keys(extra).length > 0) metadata = { ...(metadata ?? {}), [OKF_METADATA_KEY]: { extra } as JsonObject };

  const importance = prism.importance;
  if (importance !== undefined && (typeof importance !== "number" || !Number.isFinite(importance))) {
    throw new MemoryValidationError(`note ${filePath} has an invalid prism.importance`);
  }
  const generation = decodeGeneration(prism.generation);
  const record: MemoryVectorRecord = {
    id,
    tenantId,
    resourceId,
    threadId,
    text: body,
    embedding: [],
    sequence: prism.sequence as number,
    createdAt,
    ...(importance === undefined ? {} : { importance: importance as number }),
    ...(prism.consent === undefined ? {} : { consent: prism.consent as MemoryVectorRecord["consent"] }),
    ...(prism.last_accessed_at === undefined ? {} : { lastAccessedAt: prism.last_accessed_at as string }),
    ...(prism.embedder_id === undefined ? {} : { embedderId: prism.embedder_id as string }),
    ...(generation === undefined ? {} : { generation }),
    ...(metadata === undefined ? {} : { metadata }),
  };
  const reason = builtinUnreadable(record) ?? classify?.(record);
  if (reason === undefined) return record;
  // Unreadable: keep the file as written. Nothing here parses it further, and a render emits `raw` unchanged.
  return { ...record, metadata: { ...(record.metadata ?? {}), [OKF_METADATA_KEY]: { unreadable: reason, raw: content } as JsonObject } };
}

export interface IndexEntry {
  readonly dir: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
}

/** One `index.md` bullet. */
export function renderIndexLine(entry: IndexEntry): string {
  return `- [${entry.title}](${encodeURI(entry.path)}) - ${entry.description}`;
}

/** Root `index.md` (OKF §8): only `okf_version` frontmatter plus sectioned bullet listings. */
export function renderIndexFile(entries: readonly IndexEntry[], line: (entry: IndexEntry) => string = renderIndexLine): string {
  const groups = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.dir) ?? [];
    list.push(entry);
    groups.set(entry.dir, list);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, list]) => {
      const items = list
        .sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path))
        .map(line)
        .join("\n");
      return `## ${dir}\n\n${items}`;
    })
    .join("\n\n");
  return `---\nokf_version: ${json(OKF_VERSION)}\n---\n\n# Memory Index\n\nCatalog of durable memory notes.\n\n${sections}\n`;
}

export interface LogEntry {
  readonly date: string;
  readonly verb: string;
  readonly id: string;
  /** Provenance actor of the write (`agent`, `promotion`, `human`, `import`, `host`). */
  readonly by?: string;
  /** Free-text guidance for the person reading the log, rendered after an em dash. */
  readonly note?: string;
}

/** `log.md`: `## YYYY-MM-DD` headings, newest first, ids, verbs, and the writer. */
export function renderLogFile(entries: readonly LogEntry[]): string {
  const groups = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.date) ?? [];
    list.push(entry);
    groups.set(entry.date, list);
  }
  const sections = [...groups.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(
      (date) =>
        `## ${date}\n\n${groups
          .get(date)!
          .map(
            (entry) =>
              `* **${entry.verb}**${entry.by === undefined ? "" : ` (${entry.by})`}: ${entry.id}${entry.note === undefined ? "" : ` — ${entry.note}`}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");
  return `# Memory Log\n\n${sections}\n`;
}

export function parseLogFile(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  let date: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (heading) {
      date = heading[1]!;
      continue;
    }
    const item = line.match(/^\*\s+\*\*([a-z-]+)\*\*(?:\s+\(([a-z-]+)\))?:\s+(\S+)(?:\s+—\s+(.+))?\s*$/);
    if (item && date) {
      entries.push({
        date,
        verb: item[1]!,
        id: item[3]!,
        ...(item[2] === undefined ? {} : { by: item[2] }),
        ...(item[4] === undefined ? {} : { note: item[4] }),
      });
    }
  }
  return entries;
}
