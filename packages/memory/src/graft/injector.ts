import { readFileSync } from "node:fs";

import type { ContextBlock, ContextProvider, InstructionContribution, InstructionInjector, Message } from "@arnilo/prism";

import type { GraftFreshness } from "./types.js";

/** graft's own per-turn gate; shorter prompts are too vague to retrieve against. */
export const MIN_PROMPT_CHARS = 12;
/** ponytail: seen-set is a capped array scanned linearly — LRU map only if sessions exceed 256 pushes. */
export const SEEN_CAP = 256;
export const ORIENTATION_MAX_BYTES = 8 * 1024;
/** Context-channel ceiling (ponytail injected-instructions parity). */
export const PACK_BLOCK_CEILING_BYTES = 32 * 1024;

/** Pure gate: latest user text must exist and sit inside [min, max] chars. */
export function shouldQuery(text: string | undefined, options: { minPromptChars?: number; maxPromptChars?: number } = {}): boolean {
  if (!text) return false;
  const min = options.minPromptChars ?? MIN_PROMPT_CHARS;
  const max = options.maxPromptChars ?? Number.POSITIVE_INFINITY;
  return text.length >= min && text.length <= max;
}

/** Latest user message text (string or text-block content). Local copy of the ponytail helper. */
export function latestUserText(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    for (const block of message.content ?? []) {
      if (block?.type === "text" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
    }
    return undefined;
  }
  return undefined;
}

/** Tolerant node extraction: graft's ask JSON shape has shifted across 0.x; accept the common keys. */
function extractNodes(askResult: unknown): Array<Record<string, unknown>> {
  if (typeof askResult !== "object" || askResult === null) return [];
  const record = askResult as Record<string, unknown>;
  for (const key of ["nodes", "results", "matches", "hits"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((node) => typeof node === "object" && node !== null) as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function nodeId(node: Record<string, unknown>): string {
  for (const key of ["id", "symbol", "name"]) {
    const value = node[key];
    if (typeof value === "string" && value !== "") return value;
  }
  const path = typeof node.path === "string" ? node.path : typeof node.file === "string" ? node.file : "";
  const line = typeof node.line === "number" ? `:${node.line}` : "";
  return `${path}${line}`;
}

function locator(node: Record<string, unknown>): string {
  const path = typeof node.path === "string" && node.path !== "" ? node.path : typeof node.file === "string" ? node.file : "?";
  const line = typeof node.line === "number" ? `:${node.line}` : "";
  return `${path}${line}`;
}

export interface PointerPack {
  readonly blocks: readonly ContextBlock[];
  /** Ids newly emitted this turn, oldest first. */
  readonly freshIds: readonly string[];
  /** Approx tokens skipped because every hit was already shown this session. */
  readonly savedTokensApprox: number;
}

/**
 * Pure formatter: pointers-only pack (title + file:line + wikilink target).
 * Never inlines source bodies — per-turn injection stays cheap by construction.
 */
export function formatPointerPack(askResult: unknown, seen: ReadonlySet<string>): PointerPack {
  const nodes = extractNodes(askResult);
  const lines: string[] = [];
  const freshIds: string[] = [];
  let savedTokensApprox = 0;

  for (const node of nodes) {
    const id = nodeId(node);
    if (id === "") continue;
    if (seen.has(id)) {
      savedTokensApprox += Math.ceil(JSON.stringify(node).length / 4);
      continue;
    }
    const title = typeof node.title === "string" && node.title !== "" ? node.title : id;
    const kind = typeof node.kind === "string" ? ` (${node.kind})` : "";
    lines.push(`- ${title}${kind} — ${locator(node)} — [[${id}]]`);
    freshIds.push(id);
  }

  if (lines.length === 0) return { blocks: [], freshIds: [], savedTokensApprox };

  let body = ["Graft graph pointers for this request (locators only — open files before editing):", ...lines].join("\n");
  // ponytail: truncation instead of pagination — three pointers never approach 32 KiB today.
  if (Buffer.byteLength(body, "utf8") > PACK_BLOCK_CEILING_BYTES) {
    body = `${body.slice(0, PACK_BLOCK_CEILING_BYTES)}\n… (truncated)`;
  }

  return {
    blocks: [
      {
        id: "graft-context",
        title: "graft context graph",
        content: body,
        priority: 40,
        metadata: { source: "graft-graph", pointerCount: freshIds.length },
      },
    ],
    freshIds,
    savedTokensApprox,
  };
}

export interface SeenState {
  readonly ids: ReadonlySet<string>;
  readonly savedTokensApprox: number;
}

/** Merge fresh ids into the seen set, dropping oldest beyond the cap. */
export function nextSeen(previous: SeenState, freshIds: readonly string[]): readonly string[] {
  const merged = [...previous.ids, ...freshIds];
  return merged.slice(Math.max(0, merged.length - SEEN_CAP));
}

export interface GraftContextProviderDeps {
  runAsk(query: string, sessionId?: string): Promise<unknown | null>;
  getSeen(sessionId?: string): Promise<SeenState>;
  onEmitted(freshIds: readonly string[], savedTokensApprox: number, sessionId?: string): void;
}

/** Thin async shell around the pure gates/formatter. Retrieval failure ⇒ empty contribution, never a broken turn. */
export function createGraftContextProvider(deps: GraftContextProviderDeps): ContextProvider {
  return {
    name: "graft-context",
    async resolve(ctx) {
      try {
        const text = latestUserText(ctx.messages);
        if (!shouldQuery(text)) return [];
        const seen = await deps.getSeen(ctx.sessionId);
        const askResult = await deps.runAsk(text!, ctx.sessionId);
        if (askResult === null) return [];
        const pack = formatPointerPack(askResult, seen.ids);
        if (pack.blocks.length === 0) return [];
        deps.onEmitted(pack.freshIds, pack.savedTokensApprox, ctx.sessionId);
        return pack.blocks;
      } catch {
        return []; // includes signal aborts
      }
    },
  };
}

/** Synchronous first-turn orientation: bounded INDEX.md + staleness banner. No CLI ask. */
const TRUNCATION_SUFFIX = "\n… (truncated)";

export function loadOrientation(
  indexPath: string,
  freshness: GraftFreshness | undefined,
  maxBytes = ORIENTATION_MAX_BYTES,
): string | undefined {
  let index: string;
  try {
    const raw = readFileSync(indexPath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > maxBytes) {
      // ponytail: byte-accurate cut including the suffix — one readFileSync, no streaming.
      index = `${raw.slice(0, Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_SUFFIX, "utf8")))}${TRUNCATION_SUFFIX}`;
    } else {
      index = raw;
    }
  } catch {
    return undefined;
  }
  if (freshness && !freshness.fresh) {
    const drift = (freshness.missing ?? 0) + (freshness.stale ?? 0);
    const detail = drift > 0 ? ` (${drift} missing/stale entries)` : "";
    index = `[graft] graph may be stale${detail}; run /graft build to refresh.\n\n${index}`;
  }
  return index;
}

export function createGraftOrientationInjector(getOrientation: () => string | undefined): InstructionInjector {
  return {
    name: "graft-orient",
    description: "First-turn orientation from graft/INDEX.md with staleness banner.",
    apply(): InstructionContribution {
      const instructions = getOrientation();
      return instructions ? { when: "first_turn", instructions } : { when: "first_turn" };
    },
  };
}
