/**
 * Frozen 188.7 final-acceptance manifest and verdict vocabulary.
 *
 * Planning estimate was 100-106M input tokens. The owner approved 106M for this
 * campaign only; it is not a reusable ceiling and not a new default budget.
 */
import { createHash } from "node:crypto";
import confirmatory from "./confirmatory.json" with { type: "json" };

export const ACCEPTANCE_CEILING = 106_000_000;
export const ACCEPTANCE_EVIDENCE = "docs/_evidence/memory-bench/188.7";
export const ACCEPTANCE_JOURNAL = `${ACCEPTANCE_EVIDENCE}/spend-journal.json`;
export const ACCEPTANCE_MANIFEST = `${ACCEPTANCE_EVIDENCE}/acceptance-manifest.json`;
export const ACCEPTANCE_SUMMARY = `${ACCEPTANCE_EVIDENCE}/acceptance-run.json`;
export const CONFIRMATORY_SEED = 1887;
export const LIFECYCLE_SEEDS = Array.from({ length: 12 }, (_, index) => CONFIRMATORY_SEED + index);
export const REQUIRED_LME_CONFIGS = ["full", "om", "fabric", "fabric-agentic", "om+fabric"];
export const LIFECYCLE_ARMS = [
  { name: "full", config: "full", ablate: [] },
  { name: "fabric-promote-off", config: "fabric", ablate: ["fabric.promote=off"] },
  { name: "fabric-promote-on", config: "fabric", ablate: [] },
  { name: "om+fabric", config: "om+fabric", ablate: [] },
];
// The 188.7 pilot showed ~2.48M input per OM question, so the full confirmatory OM arms
// cannot fit the owner cap. They run as one-question feasibility probes, not quality arms.
const LME_CAPS = { full: 22_000_000, om: 3_000_000, fabric: 3_000_000, "fabric-agentic": 8_000_000, "om+fabric": 3_000_000 };
const LIFECYCLE_CAPS = { full: 500_000, fabric: 500_000, "om+fabric": 500_000 };

export class AcceptanceManifestError extends Error {
  name = "AcceptanceManifestError";
}

const slug = (value) => value.replace(/[^\w.+=-]/g, "_");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function confirmatoryCounts() {
  return Object.fromEntries(Object.entries(confirmatory.abilities).map(([ability, ids]) => [ability, ids.length]));
}

export function confirmatoryIds() {
  return Object.values(confirmatory.abilities).flat();
}

export function acceptanceJobs() {
  const jobs = [];
  for (const config of REQUIRED_LME_CONFIGS) {
    jobs.push({
      id: `accept-lme-${slug(config)}`,
      family: "quality",
      suite: "longmemeval-s",
      config,
      subset: "confirmatory",
      maxInputTokens: LME_CAPS[config],
    });
  }
  for (const config of ["full", "fabric"]) {
    jobs.push({
      id: `accept-mab-cr-${slug(config)}`,
      family: "quality",
      suite: "memoryagentbench-cr",
      config,
      maxInputTokens: config === "full" ? 12_000_000 : 3_000_000,
    });
  }
  jobs.push({ id: "accept-locomo-full", family: "comparison", suite: "locomo", config: "full", maxInputTokens: 5_000_000 });
  for (const seed of LIFECYCLE_SEEDS) {
    for (const arm of LIFECYCLE_ARMS) {
      jobs.push({
        id: `accept-lifecycle-${slug(arm.name)}-p${seed}`,
        family: "safety",
        suite: "lifecycle",
        config: arm.config,
        ablate: arm.ablate,
        seed,
        maxInputTokens: LIFECYCLE_CAPS[arm.config],
      });
    }
  }
  return jobs;
}

export function buildAcceptanceManifest() {
  return {
    schemaVersion: 2,
    kind: "188.7-final-acceptance",
    ceiling: ACCEPTANCE_CEILING,
    priorReservation: 0,
    historicalSpendForAuditOnly: 112_092_487,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    judgeProtocol: "enum-json-v1",
    sourceRevision: "working-tree",
    dataset: "longmemeval-s@98d7416c",
    confirmatory: {
      seed: CONFIRMATORY_SEED,
      counts: confirmatoryCounts(),
      idsHash: hash(confirmatory.ids ?? confirmatory.abilities),
      fileSha256: createHash("sha256").update(JSON.stringify(confirmatory)).digest("hex"),
      ids: confirmatory.abilities,
    },
    lifecycle: { seeds: LIFECYCLE_SEEDS, projects: 3, sessions: 8, clusterUnit: "persona" },
    unavailable: [{ arm: "fabric-hybrid", reason: "No live embeddings model configured; hash embeddings are not a substitute." }],
    limitations: [
      "LoCoMo is comparison-only and capped; a capped run is partial.",
      "The two Locomo conversations are the pinned comparison pair, not the whole dataset.",
      "A pre-fix fabric arm is not run because the fix history is uncommitted; pre-fix claims stay unresolved.",
      "Currency is not reported without authenticated rate semantics.",
    ],
    jobs: acceptanceJobs(),
  };
}

export function assertAcceptanceManifest(manifest) {
  if (manifest?.kind !== "188.7-final-acceptance") throw new AcceptanceManifestError("not the 188.7 acceptance manifest");
  if (manifest.ceiling !== ACCEPTANCE_CEILING) throw new AcceptanceManifestError(`ceiling must be ${ACCEPTANCE_CEILING}`);
  const ids = new Set();
  let totalCaps = 0;
  for (const job of manifest.jobs ?? []) {
    if (!job.id || ids.has(job.id)) throw new AcceptanceManifestError("job ids must be unique");
    ids.add(job.id);
    if (!Number.isSafeInteger(job.maxInputTokens) || job.maxInputTokens < 1)
      throw new AcceptanceManifestError(`${job.id} needs a positive maxInputTokens`);
    totalCaps += job.maxInputTokens;
    if (job.config === "fabric-hybrid") throw new AcceptanceManifestError("fabric-hybrid has no live embeddings model");
  }
  if (totalCaps > manifest.ceiling) throw new AcceptanceManifestError("arm caps exceed the campaign ceiling");
  const counts = manifest.confirmatory?.counts ?? {};
  for (const ability of Object.keys(confirmatory.abilities)) {
    if (counts[ability] !== 20) throw new AcceptanceManifestError(`confirmatory ${ability} needs 20 ids`);
  }
  if (Object.keys(counts).length !== 7) throw new AcceptanceManifestError("confirmatory set needs seven abilities");
  for (const config of REQUIRED_LME_CONFIGS) {
    if (!manifest.jobs.some((job) => job.suite === "longmemeval-s" && job.config === config && job.subset === "confirmatory"))
      throw new AcceptanceManifestError(`missing confirmatory LongMemEval arm: ${config}`);
  }
  for (const config of ["full", "fabric"])
    if (!manifest.jobs.some((job) => job.suite === "memoryagentbench-cr" && job.config === config))
      throw new AcceptanceManifestError(`missing MemoryAgentBench-CR arm: ${config}`);
  if (!manifest.jobs.some((job) => job.suite === "locomo" && job.config === "full"))
    throw new AcceptanceManifestError("missing LoCoMo comparison arm");
  for (const seed of LIFECYCLE_SEEDS) {
    for (const arm of LIFECYCLE_ARMS) {
      if (
        !manifest.jobs.some(
          (job) =>
            job.suite === "lifecycle" &&
            job.seed === seed &&
            job.config === arm.config &&
            JSON.stringify(job.ablate ?? []) === JSON.stringify(arm.ablate),
        )
      )
        throw new AcceptanceManifestError(`missing lifecycle arm ${arm.name} for persona ${seed}`);
    }
  }
  return manifest;
}

export function qualityVerdict({ candidateImproves, fullContextNonInferior, powered }) {
  if (!powered) return "inconclusive";
  if (!candidateImproves) return "not-useful";
  return fullContextNonInferior ? "full-context-substitute" : "opt-in-improvement";
}

export function defaultGate({ quality, safety, powered, costReduction }) {
  if (quality === "full-context-substitute" && safety === "passed" && powered && costReduction?.met === true)
    return { promotion: true, injection: true, reason: "quality, safety, power and comparable cost gates passed" };
  return {
    promotion: false,
    injection: false,
    reason: `retained off: quality=${quality}, safety=${safety}, powered=${powered}, cost=${costReduction?.met === true ? "passed" : "failed"}`,
  };
}

export function priceAvailable({ usageComplete, rateKnown }) {
  return usageComplete === true && rateKnown === true;
}

const FINDING_VERDICTS = new Set(["fixed", "not-reproduced", "unresolved", "inconclusive"]);
export function validateFindingMatrix(rows, required = 13) {
  if (!Array.isArray(rows) || rows.length !== required) throw new AcceptanceManifestError(`finding matrix needs ${required} rows`);
  for (const [index, row] of rows.entries()) {
    if (row.id !== `F${index + 1}`) throw new AcceptanceManifestError(`finding row ${index + 1} is not F${index + 1}`);
    if (!FINDING_VERDICTS.has(row.verdict)) throw new AcceptanceManifestError(`${row.id} has no allowed verdict`);
    if (!row.tests || !row.paidEvidence) throw new AcceptanceManifestError(`${row.id} needs tests and paid evidence`);
    if (row.verdict === "fixed" && row.paidEvidence === "none")
      throw new AcceptanceManifestError(`${row.id} cannot be fixed without paid evidence`);
  }
  return rows;
}
