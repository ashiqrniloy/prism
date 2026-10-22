/**
 * Delivery tier 1 (plan 188.5 Task 1): the pinned core.
 *
 * A small always-present slice of long-term memory — verified notes of the durable kinds, ordered by
 * storage strength S with pinned notes first — rendered into the prompt prefix. It is rebuilt only
 * when a note it could show changes, so a turn with no such change sends byte-identical bytes and the
 * provider cache survives (plan 184). It makes no model call: one metadata scan per scope, then one
 * bounded `get` for the text of the notes that fit the budget.
 */
import { resolveRedactor, type SecretRedactor } from "@arnilo/prism";
import {
  type Memory,
  MemoryValidationError,
  type MemoryVectorMetadataPage,
  type MemoryVectorMetadataRow,
  redactJson,
  type VectorScanMetadataQuery,
} from "@arnilo/prism-memory-core";
import { memoryWriteVersion } from "../directory.js";
import { isActiveNote, normalizeNoteStatus, type StorageWeights, storageStrength } from "../lifecycle/index.js";
import { type MemoryNoteKind, type MemoryNoteMetadata, parseMemoryNoteMetadata } from "../types.js";

/** Scope levels the core draws from, in the order the block lists them. */
export type FabricCoreScope = "user" | "project";

export interface MemoryFabricCoreConfig {
  /** Ceiling on the rendered block. Default 600, at most {@link HARD_CORE_TOKENS}. */
  readonly maxTokens?: number;
  /** Scopes to include. Default both; `user` always renders first. */
  readonly scopes?: readonly FabricCoreScope[];
}

export interface ResolvedFabricCoreOptions {
  readonly maxTokens: number;
  readonly scopes: readonly FabricCoreScope[];
}

export const HARD_CORE_TOKENS = 1_000;
export const DEFAULT_CORE_OPTIONS: ResolvedFabricCoreOptions = Object.freeze({
  maxTokens: 600,
  scopes: Object.freeze(["user", "project"]) as readonly FabricCoreScope[],
});

/** One `scanMetadata` page per scope: the core is a top-S slice, not a full census. */
const CORE_SCAN_PAGE = 500;
const CORE_GET_BATCH = 100;
const CORE_KINDS: ReadonlySet<string> = new Set<MemoryNoteKind>(["preference", "fact", "procedure"]);

export function resolveFabricCoreOptions(
  input: boolean | MemoryFabricCoreConfig | undefined,
  defaultOn: boolean,
): false | ResolvedFabricCoreOptions {
  if (input === false || (input === undefined && !defaultOn)) return false;
  const config = input === true || input === undefined ? {} : input;
  const maxTokens = config.maxTokens ?? DEFAULT_CORE_OPTIONS.maxTokens;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > HARD_CORE_TOKENS) {
    throw new MemoryValidationError(`core.maxTokens must be an integer in [1,${HARD_CORE_TOKENS}]`);
  }
  const requested = config.scopes ?? DEFAULT_CORE_OPTIONS.scopes;
  if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length) {
    throw new MemoryValidationError('core.scopes must be a non-empty list of "user" and "project"');
  }
  for (const level of requested) {
    if (level !== "user" && level !== "project")
      throw new MemoryValidationError('core.scopes must be a non-empty list of "user" and "project"');
  }
  return { maxTokens, scopes: DEFAULT_CORE_OPTIONS.scopes.filter((level) => requested.includes(level)) };
}

/** One active scope the core reads, and the memory that holds it. */
export interface FabricCoreScopeBinding {
  readonly level: FabricCoreScope;
  readonly memory: Memory;
}

export interface CreateFabricCoreOptions {
  readonly scopes: readonly FabricCoreScopeBinding[];
  readonly options: ResolvedFabricCoreOptions;
  /** The store's metadata scan; the core needs no text from a listing, only ids and metadata. */
  readonly scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>;
  readonly storageWeights?: StorageWeights;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  /**
   * Write a scope's derived `core.md` (the markdown store has one; the others have no file layout).
   * A failure is reported once and never fails the turn.
   */
  readonly writeFile?: (scope: { readonly tenantId: string; readonly resourceId: string }, content: string) => Promise<void>;
  readonly notify?: (message: string) => void;
}

/** The rendered block, without the context-block envelope the caller adds. */
export interface FabricCoreBlock {
  readonly content: string;
  readonly tokens: number;
  /** The notes the block shows, so later tiers can deduplicate against it. */
  readonly itemIds: readonly string[];
}

export interface FabricCore {
  /** The cached block; recomputed only after a write bumped a scope's version. */
  block(signal?: AbortSignal): Promise<FabricCoreBlock | undefined>;
  /** Force the next `block` to recompute (writes that bypass the memory instance). */
  invalidate(): void;
}

interface CoreLine {
  readonly id: string;
  readonly line: string;
  readonly tokens: number;
}

/** The heading a scope's core line starts with; a person sees the same text in `core.md`. */
export function coreHeading(label: string): string {
  return `Core memory (${label}):`;
}

/** `projects/<slug>--<id8>` → `<slug>`; a resource that is not a project id stays `project`. */
function coreLabel(binding: FabricCoreScopeBinding): string {
  if (binding.level === "user") return "user";
  const resource = binding.memory.scope.resourceId;
  const slug = /^projects\/(.+?)(?:--[0-9a-f]{8})?$/.exec(resource)?.[1];
  return resource.startsWith("projects/") && slug ? `project ${slug}` : "project";
}

/**
 * Selection and order for one scope: verified, active, unflagged notes of the core kinds, pinned
 * first, then descending S, ties by id so the order is stable across rebuilds.
 */
export function coreCandidateRows(
  rows: readonly MemoryVectorMetadataRow[],
  weights?: StorageWeights,
): readonly { readonly id: string; readonly metadata: MemoryNoteMetadata; readonly storage: number }[] {
  const found: { id: string; metadata: MemoryNoteMetadata; storage: number }[] = [];
  for (const row of rows) {
    const metadata = parseMemoryNoteMetadata(row.metadata);
    if (metadata === undefined) continue;
    if (normalizeNoteStatus(row.metadata?.status as string | undefined, "verified") !== "verified") continue;
    if (!CORE_KINDS.has(metadata.kind)) continue;
    if ((metadata.flags?.length ?? 0) > 0) continue;
    if (!isActiveNote(metadata)) continue;
    found.push({ id: row.id, metadata, storage: storageStrength(metadata, weights) });
  }
  return found.sort(
    (left, right) =>
      Number(right.metadata.pinned === true) - Number(left.metadata.pinned === true) ||
      right.storage - left.storage ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** One scope's core body and the budget its notes spend; `undefined` when the scope holds nothing. */
export interface FabricCoreScopeRender {
  readonly level: FabricCoreScope;
  readonly label: string;
  readonly scope: { readonly tenantId: string; readonly resourceId: string };
  readonly lines: readonly CoreLine[];
  readonly content?: string;
  readonly tokens: number;
  readonly itemIds: readonly string[];
}

/** One scope's `core.md` body: the heading plus the note lines, exactly what the model reads of it. */
export function renderCore(label: string, lines: readonly CoreLine[]): { readonly content: string; readonly tokens: number } | undefined {
  if (lines.length === 0) return undefined;
  const content = `${coreHeading(label)} ${lines.map((line) => line.line).join(" ")}`;
  return { content, tokens: Math.ceil(content.length / 4) };
}

/** Take the longest prefix of `lines` that fits `budget`; a note that does not fit is skipped, not cut. */
function takeLines(lines: readonly CoreLine[], budget: number): { readonly lines: readonly CoreLine[]; readonly tokens: number } {
  const kept: CoreLine[] = [];
  let tokens = 0;
  for (const line of lines) {
    if (tokens + line.tokens > budget) continue;
    kept.push(line);
    tokens += line.tokens;
  }
  return { lines: kept, tokens };
}

export function createFabricCore(input: CreateFabricCoreOptions): FabricCore {
  const redactor = resolveRedactor(input.redactor, input.secrets);
  const redact = (text: string): string => redactJson(text, redactor).replace(/\s+/g, " ").trim();
  const { maxTokens } = input.options;
  const bindings = input.options.scopes.flatMap((level) => {
    const binding = input.scopes.find((scope) => scope.level === level);
    return binding === undefined ? [] : [binding];
  });
  let forced = 0;
  let warnedWrite = false;
  let cached: { readonly key: string; readonly value: FabricCoreBlock | undefined } | undefined;

  /** The ordered note lines of one scope, capped at the whole core budget. */
  async function scopeLines(binding: FabricCoreScopeBinding, signal: AbortSignal | undefined): Promise<readonly CoreLine[]> {
    const { memory } = binding;
    const query = {
      scope: { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId },
      limit: CORE_SCAN_PAGE,
      ...(signal === undefined ? {} : { signal }),
    };
    const page = await input.scanMetadata(query);
    const ordered = coreCandidateRows(page.rows, input.storageWeights);
    const lines: CoreLine[] = [];
    let tokens = 0;
    for (let index = 0; index < ordered.length && tokens < maxTokens; ) {
      const batch = ordered.slice(index, index + CORE_GET_BATCH);
      index += batch.length;
      // A revoked, invalidated, or unreadable note has no text here and never enters the core.
      const records = await memory.get(
        batch.map((row) => row.id),
        signal === undefined ? {} : { signal },
      );
      const text = new Map(records.map((record) => [record.id, record.text]));
      for (const row of batch) {
        const body = text.get(row.id);
        if (body === undefined) continue;
        const line = `[${row.id}] ${redact(body)}`;
        const cost = Math.ceil((line.length + 1) / 4);
        if (tokens + cost > maxTokens) continue;
        lines.push({ id: row.id, line, tokens: cost });
        tokens += cost;
      }
    }
    return lines;
  }

  async function compute(signal: AbortSignal | undefined): Promise<FabricCoreBlock | undefined> {
    if (bindings.length === 0) return undefined;
    const lineLists = await Promise.all(bindings.map((binding) => scopeLines(binding, signal)));
    // Split the budget evenly, the first scope (user) taking the remainder; unused budget flows to
    // the other scope because each fill only spends what its own notes need.
    const share = Math.floor(maxTokens / bindings.length);
    const renders: FabricCoreScopeRender[] = [];
    let remaining = maxTokens;
    for (const [index, binding] of bindings.entries()) {
      const label = coreLabel(binding);
      const nominal = share + (index === 0 ? maxTokens - share * bindings.length : 0);
      const headingTokens = Math.ceil((coreHeading(label).length + 1) / 4);
      const taken = takeLines(lineLists[index]!, Math.min(remaining, nominal) - headingTokens);
      const rendered = renderCore(label, taken.lines);
      renders.push({
        level: binding.level,
        label,
        scope: { tenantId: binding.memory.scope.tenantId, resourceId: binding.memory.scope.resourceId },
        lines: taken.lines,
        ...(rendered === undefined ? {} : { content: rendered.content }),
        tokens: rendered?.tokens ?? 0,
        itemIds: taken.lines.map((line) => line.id),
      });
      remaining -= rendered?.tokens ?? 0;
    }
    // The other direction: a scope that stopped short of its half leaves budget for the first scope.
    if (remaining > 0) {
      for (const [index] of bindings.entries()) {
        const current = renders[index]!;
        if (current.lines.length === lineLists[index]!.length) continue;
        const headingTokens = Math.ceil((coreHeading(current.label).length + 1) / 4);
        const taken = takeLines(lineLists[index]!, current.tokens + remaining - headingTokens);
        const rendered = renderCore(current.label, taken.lines);
        remaining -= (rendered?.tokens ?? 0) - current.tokens;
        renders[index] = {
          ...current,
          lines: taken.lines,
          ...(rendered === undefined ? { content: undefined } : { content: rendered.content }),
          tokens: rendered?.tokens ?? 0,
          itemIds: taken.lines.map((line) => line.id),
        };
        if (remaining <= 0) break;
      }
    }
    const shown = renders.filter((render) => render.content !== undefined);
    if (input.writeFile !== undefined) await writeCoreFiles(renders);
    if (shown.length === 0) return undefined;
    const content = shown.map((render) => render.content).join("\n");
    return {
      content,
      tokens: Math.ceil(content.length / 4),
      itemIds: shown.flatMap((render) => [...render.itemIds]),
    };
  }

  async function writeCoreFiles(renders: readonly FabricCoreScopeRender[]): Promise<void> {
    try {
      for (const render of renders) await input.writeFile!(render.scope, render.content ?? "");
    } catch (error) {
      if (warnedWrite) return;
      warnedWrite = true;
      input.notify?.(`memory-fabric: writing core.md failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return {
    async block(signal) {
      const key = `${bindings.reduce((sum, binding) => sum + memoryWriteVersion(binding.memory), 0)}:${forced}`;
      if (cached?.key === key) return cached.value;
      // Keyed by the version read before the query, so a write landing mid-compute is picked up next time.
      const value = await compute(signal);
      cached = { key, value };
      return value;
    },
    invalidate() {
      forced += 1;
    },
  };
}
