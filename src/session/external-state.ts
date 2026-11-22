/**
 * External-agent state (roadmap §2.12.9 K5). A driver archives what its vendor keeps outside Prism (a
 * transcript, a resume token) as `external_state` entries on the session's branch, so the archive follows
 * the session: `fork()` copies it, deleting the session deletes it, and it never enters `session.messages()`.
 *
 * Why not `package_state` with `op: "append"`: that log is unbounded per key, is owned by a package rather
 * than a loop, and shares a kind with values that tools and the observational fold read. An archive needs
 * its own per-key entry and byte caps and a kind no message projection or fold ever sees.
 */
import type { CompactionEntryData } from "../contracts-core/compaction.js";
import type { SessionEntry } from "../contracts-core/session.js";
import type { JsonValue } from "../contracts.js";
import { PackageLoadError } from "../packages/errors.js";
import { toJsonValue } from "../packages/schema.js";
import { MAX_STATE_VALUE_BYTES } from "./state.js";

/** Most entries one `(vendor, key)` log may hold on a branch. */
export const MAX_EXTERNAL_STATE_ENTRIES = 10_000;
/** Most JSON bytes one `(vendor, key)` log may hold on a branch. */
export const MAX_EXTERNAL_STATE_BYTES = 8 * 1024 * 1024;
/** Largest single entry; the same bound `package_state` uses. */
export const MAX_EXTERNAL_STATE_ENTRY_BYTES = MAX_STATE_VALUE_BYTES;
const MAX_KEY_LENGTH = 128;

/** The `data` of an `external_state` entry: one `append` or `replace` call, `seq` counting records per key. */
export interface ExternalStateData {
  readonly vendor: string;
  readonly key: string;
  readonly seq: number;
  readonly data: readonly JsonValue[];
  /** `"replace"` rotates `(vendor, key)` to `data`, freeing capacity used by earlier entries. */
  readonly op?: "append" | "replace";
}

/** `run.state(key)`: an append-only archive scoped to the loop (`vendor`) and the session. */
export interface ExternalStateHandle {
  /** Persists `entries` (JSON, each at most 64 KiB, redacted first) as one record. Rejects with `external_state_limit` past the caps. */
  append(entries: readonly JsonValue[]): Promise<void>;
  /** Rotates `(vendor, key)` to `entries` (default empty), resetting active entry/byte counts while keeping `seq` monotonic. */
  replace?(entries?: readonly JsonValue[]): Promise<void>;
  /** Every entry for this key on the session's branch since the latest rotation, in append order. */
  load(): Promise<readonly JsonValue[]>;
}

export interface ExternalStateHost {
  /** The branch, read once per call. */
  readonly branch: () => Promise<readonly SessionEntry[]>;
  /**
   * Runs `build` against the log's totals on the branch and appends the `external_state` entry it returns at
   * the tip, as one step in the session's append queue, so two overlapping appends cannot both pass the caps.
   * The totals (records' entries, their JSON bytes, the last `seq`, 0 when empty) come from the session's snapshot
   * and its compaction checkpoint (plan 230 Task 3), not a branch read per write.
   */
  readonly write: (
    build: (totals: NonNullable<CompactionEntryData["checkpoint"]>["externalState"][number]) => ExternalStateData,
  ) => Promise<void>;
  /** The agent's redactor, applied before the size caps are measured. */
  readonly redact: <T>(value: T) => T;
  /** The agent's ceilings (plan 239 Task 4). Defaults: {@link MAX_EXTERNAL_STATE_ENTRY_BYTES}, {@link MAX_EXTERNAL_STATE_ENTRIES}, {@link MAX_EXTERNAL_STATE_BYTES}. */
  readonly limits?: { readonly entryBytes: number; readonly entries: number; readonly bytes: number };
}

function isExternalStateData(value: unknown): value is ExternalStateData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return typeof data.vendor === "string" && typeof data.key === "string" && typeof data.seq === "number" && Array.isArray(data.data);
}

function recordsOf(branch: readonly SessionEntry[], vendor: string, key: string): ExternalStateData[] {
  const records: ExternalStateData[] = [];
  for (const entry of branch) {
    if (entry.kind === "external_state" && isExternalStateData(entry.data) && entry.data.vendor === vendor && entry.data.key === key) {
      records.push(entry.data);
    }
  }
  records.sort((a, b) => a.seq - b.seq);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]?.op === "replace") return records.slice(index);
  }
  return records;
}

/**
 * Every `(vendor, key)` log's totals over `entries`, added to `base` (a compaction checkpoint's totals for
 * the branch before it). One pass; the result is in first-seen order. A `"replace"` record resets `count`
 * and `bytes` for that key to its own payload while keeping `seq` monotonic.
 */
export function foldExternalState(
  entries: readonly SessionEntry[],
  base: NonNullable<CompactionEntryData["checkpoint"]>["externalState"] = [],
): NonNullable<CompactionEntryData["checkpoint"]>["externalState"][number][] {
  const totals = new Map<string, { vendor: string; key: string; count: number; bytes: number; seq: number }>();
  for (const item of base) totals.set(`${item.vendor}\u0000${item.key}`, { ...item });
  for (const entry of entries) {
    if (entry.kind !== "external_state" || !isExternalStateData(entry.data)) continue;
    const { vendor, key, seq, data, op } = entry.data;
    const id = `${vendor}\u0000${key}`;
    const held = totals.get(id) ?? { vendor, key, count: 0, bytes: 0, seq: 0 };
    const entryBytes = new TextEncoder().encode(JSON.stringify(data)).length;
    if (op === "replace") {
      held.count = data.length;
      held.bytes = entryBytes;
    } else {
      held.count += data.length;
      held.bytes += entryBytes;
    }
    held.seq = Math.max(held.seq, seq);
    totals.set(id, held);
  }
  return [...totals.values()];
}

const limit = (message: string): PackageLoadError => new PackageLoadError("external_state_limit", message);

function prepareEntries(
  entries: readonly JsonValue[],
  key: string,
  redact: ExternalStateHost["redact"],
  entryBytes: number,
  method: "append" | "replace",
): { readonly stored: JsonValue[]; readonly bytes: number } {
  if (!Array.isArray(entries)) throw new TypeError(`state.${method} needs an array of JSON entries`);
  const stored: JsonValue[] = [];
  let bytes = 0;
  for (const [index, entry] of entries.entries()) {
    const json = toJsonValue(entry);
    if ("error" in json) {
      throw new PackageLoadError("state_not_json", `External state ${key} entry ${index} ${json.error.message} at ${json.error.path}.`);
    }
    const redacted = redact(json.value);
    const size = new TextEncoder().encode(JSON.stringify(redacted)).length;
    if (size > entryBytes) {
      throw limit(`External state ${key} entry ${index} is ${size} bytes; ceilings.stateValueBytes is ${entryBytes}.`);
    }
    bytes += size;
    stored.push(redacted);
  }
  return { stored, bytes };
}

/** Builds the handle a loop gets from `run.state(key)`. `vendor` is the loop slot's owner. */
export function createExternalState(host: ExternalStateHost, vendor: string, key: string): ExternalStateHandle {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new TypeError(`state key must be 1-${MAX_KEY_LENGTH} characters`);
  }
  const caps = host.limits ?? {
    entryBytes: MAX_EXTERNAL_STATE_ENTRY_BYTES,
    entries: MAX_EXTERNAL_STATE_ENTRIES,
    bytes: MAX_EXTERNAL_STATE_BYTES,
  };
  const assertWithinCaps = (count: number, bytes: number) => {
    if (count > caps.entries) {
      throw limit(`External state ${key} would hold ${count} entries; ceilings.externalStateEntries is ${caps.entries}.`);
    }
    if (bytes > caps.bytes) {
      throw limit(`External state ${key} would hold ${bytes} bytes; ceilings.externalStateBytes is ${caps.bytes}.`);
    }
  };
  return {
    async load() {
      return recordsOf(await host.branch(), vendor, key).flatMap((record) => record.data);
    },
    async append(entries) {
      const { stored, bytes } = prepareEntries(entries, key, host.redact, caps.entryBytes, "append");
      if (stored.length === 0) return;
      await host.write(({ count, bytes: held, seq }) => {
        assertWithinCaps(count + stored.length, held + bytes);
        return { vendor, key, seq: seq + 1, data: stored };
      });
    },
    async replace(entries = []) {
      const { stored, bytes } = prepareEntries(entries, key, host.redact, caps.entryBytes, "replace");
      assertWithinCaps(stored.length, bytes);
      await host.write(({ seq }) => ({ vendor, key, seq: seq + 1, op: "replace", data: stored }));
    },
  };
}
