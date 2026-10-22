/** Deterministic bench scope: record and replay never depend on the cwd. */
export const BENCH_PROJECT_ID = "bench--00000000";
export const BENCH_SCOPE = Object.freeze({
  tenantId: "prism",
  resourceId: `projects/${BENCH_PROJECT_ID}`,
  threadId: "default",
});

/**
 * One project scope per question, with user and agent scopes off: bench comparisons pair each
 * question with plan 188.1's single-resource fabric configuration.
 */
export const BENCH_SCOPES = Object.freeze({
  tenantId: BENCH_SCOPE.tenantId,
  user: false,
  agent: false,
  project: { id: BENCH_PROJECT_ID },
});
