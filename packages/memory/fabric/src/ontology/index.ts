/**
 * The ontology index as the write path and the prompts see it (plan 207 Task 3): which subjects a scope has,
 * the token map that binds a new T1 note to one of them, and the pinned lists the extractor prompt and the
 * memory directory show.
 *
 * Three rules shape this module:
 * - Binding is best effort. A note is evidence first: an index that cannot load (a store without
 *   `scanMetadata`) leaves the note unbound, it never fails the write. An abort still propagates.
 * - Every prompt-visible list is pinned per session epoch, the same epoch the pinned prefix uses (the sum of the
 *   scopes' retraction versions). A concept written mid-epoch is additive and does not change what the model saw.
 * - Binding never crosses scope. A `user` note binds only a `user` subject, a `project` or `path` note only a
 *   `project` subject.
 */
import type { MemoryNoteScope } from "../types.js";
import { type FabricScopeLevel } from "../types.js";
import { createSubjectMatcher, resolveBindThreshold, type SubjectMatcher } from "./bind.js";
import type { ConceptIndex, ConceptRow } from "./state.js";

/** Subjects one scope's extractor prompt or directory line may name. */
export const MAX_SHOWN_SUBJECTS = 64;
export const MAX_SHOWN_SUBJECT_ALIASES = 4;
/** The extractor prompt's subject block, in characters (about 1,500 tokens), shared across the scopes shown. */
export const MAX_SUBJECT_PROMPT_CHARS = 6_000;
const MAX_PINNED_SESSIONS = 64;

/** One subject as a prompt or the directory shows it. */
export interface SubjectListing {
  readonly subject: string;
  readonly title: string;
  /** At most {@link MAX_SHOWN_SUBJECT_ALIASES}. */
  readonly aliases: readonly string[];
  /** Recorded uses of the concept, then the notes it cites: the order the lists are shown in. */
  readonly uses: number;
  readonly evidence: number;
}

export interface SubjectScopeListing {
  readonly level: FabricScopeLevel;
  readonly subjects: readonly SubjectListing[];
}

export interface FabricSubjects {
  /**
   * The subject a new note of `scope` binds to by its text and keys; `undefined` when no concept exists, none
   * matches strongly enough, or several do. Never calls a model.
   */
  bindingFor(scope: MemoryNoteScope, text: string, keys: readonly string[], signal?: AbortSignal): Promise<string | undefined>;
  /** A note now cites `subject`: its concept needs another pass. Best effort, and a no-op without that concept. */
  noteBound(scope: MemoryNoteScope, subject: string, signal?: AbortSignal): Promise<void>;
  /** Live: the scope's subjects, most used first. */
  listing(level: FabricScopeLevel, signal?: AbortSignal): Promise<readonly SubjectListing[]>;
  /** Pinned per session epoch: every scope's top subjects, as the extractor prompt shows them. */
  snapshot(sessionId: string, signal?: AbortSignal): Promise<readonly SubjectScopeListing[]>;
  /** Drop a session's pin (its session closed). */
  forget(sessionId: string): void;
}

export interface CreateFabricSubjectsDeps {
  /** The concept index of a scope level, or `undefined` when that level is not readable here. */
  readonly index: (level: FabricScopeLevel) => ConceptIndex | undefined;
  readonly levels: () => readonly FabricScopeLevel[];
  /** Flag the concept for another pass: new evidence arrived. */
  readonly markDirty: (level: FabricScopeLevel, row: ConceptRow, signal?: AbortSignal) => Promise<void>;
  /** The epoch key: the sum of the scopes' retraction versions. */
  readonly epoch: () => number;
  readonly bindThreshold?: number;
}

/** The ontology level a note scope reads: a `path` note lives in the project's memory. */
export function ontologyLevel(scope: MemoryNoteScope): FabricScopeLevel {
  return scope === "path" ? "project" : scope;
}

function listingOf(row: ConceptRow): SubjectListing {
  return {
    subject: row.subject,
    title: row.title,
    aliases: row.aliases.slice(0, MAX_SHOWN_SUBJECT_ALIASES),
    uses: row.uses,
    evidence: row.sources.length,
  };
}

/** Most used first, then best evidenced, then by name: a total order, so a pinned list is reproducible. */
function byUse(a: SubjectListing, b: SubjectListing): number {
  return b.uses - a.uses || b.evidence - a.evidence || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);
}

export function createFabricSubjects(deps: CreateFabricSubjectsDeps): FabricSubjects {
  const threshold = resolveBindThreshold(deps.bindThreshold);
  const matchers = new Map<FabricScopeLevel, { readonly revision: number; readonly matcher: SubjectMatcher }>();
  const pins = new Map<string, { readonly epoch: number; readonly lists: readonly SubjectScopeListing[] }>();

  async function matcherFor(level: FabricScopeLevel, index: ConceptIndex, signal: AbortSignal | undefined): Promise<SubjectMatcher> {
    const cached = matchers.get(level);
    if (cached !== undefined && cached.revision === index.version()) return cached.matcher;
    const rows = await index.subjects(signal);
    const matcher = createSubjectMatcher(rows, threshold);
    matchers.set(level, { revision: index.version(), matcher });
    return matcher;
  }

  const listing = async (level: FabricScopeLevel, signal?: AbortSignal): Promise<readonly SubjectListing[]> => {
    const index = deps.index(level);
    if (index === undefined) return [];
    return (await index.subjects(signal)).map(listingOf).sort(byUse);
  };

  return {
    async bindingFor(scope, text, keys, signal) {
      const level = ontologyLevel(scope);
      const index = deps.index(level);
      if (index === undefined) return undefined;
      try {
        return (await matcherFor(level, index, signal)).match(text, keys);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        return undefined;
      }
    },
    async noteBound(scope, subject, signal) {
      const level = ontologyLevel(scope);
      const index = deps.index(level);
      if (index === undefined) return;
      try {
        const row = await index.bySubject(subject, signal);
        if (row === undefined || row.dirty.includes("evidence")) return;
        await deps.markDirty(level, row, signal);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        // The note is already stored; the concept pass still finds it as pending evidence.
      }
    },
    listing,
    async snapshot(sessionId, signal) {
      const epoch = deps.epoch();
      const pinned = pins.get(sessionId);
      if (pinned !== undefined && pinned.epoch === epoch) return pinned.lists;
      const lists: SubjectScopeListing[] = [];
      for (const level of deps.levels()) {
        let subjects: readonly SubjectListing[];
        try {
          subjects = (await listing(level, signal)).slice(0, MAX_SHOWN_SUBJECTS);
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          continue;
        }
        if (subjects.length > 0) lists.push({ level, subjects });
      }
      pins.delete(sessionId);
      pins.set(sessionId, { epoch, lists });
      if (pins.size > MAX_PINNED_SESSIONS) pins.delete(pins.keys().next().value as string);
      return lists;
    },
    forget(sessionId) {
      pins.delete(sessionId);
    },
  };
}

/** The extractor prompt's subject block and the slugs that block actually names, per scope level. */
export interface SubjectPromptBlock {
  readonly prompt: Readonly<Record<string, readonly string[]>>;
  readonly slugs: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The extractor prompt's subject block: per scope a list of `slug | title | alias; alias` lines. Compact on
 * purpose (one line per subject), and cut to {@link MAX_SUBJECT_PROMPT_CHARS} shared across the scopes shown.
 * The slugs returned are exactly those named, so the parser accepts only what the model could see.
 */
export function subjectPromptBlock(lists: readonly SubjectScopeListing[]): SubjectPromptBlock | undefined {
  const shown = lists.filter((list) => list.subjects.length > 0);
  if (shown.length === 0) return undefined;
  const budget = Math.floor(MAX_SUBJECT_PROMPT_CHARS / shown.length);
  const prompt: Record<string, readonly string[]> = {};
  const slugs = new Map<string, ReadonlySet<string>>();
  for (const list of shown) {
    const lines: string[] = [];
    const named = new Set<string>();
    let used = 0;
    for (const entry of list.subjects.slice(0, MAX_SHOWN_SUBJECTS)) {
      const aliases = entry.aliases.length === 0 ? "" : ` | ${entry.aliases.join("; ")}`;
      const line = `${entry.subject} | ${entry.title}${aliases}`;
      if (used + line.length > budget) break;
      lines.push(line);
      named.add(entry.subject);
      used += line.length;
    }
    if (lines.length > 0) {
      prompt[list.level] = lines;
      slugs.set(list.level, named);
    }
  }
  return slugs.size === 0 ? undefined : { prompt, slugs };
}
