/**
 * Turn evidence for the note lifecycle (plan 188.4 Task 1): an outcome tag in the same run credits
 * a note that was cited, and a user correction that cites a note counts as harmful evidence.
 *
 * Gathering is the consolidator's, so a turn pays no second scan and no model call. The cursor
 * stops one correction from being counted twice.
 */
import type { SessionEntry } from "@arnilo/prism";
import { gatherConsolidationCandidates } from "../consolidation/gather.js";

export interface CitationEvidenceInput {
  readonly entries: readonly SessionEntry[];
  /** The last entry a previous turn credited; candidates at or before it are skipped. */
  readonly cursor?: string;
  /** Notes cited anywhere in this session; only ids the session was shown reach this set. */
  readonly cited: Iterable<string>;
  /** Notes a previous turn already credited helpful in this session. */
  readonly helped?: ReadonlySet<string>;
}

export interface CitationEvidence {
  readonly helpful: readonly string[];
  readonly harmful: readonly string[];
  readonly cursor?: string;
}

export function citationEvidence(input: CitationEvidenceInput): CitationEvidence {
  const cited = new Set(input.cited);
  const helped = input.helped ?? new Set<string>();
  const next = input.entries.at(-1)?.id;
  if (next === undefined || next === input.cursor || cited.size === 0) return { helpful: [], harmful: [], ...(next === undefined ? {} : { cursor: next }) };
  const candidates = gatherConsolidationCandidates(input.entries, input.cursor === undefined ? {} : { cursor: input.cursor });
  const harmful = new Set<string>();
  let outcome = false;
  for (const candidate of candidates) {
    if (candidate.signals.outcome === 1) outcome = true;
    if (candidate.source !== "correction") continue;
    for (const id of candidate.citedNotes ?? []) if (cited.has(id)) harmful.add(id);
  }
  const helpful = outcome ? [...cited].filter((id) => !harmful.has(id) && !helped.has(id)) : [];
  return { helpful, harmful: [...harmful], cursor: next };
}