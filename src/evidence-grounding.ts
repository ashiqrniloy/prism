import type { ContentBlock, Message, ToolResult } from "./contracts.js";
import type { HookContext, HookRejection } from "./hooks/index.js";

const MAX_EVIDENCE_FIGURES = 4096;
const MAX_EVIDENCE_DEPTH = 16;
const MAX_EVIDENCE_NODES = 16 * 1024;
const MAX_EVIDENCE_TEXT_CHARS = 128 * 1024;
const MAX_CLAIM_CHARS = 128;
const MAX_CITATION_DISTANCE = 96;
const EVIDENCE_CITATION = /\[evidence:([a-zA-Z0-9._:-]{1,128})\]/g;
const NUMERIC_CLAIM = /(?<![\p{L}\p{N}_])~?[$€£¥]?[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kKmMbB]?%?(?![\p{L}\p{N}_])/gu;

export interface ClaimGroundingEvidence {
  readonly value: number;
  /** Refer to this governed figure as `[evidence:<ref>]` immediately after a claim. */
  readonly ref?: string;
}

export interface ClaimGroundingEvidenceExtractorContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly toolResults: readonly ToolResult[];
}

/** Supplies host-governed figures without coupling this primitive to a host store or package. */
export type ClaimGroundingEvidenceExtractor = (context: ClaimGroundingEvidenceExtractorContext) => readonly ClaimGroundingEvidence[];

export interface ClaimGroundingGuardrailOptions {
  /** False makes the returned handler a no-op. */
  readonly requireEvidenceForNumbers: boolean;
  /**
   * Same-run completed tool results, read at `model.response` time. The hook payload is the assistant
   * message alone, so the host supplies the run's results; defaults to none (every number is ungrounded
   * unless `requireEvidenceForNumbers` is false).
   */
  readonly toolResults?: () => readonly ToolResult[];
  /** Defaults to same-run tool results. A host extractor may return its own governed figures. */
  readonly evidenceSources?: "tool_results" | ClaimGroundingEvidenceExtractor;
  /** Defaults to block, which is `ctx.reject(reason)`. Flag emits a `guardrail_decision` tripwire. */
  readonly onViolation?: "block" | "flag";
  /** Exact numeric equality by default; rounded accepts half the final printed unit. */
  readonly tolerance?: "exact" | "rounded";
}

type Figure = { readonly value: number; readonly ref?: string };
type EvidenceBudget = { chars: number; nodes: number };
type Claim = {
  readonly text: string;
  readonly value: number;
  readonly tolerance: number;
  readonly end: number;
  readonly contentIndex: number;
};

/**
 * Deterministic `model.response` gate for figures that must be grounded in same-run tool results
 * or host-governed evidence. It never calls a provider, store, or extractor asynchronously.
 * `onViolation: "block"` returns `ctx.reject(...)` (fails the run); `"flag"` emits a `guardrail_decision`.
 */
export function createClaimGroundingGuardrail(
  options: ClaimGroundingGuardrailOptions,
): (message: Message, context: HookContext) => HookRejection | undefined {
  const resolved = resolveOptions(options);
  return (message, context) => {
    if (!resolved.requireEvidenceForNumbers) return undefined;
    const content = message.content;
    const figures = evidenceFigures(resolved, content, context);
    const refs = new Set(figures.flatMap((figure) => (figure.ref === undefined ? [] : [figure.ref])));
    for (const claim of outputClaims(content)) {
      const block = content[claim.contentIndex];
      if (matchesEvidence(claim, figures, resolved.tolerance) || (block?.type === "text" && citesEvidence(block.text, claim.end, refs)))
        continue;
      const metadata = {
        violation: true,
        claim: claim.text.slice(0, MAX_CLAIM_CHARS),
        contentIndex: claim.contentIndex,
        start: claim.end - claim.text.length,
        end: claim.end,
      };
      if (resolved.onViolation === "block") return context.reject("claim_ungrounded");
      void context.emit({
        type: "package.event",
        sessionId: context.sessionId,
        runId: context.runId,
        package: "kernel",
        name: "guardrail.decision",
        data: { record: { guardrail: "claim-grounding", stage: "output", action: "tripwire", reason: "claim_ungrounded", metadata } },
      });
      return undefined;
    }
    return undefined;
  };
}

function resolveOptions(options: ClaimGroundingGuardrailOptions): Required<ClaimGroundingGuardrailOptions> {
  if (!options || typeof options.requireEvidenceForNumbers !== "boolean")
    throw new TypeError("Claim grounding requireEvidenceForNumbers must be boolean");
  const evidenceSources = options.evidenceSources ?? "tool_results";
  if (evidenceSources !== "tool_results" && typeof evidenceSources !== "function")
    throw new TypeError('Claim grounding evidenceSources must be "tool_results" or an extractor');
  const onViolation = options.onViolation ?? "block";
  if (onViolation !== "block" && onViolation !== "flag") throw new TypeError('Claim grounding onViolation must be "block" or "flag"');
  const tolerance = options.tolerance ?? "exact";
  if (tolerance !== "exact" && tolerance !== "rounded") throw new TypeError('Claim grounding tolerance must be "exact" or "rounded"');
  const toolResults = options.toolResults;
  if (toolResults !== undefined && typeof toolResults !== "function") throw new TypeError("Claim grounding toolResults must be a function");
  return {
    requireEvidenceForNumbers: options.requireEvidenceForNumbers,
    toolResults: () => toolResults?.() ?? [],
    evidenceSources,
    onViolation,
    tolerance,
  };
}

function evidenceFigures(
  resolved: Required<ClaimGroundingGuardrailOptions>,
  content: readonly ContentBlock[],
  context: HookContext,
): readonly Figure[] {
  if (resolved.evidenceSources !== "tool_results")
    return resolved
      .evidenceSources({
        sessionId: context.sessionId,
        runId: context.runId,
        metadata: {},
        toolResults: resolved.toolResults?.() ?? [],
      })
      .filter(validFigure)
      .slice(0, MAX_EVIDENCE_FIGURES);
  const figures: Figure[] = [];
  const budget: EvidenceBudget = { chars: MAX_EVIDENCE_TEXT_CHARS, nodes: MAX_EVIDENCE_NODES };
  for (const result of resolved.toolResults?.() ?? []) {
    if (result.error) continue;
    const ref = `tool:${result.toolCallId}`;
    collectFigures(result.value, figures, ref, new WeakSet(), 0, budget);
    for (const block of result.content ?? []) if (block.type === "text") collectTextFigures(block.text, figures, ref, budget);
  }
  return figures;
}

function validFigure(value: ClaimGroundingEvidence): value is Figure {
  return typeof value?.value === "number" && Number.isFinite(value.value) && (value.ref === undefined || citationRef(value.ref));
}

function collectFigures(
  value: unknown,
  figures: Figure[],
  ref: string,
  seen = new WeakSet<object>(),
  depth = 0,
  budget: EvidenceBudget = { chars: MAX_EVIDENCE_TEXT_CHARS, nodes: MAX_EVIDENCE_NODES },
): void {
  if (figures.length >= MAX_EVIDENCE_FIGURES || depth > MAX_EVIDENCE_DEPTH || budget.nodes-- < 1) return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) figures.push({ value, ref });
    return;
  }
  if (typeof value === "string") {
    collectTextFigures(value, figures, ref, budget);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectFigures(item, figures, ref, seen, depth + 1, budget);
    return;
  }
  for (const item of Object.values(value)) collectFigures(item, figures, ref, seen, depth + 1, budget);
}

function collectTextFigures(text: string, figures: Figure[], ref: string, budget: EvidenceBudget): void {
  const bounded = text.slice(0, budget.chars);
  budget.chars -= bounded.length;
  for (const claim of claims(bounded, 0)) {
    if (figures.length >= MAX_EVIDENCE_FIGURES) return;
    figures.push({ value: claim.value, ref });
  }
}

function outputClaims(content: readonly ContentBlock[]): readonly Claim[] {
  const out: Claim[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const block = content[index];
    if (block?.type !== "text") continue;
    out.push(...claims(block.text, index));
  }
  return out;
}

function claims(text: string, contentIndex: number): readonly Claim[] {
  const out: Claim[] = [];
  NUMERIC_CLAIM.lastIndex = 0;
  for (let match = NUMERIC_CLAIM.exec(text); match; match = NUMERIC_CLAIM.exec(text)) {
    const token = match[0];
    const parsed = parseNumber(token);
    if (parsed === undefined) continue;
    out.push({ text: token, value: parsed.value, tolerance: parsed.tolerance, end: match.index + token.length, contentIndex });
  }
  return out;
}

function parseNumber(token: string): { readonly value: number; readonly tolerance: number } | undefined {
  const compact = token.replace(/^~?[$€£¥]?[-+]?/, "").replace(/%$/, "");
  const suffix = compact.at(-1)?.toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
  const numberText = (multiplier === 1 ? compact : compact.slice(0, -1)).replace(/,/g, "");
  const value = Number(numberText) * multiplier;
  if (!Number.isFinite(value)) return undefined;
  const fraction = numberText.split(".")[1]?.length ?? 0;
  return { value, tolerance: 0.5 * multiplier * 10 ** -fraction };
}

function matchesEvidence(claim: Claim, figures: readonly Figure[], tolerance: "exact" | "rounded"): boolean {
  return figures.some((figure) => Math.abs(figure.value - claim.value) <= (tolerance === "rounded" ? claim.tolerance : 0));
}

function citesEvidence(text: string, end: number, refs: ReadonlySet<string>): boolean {
  const nearby = text.slice(end, end + MAX_CITATION_DISTANCE);
  EVIDENCE_CITATION.lastIndex = 0;
  for (let match = EVIDENCE_CITATION.exec(nearby); match; match = EVIDENCE_CITATION.exec(nearby)) if (refs.has(match[1] ?? "")) return true;
  return false;
}

function citationRef(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
}
