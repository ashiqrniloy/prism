/**
 * Coding-decisions capture and confirmation (plan 202 Task 11).
 *
 * Capture is lexical: a user turn with a lasting-decision cue becomes a `proposed` note, never an
 * `active` one. Activation is a person's answer through `host.ui` or 188.4's use-based verification
 * (two sessions, no correction). No model call is made here. Tool output is never an input: only the
 * archived user turn is passed in.
 */
import { createHash } from "node:crypto";
import type { HostUi } from "@arnilo/prism";
import { scanScopedMemoryContent } from "../scoped/trust.js";
import type { MemoryFabricRememberInput, MemoryNoteMetadata } from "../types.js";

const DECISION_CUE =
  /\b(?:from now on|always|(?<!\b(?:i|we|you|they|he|she|have|has|had)\s)never|we(?:'ve| have)? decided|use\b[^.!?\n]{0,200}\binstead of|no[,:])/iu;

/** One sentence, capitalised; strips the cue lead-in that carries no rule content. */
function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = /[.!?](?:\s|$)/.exec(clean);
  const first = (end === null ? clean : clean.slice(0, end.index + 1)).trim();
  return first.length === 0 ? first : first[0]!.toUpperCase() + first.slice(1);
}

/** `for src/payments/**` / `in src/payments` → a path scope; a bare directory becomes `dir/**`. */
function pathScope(rule: string): { scope: "path"; appliesTo: readonly string[] } | undefined {
  const match = /\b(?:for|in|under)\s+((?:\.\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_./*-]+)/iu.exec(rule);
  if (match === null) return undefined;
  const raw = match[1]!.replace(/^\.\//, "").replace(/[.,;:]$/, "");
  if (raw.length === 0 || raw.startsWith("/") || raw.includes("..")) return undefined;
  const glob = raw.includes("*") ? raw : `${raw.replace(/\/$/, "")}/**`;
  return { scope: "path", appliesTo: [glob] };
}

/**
 * Extract a proposed decision from one user turn. `undefined` when no cue is present or the trust
 * scan refuses the rule or its rationale.
 */
export function captureDecision(userText: string, sourceEntryIds: readonly string[]): MemoryFabricRememberInput | undefined {
  const line = userText.split(/\r?\n/).find((candidate) => DECISION_CUE.test(candidate));
  if (line === undefined) return undefined;
  const cue = DECISION_CUE.exec(line);
  if (cue === null) return undefined;
  let rule = line.slice(cue.index);
  rule = rule.replace(/^\s*from now on[,:]?\s*/iu, "").replace(/^\s*we(?:'ve| have)? decided(?: that)?[,:]?\s*/iu, "");
  rule = rule.replace(/^\s*(?:no|actually)[,:]\s*/iu, "");
  const because = /\s+because\s+/iu.exec(rule);
  const rationale = because === null ? "stated as a lasting decision" : sentence(rule.slice(because.index + because[0].length));
  if (because !== null) rule = rule.slice(0, because.index);
  const content = sentence(rule);
  if (content.length === 0) return undefined;
  const scan = scanScopedMemoryContent(`${content}\n${rationale}`);
  if (!scan.ok) return undefined;
  const scoped = pathScope(content);
  return {
    kind: "decision",
    content,
    rationale,
    ...(scoped === undefined ? { scope: "project" as const } : scoped),
    decisionStatus: "proposed",
    sourceEntryIds: [...sourceEntryIds],
  };
}

/** Stable id makes a repeated archive pass idempotent without a second lookup index. */
export function decisionNoteId(sessionId: string, userEntryId: string): string {
  return createHash("sha256").update(`decision\0${sessionId}\0${userEntryId}`).digest("hex").slice(0, 12);
}

/** Only a confirmed, verified decision is delivered passively. */
export function isDecisionDeliverable(metadata: Pick<MemoryNoteMetadata, "kind" | "decisionStatus" | "status">): boolean {
  return metadata.kind !== "decision" || (metadata.decisionStatus === "active" && metadata.status !== "candidate");
}

export interface DecisionProposal {
  readonly id: string;
  readonly text: string;
  readonly rationale?: string;
}

/**
 * One batched `host.ui` confirmation for the proposals of this turn. Unavailable, denied, dismissed,
 * malformed, or throwing UI answers all leave the proposals `proposed` (fail closed).
 */
export async function confirmDecisionProposals(ui: HostUi | undefined, proposals: readonly DecisionProposal[]): Promise<readonly string[]> {
  if (ui === undefined || proposals.length === 0) return [];
  try {
    const answer = await ui.request({
      kind: "confirm",
      title: proposals.length === 1 ? "Activate this memory decision?" : `Activate ${proposals.length} memory decisions?`,
      detail: proposals
        .map((proposal) => `[${proposal.id}] ${proposal.text}${proposal.rationale ? ` — why: ${proposal.rationale}` : ""}`)
        .join("\n"),
    });
    return answer.status === "answered" && answer.value === true ? proposals.map((proposal) => proposal.id) : [];
  } catch {
    return [];
  }
}
