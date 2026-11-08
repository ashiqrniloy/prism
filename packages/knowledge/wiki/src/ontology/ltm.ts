/**
 * What the wiki reads of long-term memory: the read-only `memory.ltm` service (plan 216 Task 3). Declared here,
 * structurally, so the wiki has no dependency on a memory package and runs on its own sources without one.
 * `ltm_port_types_stay_compatible` fails typecheck if the memory side drifts.
 */

/** The service name the long-term memory provides. Consumed per call: memory may load after the wiki. */
export const MEMORY_LTM_SERVICE = "memory.ltm";

/** Ids one `read` takes. */
export const MAX_LTM_READ_IDS = 32;

export type LtmScopeLevel = "user" | "project" | "agent" | "team";

export interface LtmNoteMeta {
  readonly id: string;
  readonly kind: string;
  readonly scope: LtmScopeLevel;
  readonly createdAt: string;
  readonly status: string;
  readonly flagged: boolean;
  readonly subject?: string;
  readonly key?: string;
  readonly tRef?: string;
  readonly keywords?: readonly string[];
  readonly links?: readonly { readonly id: string; readonly relation?: string }[];
  readonly coRead?: readonly { readonly s: number; readonly t: number; readonly with: readonly string[] }[];
  readonly uses?: number;
  readonly path?: string;
  readonly generatedBy?: string;
}

export interface LtmNoteView extends LtmNoteMeta {
  readonly text: string;
}

export interface LtmPageOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface LtmDeletion {
  readonly id: string;
  readonly reason: string;
  readonly at: string;
}

export interface LtmPort {
  scopes(): readonly LtmScopeLevel[];
  /** An opaque, stable identity of the memory a level reads; the wiki pins each level of its store to it. */
  scopeId(scope: LtmScopeLevel): string;
  epoch(): number;
  read(scope: LtmScopeLevel, ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly LtmNoteView[]>;
  scanMetadata(
    scope: LtmScopeLevel,
    options?: LtmPageOptions,
  ): Promise<{ readonly notes: readonly LtmNoteMeta[]; readonly cursor?: string }>;
  deletions(
    scope: LtmScopeLevel,
    options?: { readonly since?: string; readonly signal?: AbortSignal },
  ): Promise<{ readonly deletions: readonly LtmDeletion[]; readonly cursor?: string }>;
}
