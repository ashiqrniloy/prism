/** Contracts-core loop family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel.
 *
 * The turn boundary and run end are hook points, not pluggable host callbacks (plan 145 Task 4):
 * `TurnPolicyOptions`/`StopHook` are retired in favour of the `turn.before` and `run.end` hooks
 * in {@link ../hooks/types.js}, which carry the same decisions on one per-agent bus.
 */
/** Artifact-loop outcome retained for the `artifact_*` event payloads (plan 028). */
export interface ArtifactValidation {
  readonly ok: boolean;
  readonly errors?: readonly { readonly path?: string; readonly message: string }[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}
