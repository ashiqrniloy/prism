/**
 * The team project store (plan 188.5 Task 3): a checked-in `<project root>/<team.dir>` markdown tree
 * that the fabric recalls as scope `team`, and that only a human-approved `memory:share` writes.
 *
 * The directory is untrusted input — it arrives with someone else's commit — so every note is trust
 * scanned on load and a note that trips the scan is rewritten as a `candidate` carrying its `flags`,
 * exactly as an imported bundle is. Tools never reach this store (`readOnlyScopes`), capacity and
 * widening never see it, and the derived SQLite index lives under `tools.root/.team-index/`, so the
 * repository holds notes only.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Memory, MemoryVectorRecord, VectorStore } from "@arnilo/prism-memory-core";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { type MemoryNoteStatus, normalizeNoteStatus } from "../lifecycle/status.js";
import { createMemory } from "../memory.js";
import { conceptSources, renderConceptBody } from "../ontology/codec.js";
import { readConceptBody } from "../ontology/render.js";
import { reviewConceptEdit } from "../ontology/review.js";
import { scanScopedMemoryContent } from "../scoped/trust.js";
import {
  encodeMemoryNoteMetadata,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryNoteKind,
  type MemoryNoteMetadata,
  parseMemoryNoteMetadata,
  stampProvenance,
} from "../types.js";

/** The team store's fixed tenant and resource: one shared store per checkout, not per person. */
export const TEAM_TENANT = "team";
export const TEAM_RESOURCE = "project";
const TEAM_THREAD = "default";
const DEFAULT_TEAM_DIR = ".prism/memory";

/**
 * Kinds a person may share: the durable lessons, and a verified concept (plan 207 Task 4). A file snapshot or a
 * session view is not shared. A shared concept keeps its current claims and cited ids but never the cited notes.
 */
const SHAREABLE_KINDS: ReadonlySet<MemoryNoteKind> = new Set(["fact", "preference", "procedure", "concept"]);

const TEAM_SCAN_PAGE = 500;
const TEAM_SCAN_MAX_PAGES = 8;

export interface MemoryFabricTeamConfig {
  /** Directory relative to the project root; default `.prism/memory`. */
  readonly dir?: string;
  /** `ask` (default) asks through `host.ui` before every write; `off` refuses every share. */
  readonly write?: "ask" | "off";
}

export interface ResolvedFabricTeamOptions {
  /** Absolute team directory, always inside the project root. */
  readonly dir: string;
  readonly write: "ask" | "off";
}

/**
 * Resolve `team` against the project root. Off when unset, `false`, or when no project root is known:
 * the team store is the project's, and its index is named by the project id.
 */
export function resolveFabricTeamOptions(
  value: boolean | MemoryFabricTeamConfig | undefined,
  projectRoot: string | undefined,
): false | ResolvedFabricTeamOptions {
  if (value === false || value === undefined || projectRoot === undefined) return false;
  const config = value === true ? {} : value;
  const dir = config.dir ?? DEFAULT_TEAM_DIR;
  if (typeof dir !== "string" || dir.trim().length === 0 || dir.includes("\0")) {
    throw new MemoryValidationError("team.dir must be a non-empty path");
  }
  const root = resolve(projectRoot);
  const target = resolve(root, dir);
  const rel = relative(root, target);
  if (rel.length === 0 || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new MemoryValidationError("team.dir must stay inside the project root");
  }
  const write = config.write ?? "ask";
  if (write !== "ask" && write !== "off") throw new MemoryValidationError('team.write must be "ask" or "off"');
  return { dir: target, write };
}

export interface FabricTeamCensus {
  readonly verified: number;
  readonly candidate: number;
  readonly archived: number;
  /** Candidates carrying a trust flag: refused by the scan on load. */
  readonly quarantined: number;
}

/** What a person answered when asked to share: the caller owns `host.ui`. */
export type FabricTeamApproval = "approved" | "denied" | "unavailable";

export type FabricTeamShareReason =
  | "write_off"
  | "not_found"
  | "not_shareable"
  | "not_verified"
  | "flagged"
  | "host_unavailable"
  | "denied"
  | "failed";

export interface FabricTeamShareInput {
  readonly id: string;
  /** The private project memory the note lives in. */
  readonly source: Memory;
  readonly approve: (request: { readonly title: string; readonly detail: string }) => Promise<FabricTeamApproval>;
}

export type FabricTeamShareResult =
  | { readonly ok: true; readonly id: string; readonly path: string; readonly text: string }
  | { readonly ok: false; readonly reason: FabricTeamShareReason; readonly text: string };

export interface FabricTeam {
  readonly memory: Memory;
  /** The team store itself, for the read-only ontology scope. */
  readonly store: VectorStore;
  readonly options: ResolvedFabricTeamOptions;
  /** Absolute path of the derived index, outside the checked-in tree. */
  readonly index: string;
  /** Notes quarantined by the load-time trust scan. */
  readonly quarantined: number;
  census(): Promise<FabricTeamCensus>;
  share(input: FabricTeamShareInput): Promise<FabricTeamShareResult>;
  close(): Promise<void>;
}

/**
 * Open the team store at `options.dir`, index it at `input.index`, and quarantine what the trust scan
 * refuses. The caller checks that the directory exists (a team store is opt-in per checkout).
 */
export async function createFabricTeam(input: {
  readonly options: ResolvedFabricTeamOptions;
  readonly index: string;
  readonly signal?: AbortSignal;
}): Promise<FabricTeam> {
  const { createMarkdownMemoryStores, noteRelPath } = await import("@arnilo/prism-memory-core/fabric");
  // The index is derived and lives outside the checked-in tree: refuse one inside the team directory.
  const indexPath = resolve(input.index);
  const inside = relative(resolve(input.options.dir), indexPath);
  if (inside.length === 0 || (!inside.startsWith("..") && !isAbsolute(inside))) {
    throw new MemoryValidationError("the team index must live outside the team directory");
  }
  await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
  // A person's git change to a shared concept is reviewed like any edit: the codec, the trust scan, the human marker.
  const stores = await createMarkdownMemoryStores({
    root: input.options.dir,
    index: { path: indexPath },
    reviewEdit: (record, previous) => reviewConceptEdit(record, previous),
  });
  const scope = { tenantId: TEAM_TENANT, resourceId: TEAM_RESOURCE, threadId: TEAM_THREAD };
  const memory = createMemory({ ...scope, vectorStore: stores.vectorStore, workingStore: stores.workingStore });
  const signal = input.signal;
  const options = signal === undefined ? {} : { signal };

  // Discovery is `listByThread`, not `scanMetadata`: a hand-written team note carries no consent
  // record, and scanMetadata skips those — the notes this scan must judge are exactly the ones it hides.
  async function* pages(): AsyncGenerator<readonly MemoryVectorRecord[]> {
    let cursor: string | undefined;
    for (let page = 0; page < TEAM_SCAN_MAX_PAGES; page += 1) {
      const result = await stores.vectorStore.listByThread!({
        ...scope,
        limit: TEAM_SCAN_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
        ...options,
      });
      yield result.records;
      cursor = result.nextCursor;
      if (cursor === undefined) return;
    }
  }

  // Trust scan on load: the directory comes from someone else's commit, so a note that trips the scan
  // becomes a quarantined candidate (and the note file records why, like an imported bundle).
  let quarantined = 0;
  for await (const records of pages()) {
    for (const record of records) {
      const note = parseMemoryNoteMetadata(record.metadata);
      if (note === undefined || note.kind === "file") continue;
      const scan = scanScopedMemoryContent(record.text);
      const flags = scan.ok ? [] : [scan.class];
      if (!scan.ok) quarantined += 1;
      // Already in the state this pass would write: no rewrite, so a checked-in note stays byte-identical.
      const current = [...(note.flags ?? [])].sort();
      const same = current.length === flags.length && current.every((flag, index) => flag === flags[index]);
      const status = scan.ok ? undefined : "candidate";
      if (same && (record.metadata?.status ?? undefined) === status) continue;
      const next: MemoryNoteMetadata = scan.ok ? withoutFlags(note) : { ...note, flags };
      const { status: _prior, ...host } = record.metadata ?? {};
      await stores.vectorStore.upsert(
        [
          {
            ...record,
            metadata: { ...host, [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata(next), ...(status === undefined ? {} : { status }) },
          },
        ],
        options,
      );
    }
  }

  async function census(): Promise<FabricTeamCensus> {
    const counts: Record<MemoryNoteStatus, number> = { verified: 0, candidate: 0, archived: 0, retired: 0 };
    let quarantined = 0;
    for await (const records of pages()) {
      for (const record of records) {
        const note = parseMemoryNoteMetadata(record.metadata);
        if (note === undefined) continue;
        counts[normalizeNoteStatus(record.metadata?.status as string | undefined, "verified")] += 1;
        if ((note.flags?.length ?? 0) > 0) quarantined += 1;
      }
    }
    return { verified: counts.verified, candidate: counts.candidate, archived: counts.archived, quarantined };
  }

  async function share(shareInput: FabricTeamShareInput): Promise<FabricTeamShareResult> {
    if (input.options.write === "off") {
      return { ok: false, reason: "write_off", text: "team.write is off; nothing was shared." };
    }
    const [record] = await shareInput.source.get([shareInput.id]);
    if (record === undefined) return { ok: false, reason: "not_found", text: `No note ${shareInput.id} in this scope.` };
    const note = parseMemoryNoteMetadata(record.metadata);
    if (note === undefined || !SHAREABLE_KINDS.has(note.kind)) {
      return { ok: false, reason: "not_shareable", text: `Note ${record.id} is not a fact, preference, procedure or concept.` };
    }
    const status = normalizeNoteStatus(record.metadata?.status as string | undefined, "verified");
    if (status !== "verified" || (note.flags?.length ?? 0) > 0) {
      return { ok: false, reason: "not_verified", text: `Note ${record.id} is ${status}; only a verified note can be shared.` };
    }
    if (!scanScopedMemoryContent(record.text).ok) {
      return { ok: false, reason: "flagged", text: `Note ${record.id} trips the trust scan; nothing was shared.` };
    }
    // A concept travels as its current claims only: stale items and open questions about private evidence stay home.
    let text = record.text;
    let shared: MemoryNoteMetadata = { ...note };
    let existingConcept: string | undefined;
    if (note.kind === "concept") {
      const doc = readConceptBody(record.text);
      const stale = new Set(note.stale ?? []);
      const claims = doc?.claims.filter((claim) => !stale.has(claim.id)) ?? [];
      if (doc === undefined || claims.length === 0) {
        return { ok: false, reason: "not_shareable", text: `Concept ${record.id} has no current claim to share.` };
      }
      const current = { title: doc.title, claims, questions: [], contradictions: [] };
      text = renderConceptBody(current);
      // The citations stay as provenance; the cited notes are private and do not travel with the concept.
      shared = {
        ...note,
        sources: conceptSources(current),
        stale: undefined,
        dirty: undefined,
        links: undefined,
        uses: undefined,
        useSessions: undefined,
      } as MemoryNoteMetadata;
      // One concept per subject per scope: a repeat share replaces the team's earlier concept for that subject.
      for await (const records of pages()) {
        for (const candidate of records) {
          const other = parseMemoryNoteMetadata(candidate.metadata);
          if (other?.kind === "concept" && other.subject === note.subject) existingConcept = candidate.id;
        }
      }
    }
    if (!scanScopedMemoryContent(text).ok) {
      return { ok: false, reason: "flagged", text: `Note ${record.id} trips the trust scan; nothing was shared.` };
    }
    const id =
      existingConcept ?? createHash("sha256").update(`fabric:team:${record.id}\u0000${record.text}`, "utf8").digest("hex").slice(0, 12);
    const path = noteRelPath({
      tenantId: TEAM_TENANT,
      resourceId: TEAM_RESOURCE,
      kind: note.kind,
      text,
      archived: false,
      id,
    });
    const answer = await shareInput.approve({
      title: `Share note ${record.id} with the team store?`,
      detail: `${text}\n\n${
        note.kind === "concept" ? `Shares ${shared.sources?.length ?? 0} citation id(s) without the cited notes; they stay private. ` : ""
      }Writes ${join(input.options.dir, path)}. Review it before you commit.`,
    });
    if (answer === "unavailable") {
      return { ok: false, reason: "host_unavailable", text: "No host UI answered; a share needs a person's approval." };
    }
    if (answer !== "approved") return { ok: false, reason: "denied", text: "The share was not approved." };
    const sharedRecord: MemoryVectorRecord = {
      id,
      ...scope,
      text,
      embedding: [],
      sequence: record.sequence,
      createdAt: record.createdAt,
      consent: { source: "user", scope: "thread", visible: true, grantedAt: new Date().toISOString() },
      metadata: {
        [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({
          ...shared,
          scope: "team",
          status: undefined,
          appliesTo: undefined,
          flags: undefined,
          sourceEntryIds: [record.id],
        } as MemoryNoteMetadata),
        generated: stampProvenance("human", new Date().toISOString()),
        auditVerb: "shared-to-team",
      },
    };
    try {
      await stores.vectorStore.upsert([sharedRecord]);
    } catch (error) {
      return { ok: false, reason: "failed", text: error instanceof Error ? error.message : "the share failed" };
    }
    return { ok: true, id, path, text };
  }

  return {
    memory,
    store: stores.vectorStore,
    options: input.options,
    index: input.index,
    quarantined,
    census,
    share,
    close: () => stores.close(),
  };
}

function withoutFlags(note: MemoryNoteMetadata): MemoryNoteMetadata {
  const { flags: _flags, ...rest } = note;
  return rest;
}
