import type { SessionEntry } from "@arnilo/prism";
import type { ResolveGraftCliOptions } from "./upstream.js";

/** Host-supplied graft provider settings; only `GRAFT_*` keys reach the child env. */
export interface ChildEnvOptions {
  readonly allowUpstreamTelemetry?: boolean;
  readonly providerEnv?: Readonly<Record<string, string>>;
}

export type GraftMode = "pull" | "push" | "both";

export interface GraftAppendOptions {
  readonly expectedParentId?: string;
}

export interface GraftFreshness {
  readonly checkedAt: string;
  readonly fresh: boolean;
  readonly missing?: number;
  readonly stale?: number;
}

export interface GraftExtensionOptions extends ResolveGraftCliOptions {
  /** `"pull"` registers CLI-backed tools; `"push"` adds the retrieval pack + orientation; `"both"` is everything. Default `"pull"`. */
  readonly mode?: GraftMode;
  /** Wall-clock budget for one graft CLI child call. Default 8000ms (graft's own hook budget). */
  readonly retrievalBudgetMs?: number;
  /** Cap on a single CLI child's stdout before parsing. Default 512 KiB. */
  readonly maxResultBytes?: number;
  /** Prompts longer than this are never sent as ask argv. Default 4096. */
  readonly maxPromptChars?: number;
  /** Default false → graft children run with `DO_NOT_TRACK=1`. */
  readonly allowUpstreamTelemetry?: boolean;
  /** Explicit graft provider settings (`GRAFT_API_KEY`, `GRAFT_PROVIDER`, `GRAFT_MODEL`, `GRAFT_BASE_URL`). Never inherited from the host process env. */
  readonly providerEnv?: Readonly<Record<string, string>>;
  /** Tool names whose results trigger blast-radius lookup. Default `"write" | "edit" | "move"` (this repo's mutating coding tools). */
  readonly editToolNames?: readonly string[];
  /** Project directory graft operates on. Defaults to `process.cwd()` at setup. */
  readonly projectDir?: string;
  readonly quietStartup?: boolean;
  readonly hideStatus?: boolean;
  /** Host session append (OM attach pattern). */
  readonly appendEntry: (entry: SessionEntry, options?: GraftAppendOptions) => Promise<void>;
  /** Current branch entries for state restore. */
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
}

export interface GraftExtensionState {
  readonly cliKind: "explicit" | "peer-bin";
  readonly mode: GraftMode;
}
