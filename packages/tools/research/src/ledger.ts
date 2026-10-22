import { redactUrl } from "./urls.js";

const MAX_TITLE = 200;
const MAX_DOC_ID = 256;

export interface LedgerEntry {
  readonly id: string;
  readonly tool: string;
  readonly toolCallId: string;
  readonly fetchedAt: string;
  readonly url?: string;
  readonly docId?: string;
  readonly title?: string;
}

export interface ResearchState {
  readonly next: number;
  readonly entries: readonly LedgerEntry[];
  readonly capped: boolean;
  readonly repairs: number;
  readonly verdict: "pending" | "passed" | "failed";
  readonly unresolved: readonly string[];
}

export const EMPTY_STATE: ResearchState = {
  next: 1,
  entries: [],
  capped: false,
  repairs: 0,
  verdict: "pending",
  unresolved: [],
};

export interface SourceHit {
  readonly key: string;
  readonly url?: string;
  readonly docId?: string;
  readonly title?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > MAX_TITLE ? trimmed.slice(0, MAX_TITLE) : trimmed;
}

function docIdOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DOC_ID) return undefined;
  return trimmed;
}

function hitFromUrl(raw: unknown, title: unknown, redactQuery: readonly string[]): SourceHit | undefined {
  if (typeof raw !== "string") return undefined;
  const url = redactUrl(raw, redactQuery);
  if (url === undefined) return undefined;
  const storedTitle = titleOf(title);
  return { key: url, url, ...(storedTitle === undefined ? {} : { title: storedTitle }) };
}

function pushHit(out: SourceHit[], seen: Set<string>, hit: SourceHit | undefined): void {
  if (hit === undefined || seen.has(hit.key)) return;
  seen.add(hit.key);
  out.push(hit);
}

/** Named fields only. Result bodies, snippets, and arguments are never read. */
export function sourcesIn(tool: string, value: unknown, redactQuery: readonly string[]): readonly SourceHit[] {
  if (!isRecord(value)) return [];
  const out: SourceHit[] = [];
  const seen = new Set<string>();
  if (tool === "web_search" && Array.isArray(value.results)) {
    for (const entry of value.results) {
      if (!isRecord(entry)) continue;
      pushHit(out, seen, hitFromUrl(entry.url, entry.title, redactQuery));
    }
    return out;
  }
  if (tool === "web_extract" && Array.isArray(value.urls)) {
    for (const entry of value.urls) pushHit(out, seen, hitFromUrl(entry, undefined, redactQuery));
    return out;
  }
  if (tool === "rag_search") {
    const lists = [value.hits, value.citations];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        const docId = docIdOf(entry.sourceId) ?? docIdOf(entry.docId);
        if (docId === undefined) continue;
        pushHit(out, seen, { key: `doc:${docId}`, docId });
      }
    }
    return out;
  }
  const urlHit = hitFromUrl(value.url, value.title, redactQuery);
  if (urlHit !== undefined) {
    pushHit(out, seen, urlHit);
    return out;
  }
  const docId = docIdOf(value.docId) ?? docIdOf(value.sourceId) ?? docIdOf(value.documentId);
  const title = titleOf(value.title);
  if (docId !== undefined) pushHit(out, seen, { key: `doc:${docId}`, docId, ...(title === undefined ? {} : { title }) });
  return out;
}

export function recordSources(
  state: ResearchState,
  hits: readonly SourceHit[],
  meta: { readonly tool: string; readonly toolCallId: string; readonly fetchedAt: string; readonly maxSources: number },
): { readonly state: ResearchState; readonly added: readonly LedgerEntry[]; readonly cappedNow: boolean } {
  if (state.capped || hits.length === 0) return { state, added: [], cappedNow: false };
  const byKey = new Map<string, string>();
  for (const entry of state.entries) byKey.set(entry.url ?? `doc:${entry.docId ?? ""}`, entry.id);
  const entries = [...state.entries];
  const added: LedgerEntry[] = [];
  let next = state.next;
  let cappedNow = false;
  for (const hit of hits) {
    const existing = byKey.get(hit.key);
    if (existing !== undefined) continue;
    if (entries.length >= meta.maxSources) {
      cappedNow = true;
      break;
    }
    const id = `S${next}`;
    next += 1;
    const entry: LedgerEntry = {
      id,
      tool: meta.tool,
      toolCallId: meta.toolCallId,
      fetchedAt: meta.fetchedAt,
      ...(hit.url === undefined ? {} : { url: hit.url }),
      ...(hit.docId === undefined ? {} : { docId: hit.docId }),
      ...(hit.title === undefined ? {} : { title: hit.title }),
    };
    entries.push(entry);
    added.push(entry);
    byKey.set(hit.key, id);
  }
  if (added.length === 0 && !cappedNow) return { state, added, cappedNow: false };
  return {
    state: { ...state, next, entries, capped: state.capped || cappedNow },
    added,
    cappedNow,
  };
}

export function ledgerLine(added: readonly LedgerEntry[]): string {
  return added.map((entry) => `ledger: ${entry.id}`).join("\n");
}
