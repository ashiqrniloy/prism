import type { ExecutionPolicy } from "@arnilo/prism";
import {
  DEFAULT_MAX_LSP_DIAGNOSTICS_PER_FILE,
  DEFAULT_MAX_LSP_MESSAGE_BYTES,
  DEFAULT_MAX_LSP_PENDING_REQUESTS,
  DEFAULT_MAX_LSP_RESULTS_PER_QUERY,
  DEFAULT_MAX_LSP_SERVERS,
  DEFAULT_MAX_LSP_TIMEOUT_MS,
  HARD_MAX_LSP_DIAGNOSTICS_PER_FILE,
  HARD_MAX_LSP_MESSAGE_BYTES,
  HARD_MAX_LSP_PENDING_REQUESTS,
  HARD_MAX_LSP_RESULTS_PER_QUERY,
  HARD_MAX_LSP_SERVERS,
  HARD_MAX_LSP_TIMEOUT_MS,
  LSP_RESTARTS_PER_SERVER,
  validateCodingLimit,
} from "../limits.js";

export type LanguageIntelligenceErrorCode =
  | "ERR_PRISM_LSP_FRAMING"
  | "ERR_PRISM_LSP_SERVER"
  | "ERR_PRISM_LSP_TIMEOUT"
  | "ERR_PRISM_LSP_LIMIT"
  | "ERR_PRISM_LSP_UNSUPPORTED"
  | "ERR_PRISM_LSP_WORKSPACE";

export class LanguageIntelligenceError extends Error {
  readonly code: LanguageIntelligenceErrorCode;
  constructor(code: LanguageIntelligenceErrorCode, message: string) {
    super(message);
    this.name = "LanguageIntelligenceError";
    this.code = code;
  }
}

/** Host allow-listed server command; never model-supplied. */
export interface LanguageServerSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly languages: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** LSP 0-based position + workspace-relative file path. */
export interface LanguageLocation {
  readonly file: string;
  readonly line: number;
  readonly character: number;
}

export interface LanguageSymbol {
  readonly name: string;
  readonly kind: number;
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly containerName?: string;
}

export interface LanguageDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly endLine: number;
  readonly endCharacter: number;
  readonly severity: "error" | "warning" | "info" | "hint";
  readonly message: string;
  readonly source?: string;
  readonly code?: string | number;
}

export interface LanguageTextEdit {
  readonly file: string;
  readonly newText: string;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

export interface LanguageWorkspaceEdit {
  readonly edits: readonly LanguageTextEdit[];
}

export interface LanguageIntelligenceLimits {
  readonly maxMessageBytes?: number;
  readonly maxDiagnosticsPerFile?: number;
  readonly maxPendingRequests?: number;
  readonly maxResultsPerQuery?: number;
  readonly requestTimeoutMs?: number;
  readonly maxServers?: number;
  /** Cap restarts after unexpected exit (freeze: 3). */
  readonly maxRestartsPerServer?: number;
}

export interface ResolvedLanguageIntelligenceLimits {
  readonly maxMessageBytes: number;
  readonly maxDiagnosticsPerFile: number;
  readonly maxPendingRequests: number;
  readonly maxResultsPerQuery: number;
  readonly requestTimeoutMs: number;
  readonly maxServers: number;
  readonly maxRestartsPerServer: number;
}

export function resolveLanguageIntelligenceLimits(options?: LanguageIntelligenceLimits): ResolvedLanguageIntelligenceLimits {
  return {
    maxMessageBytes: validateCodingLimit(
      "maxMessageBytes",
      options?.maxMessageBytes ?? DEFAULT_MAX_LSP_MESSAGE_BYTES,
      HARD_MAX_LSP_MESSAGE_BYTES,
    ),
    maxDiagnosticsPerFile: validateCodingLimit(
      "maxDiagnosticsPerFile",
      options?.maxDiagnosticsPerFile ?? DEFAULT_MAX_LSP_DIAGNOSTICS_PER_FILE,
      HARD_MAX_LSP_DIAGNOSTICS_PER_FILE,
    ),
    maxPendingRequests: validateCodingLimit(
      "maxPendingRequests",
      options?.maxPendingRequests ?? DEFAULT_MAX_LSP_PENDING_REQUESTS,
      HARD_MAX_LSP_PENDING_REQUESTS,
    ),
    maxResultsPerQuery: validateCodingLimit(
      "maxResultsPerQuery",
      options?.maxResultsPerQuery ?? DEFAULT_MAX_LSP_RESULTS_PER_QUERY,
      HARD_MAX_LSP_RESULTS_PER_QUERY,
    ),
    requestTimeoutMs: validateCodingLimit(
      "requestTimeoutMs",
      options?.requestTimeoutMs ?? DEFAULT_MAX_LSP_TIMEOUT_MS,
      HARD_MAX_LSP_TIMEOUT_MS,
    ),
    maxServers: validateCodingLimit("maxServers", options?.maxServers ?? DEFAULT_MAX_LSP_SERVERS, HARD_MAX_LSP_SERVERS),
    maxRestartsPerServer: validateCodingLimit(
      "maxRestartsPerServer",
      options?.maxRestartsPerServer ?? LSP_RESTARTS_PER_SERVER,
      LSP_RESTARTS_PER_SERVER,
    ),
  };
}

export interface LanguageIntelligence {
  workspaceSymbols(query: string, opts?: { signal?: AbortSignal }): Promise<readonly LanguageSymbol[]>;
  definitions(loc: LanguageLocation, opts?: { signal?: AbortSignal }): Promise<readonly LanguageLocation[]>;
  references(loc: LanguageLocation, opts?: { signal?: AbortSignal }): Promise<readonly LanguageLocation[]>;
  diagnostics(file?: string, opts?: { signal?: AbortSignal }): Promise<readonly LanguageDiagnostic[]>;
  hover(loc: LanguageLocation, opts?: { signal?: AbortSignal }): Promise<{ text: string } | undefined>;
  rename(loc: LanguageLocation & { newName: string }, opts?: { signal?: AbortSignal }): Promise<LanguageWorkspaceEdit>;
  /**
   * Re-sync one file after an external edit: full-content didChange with a
   * monotonic version. No-op when no host server handles the file's language
   * (throws ERR_PRISM_LSP_UNSUPPORTED only when servers exist but none match).
   */
  syncDocument(file: string, opts?: { signal?: AbortSignal }): Promise<{ version: number }>;
  /**
   * Bounded push/pull diagnostic refresh for changed files. Generations are
   * document versions; stale-version results never overwrite newer views.
   */
  diagnosticDelta(
    request: LanguageDiagnosticDeltaRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<LanguageDiagnosticDeltaResult>;
  dispose(): Promise<void>;
}

export interface LanguageDiagnosticDeltaRequest {
  /** Workspace-relative files to refresh; bounded per request. */
  readonly files: readonly string[];
  /** Prior normalized view per file (generation + diagnostics); optional. */
  readonly previous?: Readonly<Record<string, LanguageFileDiagnostics>>;
}

export interface LanguageFileDiagnostics {
  readonly generation: number;
  readonly diagnostics: readonly import("../diagnostics.js").NormalizedDiagnostic[];
}

export interface LanguageDiagnosticDeltaResult {
  /** Per-file delta; stale files (previous generation >= new generation) are omitted. */
  readonly files: Record<string, import("../diagnostics.js").DiagnosticDelta>;
  readonly generation: number;
}

export interface CreateLanguageIntelligenceOptions {
  readonly workspaceRoot: string;
  readonly servers: Readonly<Record<string, LanguageServerSpec>>;
  readonly limits?: LanguageIntelligenceLimits;
  readonly policy?: ExecutionPolicy;
  // processes?: ProcessSessions — available after Task 3; host may wire later.
}
