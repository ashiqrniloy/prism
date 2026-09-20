import { randomBytes } from "node:crypto";
import type { MemoryFabric } from "../fabric/types.js";
import { loadScopedLedger, saveScopedLedger } from "./ledger.js";
import { gateScopedMemoryContent } from "./trust.js";

export type ScopedMemoryReviewer = (prompt: string) => Promise<unknown>;

export interface ScopedMemoryReviewResult {
  readonly proposed: number;
  readonly written: number;
  readonly staged: number;
  readonly status: { readonly candidate: number };
}

interface ScopedMemoryReviewProposal {
  readonly kind: "fact" | "procedure";
  readonly content: string;
  readonly sourceEntryIds: readonly string[];
}

const EMPTY: ScopedMemoryReviewResult = Object.freeze({
  proposed: 0,
  written: 0,
  staged: 0,
  status: Object.freeze({ candidate: 0 }),
});

const PROPOSAL_KEYS = new Set(["kind", "content", "sourceEntryIds"]);
const MAX_DIGEST_CHARS = 24_000;
const RECENT_VERBATIM = 8;

const DEFAULT_PROMPT = `Extract durable memory from the session digest.

Default output is []. Most sessions update nothing.
Write only when the digest shows a user correction, an error then recovery, a technique reused in the session, or an explicit "remember this".
Do not write source-cited knowledge (files, docs, papers). Do not invent content.

Return a JSON array of objects with exactly these keys:
{"kind":"fact"|"procedure","content":string,"sourceEntryIds":non-empty string[]}
Prefer kind "fact".`;

function coerceJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function asProposal(item: unknown): ScopedMemoryReviewProposal | undefined {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
  const rec = item as Record<string, unknown>;
  for (const key of Object.keys(rec)) if (!PROPOSAL_KEYS.has(key)) return undefined;
  if (rec.kind !== "fact" && rec.kind !== "procedure") return undefined;
  if (typeof rec.content !== "string" || rec.content.length === 0) return undefined;
  if (!Array.isArray(rec.sourceEntryIds) || rec.sourceEntryIds.length === 0) return undefined;
  if (!rec.sourceEntryIds.every((id) => typeof id === "string" && id.length > 0)) return undefined;
  return { kind: rec.kind, content: rec.content, sourceEntryIds: rec.sourceEntryIds };
}

function parseProposals(raw: unknown): readonly ScopedMemoryReviewProposal[] | undefined {
  const value = coerceJson(raw);
  if (!Array.isArray(value)) return undefined;
  const out: ScopedMemoryReviewProposal[] = [];
  for (const item of value) {
    const proposal = asProposal(item);
    if (!proposal) return undefined;
    out.push(proposal);
  }
  return out;
}

function entryLine(entry: unknown, verbatim: boolean): string {
  if (typeof entry === "string") return entry;
  if (entry === null || typeof entry !== "object") return String(entry);
  const rec = entry as Record<string, unknown>;
  const id = typeof rec.id === "string" && rec.id ? rec.id : "?";
  if (!verbatim) return `[${id}] ${typeof rec.kind === "string" ? rec.kind : "entry"}`;
  if (typeof rec.summary === "string" && rec.summary) return `[${id}] ${rec.summary}`;
  if (rec.message !== null && typeof rec.message === "object") {
    const message = rec.message as Record<string, unknown>;
    const role = typeof message.role === "string" ? message.role : "message";
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    return `[${id}] ${role}: ${content}`;
  }
  return `[${id}] ${typeof rec.kind === "string" ? rec.kind : "entry"}`;
}

function formatDigest(input: unknown): string {
  let text: string;
  if (typeof input === "string") text = input;
  else if (Array.isArray(input)) {
    const recent = input.slice(-RECENT_VERBATIM);
    const older = input.slice(0, Math.max(0, input.length - RECENT_VERBATIM));
    text = [...older.map((entry) => entryLine(entry, false)), ...recent.map((entry) => entryLine(entry, true))].join("\n");
  } else text = "";
  return text.length > MAX_DIGEST_CHARS ? text.slice(-MAX_DIGEST_CHARS) : text;
}

export async function reviewScopedSession(input: {
  readonly fabric: MemoryFabric;
  readonly ledgerFile: string;
  readonly approval: "off" | "staged";
  readonly digest: unknown;
  readonly reviewer: ScopedMemoryReviewer;
  readonly prompt?: string;
  readonly now?: number;
}): Promise<ScopedMemoryReviewResult> {
  const prompt = `${input.prompt ?? DEFAULT_PROMPT}\n\n<digest>\n${formatDigest(input.digest)}\n</digest>`;
  let raw: unknown;
  try {
    raw = await input.reviewer(prompt);
  } catch {
    return EMPTY;
  }
  const proposals = parseProposals(raw);
  if (!proposals || proposals.length === 0) return EMPTY;
  for (const proposal of proposals) gateScopedMemoryContent(proposal.content);

  const nowIso = new Date(input.now ?? Date.now()).toISOString();
  if (input.approval === "staged") {
    const ledger = await loadScopedLedger(input.ledgerFile);
    await saveScopedLedger(input.ledgerFile, {
      notes: ledger.notes,
      pending: [
        ...ledger.pending,
        ...proposals.map((proposal) => ({ kind: "review", id: randomBytes(8).toString("hex"), createdAt: nowIso, proposal })),
      ],
      ...(ledger.stats ? { stats: ledger.stats } : {}),
    });
    return { proposed: proposals.length, written: 0, staged: proposals.length, status: { candidate: 0 } };
  }

  const ids: string[] = [];
  for (const proposal of proposals) {
    const note = await input.fabric.remember({
      kind: proposal.kind,
      content: proposal.content,
      sourceEntryIds: proposal.sourceEntryIds,
      consent: { visible: true, source: "agent" },
    });
    ids.push(note.id);
  }

  const ledger = await loadScopedLedger(input.ledgerFile);
  const notes = { ...ledger.notes };
  let writes = ledger.stats?.writes ?? 0;
  let duplicates = ledger.stats?.duplicates ?? 0;
  for (const id of ids) {
    const prev = notes[id];
    writes += 1;
    if (prev) duplicates += 1;
    notes[id] = {
      uses: prev?.uses ?? 0,
      status: prev?.status ?? "candidate",
      createdAt: prev?.createdAt ?? nowIso,
      ...(prev?.lastUsedAt ? { lastUsedAt: prev.lastUsedAt } : {}),
      ...(prev?.promotedAt ? { promotedAt: prev.promotedAt } : {}),
    };
  }
  await saveScopedLedger(input.ledgerFile, { notes, pending: ledger.pending, stats: { writes, duplicates } });
  let candidate = 0;
  for (const id of new Set(ids)) if (notes[id]?.status === "candidate") candidate += 1;
  return { proposed: proposals.length, written: ids.length, staged: 0, status: { candidate } };
}
