import { UNTRUSTED_EXTERNAL_TRUST, type Message, type ToolResult } from "@arnilo/prism";

import type { LedgerEntry, ResearchState } from "./ledger.js";

const MARKER = /\[\[cite:([A-Za-z0-9_-]+)\]\]/g;
export const NO_CITATIONS = "<no-citations>";

export function lastAssistantText(history: readonly Message[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== "assistant") continue;
    return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  }
  return "";
}

export function citationIds(text: string): readonly string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(MARKER)) {
    const id = match[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function unresolvedIds(ids: readonly string[], entries: readonly LedgerEntry[], requireCitations: boolean): readonly string[] {
  const known = new Set(entries.map((entry) => entry.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length === 0 && ids.length === 0 && requireCitations) return [NO_CITATIONS];
  return missing;
}

export function citationDecision(
  state: ResearchState,
  unresolved: readonly string[],
  maxRepairs: number,
): { readonly state: ResearchState; readonly continueReason?: string } {
  if (unresolved.length === 0) {
    return { state: { ...state, verdict: "passed", unresolved: [] } };
  }
  if (state.repairs < maxRepairs) {
    return {
      state: { ...state, repairs: state.repairs + 1, unresolved },
      continueReason: `Unresolved citations: ${unresolved.join(", ")}. Cite only ledger ids from ledger: S<n> lines, using cite.`,
    };
  }
  return { state: { ...state, verdict: "failed", unresolved } };
}

export function withLedgerLine(result: ToolResult, line: string): ToolResult {
  const note = { type: "text" as const, text: line };
  // Untrusted results reach the model as their text content (the kernel envelope), so the line rides
  // the text. Trusted results still drop text when `value` is set, so they keep the copy in `value`.
  const untrusted = result.metadata?.trust === UNTRUSTED_EXTERNAL_TRUST;
  const value =
    !untrusted && typeof result.value === "object" && result.value !== null && !Array.isArray(result.value)
      ? { ...result.value, ledger: line }
      : result.value;
  return {
    toolCallId: result.toolCallId,
    name: result.name,
    content: [...(result.content ?? []), note],
    ...(value === undefined ? {} : { value }),
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
  };
}

export function citeMarker(id: string): string {
  return `[[cite:${id}]]`;
}
