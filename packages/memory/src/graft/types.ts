import type { SessionEntry } from "@arnilo/prism";
import type { ResolveGraftCliOptions } from "./upstream.js";

/** Host-supplied graft provider settings; only `GRAFT_*` keys reach the child env. */
export interface ChildEnvOptions {
  readonly allowUpstreamTelemetry?: boolean;
  readonly providerEnv?: Readonly<Record<string, string>>;
}

export type GraftMode = "pull" | "push" | "both";

/** Provider id for `graft build --deep` (Graft's own LLM client — not Prism's Provider). */
export type GraftDeepProvider = "openai" | "anthropic" | "litellm" | "orcarouter";

/** Host-configured model for `graft build --deep`. Merged into the child env as `GRAFT_*`
 *  keys (winning over `providerEnv` on conflict); the API key never touches argv. */
export interface GraftDeepModel {
  readonly provider: GraftDeepProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
}

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
  /** Model for `graft build --deep` (Graft's own LLM client, not Prism's Provider). Merged over `providerEnv`. */
  readonly deepModel?: GraftDeepModel;
  /** Agent ids passed to `graft init --agents`. Required (alone or with `initYes`) — the child has no TTY and upstream writes nothing without it. */
  readonly initAgents?: readonly string[];
  /** Pass `--yes` to `graft init` (upstream non-interactive defaults). */
  readonly initYes?: boolean;
  /** Let `graft init` wire MCP servers. Default false — Prism provides its own graft surfaces. */
  readonly initWireMcp?: boolean;
  /** Wall-clock budget for structural `graft build` / `graft init`. Default 120000ms. */
  readonly buildBudgetMs?: number;
  /** Wall-clock budget for `graft build --deep` (LLM pass over the graph). Default 600000ms. */
  readonly deepBuildBudgetMs?: number;
  /** Stdout cap for build/init children. Default 2 MiB. */
  readonly buildMaxResultBytes?: number;
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
