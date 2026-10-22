/**
 * External-agent state (roadmap §2.12.9 K5). A driver archives what its vendor keeps outside Prism (a
 * transcript, a resume token) as `external_state` entries on the session's branch, so the archive follows
 * the session: `fork()` copies it, deleting the session deletes it, and it never enters `session.messages()`.
 *
 * Why not `package_state` with `op: "append"`: that log is unbounded per key, is owned by a package rather
 * than a loop, and shares a kind with values that tools and the observational fold read. An archive needs
 * its own per-key entry and byte caps and a kind no message projection or fold ever sees.
 */
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

/** The `data` of an `external_state` entry: one `append` call, `seq` counting records per key. */
export interface ExternalStateData {
  readonly vendor: string;
  readonly key: string;
  readonly seq: number;
  readonly data: readonly JsonValue[];
}

/** `run.state(key)`: an append-only archive scoped to the loop (`vendor`) and the session. */
export interface ExternalStateHandle {
  /** Persists `entries` (JSON, each at most 64 KiB, redacted first) as one record. Rejects with `external_state_limit` past the caps. */
  append(entries: readonly JsonValue[]): Promise<void>;
  /** Every entry for this key on the session's branch, in append order. */
  load(): Promise<readonly JsonValue[]>;
}

export interface ExternalStateHost {
  /** The branch, read once per call. */
  readonly branch: () => Promise<readonly SessionEntry[]>;
  /**
   * Runs `build` against the branch and appends the `external_state` entry it returns at the tip, as one
   * step in the session's append queue, so two overlapping appends cannot both pass the caps.
   */
  readonly write: (build: (branch: readonly SessionEntry[]) => ExternalStateData) => Promise<void>;
  /** The agent's redactor, applied before the size caps are measured. */
  readonly redact: <T>(value: T) => T;
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
  return records.sort((a, b) => a.seq - b.seq);
}

const limit = (message: string): PackageLoadError => new PackageLoadError("external_state_limit", message);

/** Builds the handle a loop gets from `run.state(key)`. `vendor` is the loop slot's owner. */
export function createExternalState(host: ExternalStateHost, vendor: string, key: string): ExternalStateHandle {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new TypeError(`state key must be 1-${MAX_KEY_LENGTH} characters`);
  }
  return {
    async load() {
      return recordsOf(await host.branch(), vendor, key).flatMap((record) => record.data);
    },
    async append(entries) {
      if (!Array.isArray(entries)) throw new TypeError("state.append needs an array of JSON entries");
      if (entries.length === 0) return;
      const stored: JsonValue[] = [];
      let bytes = 0;
      for (const [index, entry] of entries.entries()) {
        const json = toJsonValue(entry);
        if ("error" in json) {
          throw new PackageLoadError("state_not_json", `External state ${key} entry ${index} ${json.error.message} at ${json.error.path}.`);
        }
        const redacted = host.redact(json.value);
        const size = new TextEncoder().encode(JSON.stringify(redacted)).length;
        if (size > MAX_EXTERNAL_STATE_ENTRY_BYTES) {
          throw limit(`External state ${key} entry ${index} is ${size} bytes; the limit is ${MAX_EXTERNAL_STATE_ENTRY_BYTES}.`);
        }
        bytes += size;
        stored.push(redacted);
      }
      await host.write((branch) => {
        const records = recordsOf(branch, vendor, key);
        const count = records.reduce((total, record) => total + record.data.length, 0);
        if (count + stored.length > MAX_EXTERNAL_STATE_ENTRIES) {
          throw limit(`External state ${key} would hold ${count + stored.length} entries; the limit is ${MAX_EXTERNAL_STATE_ENTRIES}.`);
        }
        const held = records.reduce((total, record) => total + new TextEncoder().encode(JSON.stringify(record.data)).length, 0);
        if (held + bytes > MAX_EXTERNAL_STATE_BYTES) {
          throw limit(`External state ${key} would hold ${held + bytes} bytes; the limit is ${MAX_EXTERNAL_STATE_BYTES}.`);
        }
        const seq = records.length === 0 ? 1 : records[records.length - 1]!.seq + 1;
        return { vendor, key, seq, data: stored };
      });
    },
  };
}
