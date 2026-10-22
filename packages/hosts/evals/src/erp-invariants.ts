/**
 * Plan 027 Task 9 — deterministic ERP invariant dataset and scorers.
 *
 * The ERP release journey (`scripts/phase27-erp-journey.test.mjs`) produces a
 * structured fact record — never model prose — and these scorers turn each
 * required invariant into a hard 0/1 gate. A weighted average can never hide an
 * atomicity or security failure: every scorer must return 1 for the journey to
 * pass. Scorers consume facts only; no credentials, tool output, or classified
 * payloads cross the scorer boundary (the journey redacts before scoring).
 *
 * Frozen additive API (plan 027 Task 0): `erpInvariantDataset` +
 * `createErpInvariantScorers`, both exported from `@arnilo/prism-evals`.
 */
import { defineDataset } from "./dataset.js";
import { defineScorer } from "./scorer.js";
import type { Dataset, Scorer } from "./types.js";

/** Schema version for the journey fact record carried in `result.text` as JSON. */
export const ERP_INVARIANT_SCHEMA_VERSION = 1;

/** One invariant spec: the facts block key and the required (true) facts. */
interface InvariantSpec {
  readonly id: string;
  readonly description: string;
  /** Key in the journey facts object holding this invariant's facts. */
  readonly factsKey: string;
  /** Fact names that must be present and truthy (numbers must be > 0). */
  readonly required: readonly string[];
}

/**
 * The eight frozen invariants. Each maps to one scorer so a single failure is
 * never averaged away. Order is stable for deterministic evidence.
 */
const INVARIANTS: readonly InvariantSpec[] = Object.freeze([
  {
    id: "atomic-intent",
    description: "Atomic intent: the business mutation and the outbox append commit together or not at all.",
    factsKey: "atomic",
    required: ["committedAtomically"],
  },
  {
    id: "single-local-effect",
    description: "Duplicate outbox/inbox delivery yields exactly one local business mutation.",
    factsKey: "delivery",
    required: ["singleLocalEffect", "duplicateDelivered", "businessMutationCount"],
  },
  {
    id: "compensation-terminal",
    description: "Injected downstream failure compensates completed steps; ambiguous outcome reconciles to a terminal state.",
    factsKey: "compensation",
    required: ["compensated", "reconciled", "terminalStatus"],
  },
  {
    id: "quorum-provenance",
    description:
      "SoD quorum approval requires distinct verified approvers; requester, subagent, revoked, and stale approvals all fail closed.",
    factsKey: "quorum",
    required: ["distinctApprovers", "requesterDenied", "subagentDenied", "revokedDenied", "provenance"],
  },
  {
    id: "chain-verification",
    description: "Signed hash-chained audit export verifies; a tampered copy is detected and rejected.",
    factsKey: "chain",
    required: ["verified", "tamperedDetected", "nextDigest"],
  },
  {
    id: "no-leak",
    description: "Classification canary, cross-tenant access, and secret material are denied or redacted at every boundary.",
    factsKey: "noLeak",
    required: ["classifiedDenied", "crossTenantDenied", "secretRedacted"],
  },
  {
    id: "fenced-failover",
    description:
      "Killed worker's peer resumes within the lease TTL using fencing; stale fence/revision writes are rejected and the cursor never regresses.",
    factsKey: "fencedFailover",
    required: ["resumedByPeer", "staleWriteRejected", "cursorPreserved", "failoverMs"],
  },
  {
    id: "restore-equality",
    description: "Backup/restore durable facts and digests match; DR evidence is present and not stale.",
    factsKey: "restore",
    required: ["factsMatch", "digestsMatch", "drEvidenceFresh", "restoreMs"],
  },
]);

/**
 * Frozen, versioned dataset of the eight ERP invariants. Items carry the
 * invariant id, a human description, and the required fact names; the scorers
 * are the gate, the dataset is the contract/trace surface.
 */
export const erpInvariantDataset: Dataset<unknown, unknown> = defineDataset({
  id: "prism.erp-invariants",
  version: "0.2.7",
  items: INVARIANTS.map((spec) => ({
    id: spec.id,
    input: { factsKey: spec.factsKey, description: spec.description },
    expected: { invariant: spec.id, required: spec.required },
  })),
  metadata: Object.freeze({
    frozen: true,
    release: "0.2.7",
    schemaVersion: ERP_INVARIANT_SCHEMA_VERSION,
    scorerCount: INVARIANTS.length,
  }),
});

/** Parse the journey facts from the agent run result text (JSON). */
function parseFacts(text: string | undefined): Record<string, Record<string, unknown>> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Record<string, unknown>>;
    }
    return {};
  } catch {
    return {};
  }
}

function isTruthyFact(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return value.length > 0;
  return false;
}

/**
 * Create the eight deterministic ERP invariant scorers. Each scorer reads the
 * journey facts from `result.text` (JSON), isolates its invariant's facts
 * block, and returns 1 only when every required fact is present and truthy.
 *
 * A missing facts block, a missing fact, or a false/zero/empty fact all score
 * 0 with a precise reason — no weighted average can hide the failure.
 */
export function createErpInvariantScorers(): readonly Scorer<unknown, unknown>[] {
  return INVARIANTS.map((spec) =>
    defineScorer<unknown, unknown>({
      id: spec.id,
      description: spec.description,
      score: ({ result }) => {
        const facts = parseFacts(result.text);
        const block = facts[spec.factsKey];
        if (!block || typeof block !== "object") {
          return { score: 0, reason: `missing facts block: ${spec.factsKey}` };
        }
        for (const name of spec.required) {
          const value = (block as Record<string, unknown>)[name];
          if (value === undefined || value === null) {
            return { score: 0, reason: `${spec.id}: missing fact: ${name}` };
          }
          if (!isTruthyFact(value)) {
            return { score: 0, reason: `${spec.id}: fact not satisfied: ${name}` };
          }
        }
        return { score: 1, reason: spec.id };
      },
    }),
  );
}
