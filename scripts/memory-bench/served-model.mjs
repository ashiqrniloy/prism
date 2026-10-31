/**
 * Plan 214 Task 5b: a pooled gateway may answer the same group from different deployments. A free
 * pool is only usable as evidence if the bench records which deployment answered each call and
 * refuses the comparisons where a mix would silently change the model. Every guard is pure and
 * fails closed with `MemoryBenchServedModel`.
 */
export const SERVED_MODEL_CODE = "MemoryBenchServedModel";

const fail = (message) => {
  const error = new Error(`MemoryBenchServedModel: ${message}`);
  error.code = SERVED_MODEL_CODE;
  return error;
};

/** The subsets whose answers are held out or confirmatory; a mixed pool must never serve them. */
export const PINNED_SUBSETS = new Set(["confirmatory", "heldout-a", "heldout-b", "heldout-v2", "heldout-v3"]);
/** The smoke group mixes model families on purpose, so it can never score. */
export const SMOKE_GROUP = "prism-free/smoke";
/** Above this many ids the report points at a sidecar JSONL instead of inlining them. */
export const CALL_ID_INLINE_LIMIT = 1000;

/** Rows are wire-proxy usage lines; only rows the gateway actually labelled carry a deployment. */
export function servedDeploymentsFromRows(rows) {
  const deployments = {};
  const callIds = [];
  let responseCost = 0;
  for (const row of rows ?? []) {
    if (row?.modelId) deployments[row.modelId] = (deployments[row.modelId] ?? 0) + 1;
    if (row?.callId) callIds.push(row.callId);
    // A stream carries no total cost header; its usage chunk does, so either figure counts.
    const cost = [row?.responseCost, row?.rawUsage?.cost, row?.usage?.cost].find(
      (value) => typeof value === "number" && Number.isFinite(value),
    );
    if (cost !== undefined) responseCost += cost;
  }
  return { deployments, callIds, responseCost };
}

/** Attach the served-deployment record to a report, inlining ids only below the threshold. */
export function recordServedDeployments(report, { deployments, callIds, responseCost }, { sidecarPath } = {}) {
  if (!deployments || Object.keys(deployments).length === 0) return report;
  report.servedDeployments = { ...deployments };
  report.servedModelCost = responseCost;
  if (callIds.length > CALL_ID_INLINE_LIMIT) {
    report.servedCallIds = { count: callIds.length, path: sidecarPath ?? null };
  } else report.servedCallIds = callIds;
  return report;
}

/** Guard 1: a free-only arm that was charged is not free evidence. */
export function assertFreeOnlyCost(report, { freeOnly }) {
  if (!freeOnly) return;
  const cost = report?.servedModelCost ?? 0;
  if (cost > 0) throw fail(`a --free-only arm was charged ${cost}; the arm is refused and its checkpoint is kept`);
  for (const row of report?.results ?? [])
    if (typeof row?.cost === "number" && row.cost > 0) throw fail("a --free-only answer reports a positive cost");
}

/** Guard 3: a scored arm needs one model, so the smoke group and multi-model groups are refused. */
export function assertScoredSingleModel({ group, deployments, phase, catalogModel }) {
  if (phase === "write") return;
  if (group === SMOKE_GROUP) throw fail(`${SMOKE_GROUP} mixes model families and cannot score; use --phase write or a pinned group`);
  const count = catalogModel?.compat?.deployments;
  if (typeof count === "number" && count > 1)
    throw fail(`group ${group} has ${count} deployments of one model; score only on a pinned single-deployment group`);
  if (typeof deployments === "number" && deployments > 1) throw fail(`group ${group} served more than one deployment while scoring`);
}

/** Guard 4: held-out and confirmatory answers never run on a pooled group. */
export function assertPinnedSubset({ group, subset, deployments }) {
  if (!PINNED_SUBSETS.has(subset)) return;
  if (typeof deployments === "number" && deployments > 1)
    throw fail(`${subset} refuses a pooled group: ${group} has ${deployments} deployments`);
}

/**
 * One entry point for the arm-start checks (guards 3 and 4). Cost is checked after the calls,
 * because only then does the gateway's own figure exist.
 */
export function servedModelGuard(report, options = {}) {
  assertScoredSingleModel({
    group: options.group ?? report?.model,
    deployments: options.deployments ?? Object.keys(report?.servedDeployments ?? {}).length,
    phase: options.phase ?? report?.phase,
    catalogModel: options.catalogModel,
  });
  assertPinnedSubset({ group: options.group ?? report?.model, subset: options.subset, deployments: options.deployments });
  assertFreeOnlyCost(report, { freeOnly: options.freeOnly });
  return report;
}

const deploymentSet = (report) => new Set(Object.keys(report?.servedDeployments ?? {}));

/** Guard 2: a paired comparison is only meaningful over the same served deployments. */
export function assertComparableServedDeployments(candidate, control, { label = "pair" } = {}) {
  const a = deploymentSet(candidate);
  const b = deploymentSet(control);
  if (a.size === 0 && b.size === 0) return;
  const onlyCandidate = [...a].filter((id) => !b.has(id));
  const onlyControl = [...b].filter((id) => !a.has(id));
  if (onlyCandidate.length || onlyControl.length)
    throw fail(
      `${label} arms were served by different deployments (candidate-only ${onlyCandidate.join(",") || "-"}; control-only ${onlyControl.join(",") || "-"})`,
    );
}
