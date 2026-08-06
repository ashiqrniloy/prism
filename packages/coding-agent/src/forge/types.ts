import type { AgentIdentity, ExecutionPolicy, OwnershipScope, ToolEffectStore } from "@arnilo/prism";
import type { BoundGitRunner, CreateGitRunnerOptions } from "../git-exec.js";
import {
  DEFAULT_MAX_FORGE_COMMENTS_PER_REVIEW,
  DEFAULT_MAX_FORGE_PAGES_PER_OPERATION,
  DEFAULT_MAX_FORGE_PAYLOAD_BYTES,
  DEFAULT_MAX_FORGE_REQUEST_CONCURRENCY,
  DEFAULT_MAX_FORGE_REQUEST_TIMEOUT_MS,
  HARD_MAX_FORGE_COMMENTS_PER_REVIEW,
  HARD_MAX_FORGE_PAGES_PER_OPERATION,
  HARD_MAX_FORGE_PAYLOAD_BYTES,
  HARD_MAX_FORGE_REQUEST_CONCURRENCY,
  HARD_MAX_FORGE_REQUEST_TIMEOUT_MS,
  validateCodingLimit,
} from "../limits.js";

/** Read-only context for one GitHub issue, bounded by payload caps. */
export interface ForgeIssueContext {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly body: string;
  readonly labels: readonly string[];
  readonly author: string;
  readonly updatedAt: string;
  readonly url: string;
}

/** Pull-request state as seen through the forge. */
export interface ForgePullRequest {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

/** One check run or commit status, normalized. */
export interface ForgeCheck {
  readonly name: string;
  readonly status: "queued" | "in_progress" | "completed";
  readonly conclusion?: string;
  readonly detailsUrl?: string;
}

/** Bounded handoff reconciliation: push/PR/check state, never auto-merged. */
export interface ForgeHandoffReport {
  readonly base: string;
  readonly head: string;
  /** Whether the head ref exists on the remote. */
  readonly pushed: boolean;
  readonly aheadBy: number;
  readonly behindBy: number;
  /** No commits ahead and no divergence: nothing to push. */
  readonly alreadyUpToDate: boolean;
  readonly alreadyMerged: boolean;
  readonly pullRequest?: ForgePullRequest;
  readonly checks: readonly ForgeCheck[];
  /** Bounded commit list (sha + subject), present only when pushed. */
  readonly commits: readonly { sha: string; subject: string }[];
  /** Bounded changed paths, present only when pushed. */
  readonly changedPaths: readonly string[];
  readonly diffstat: string;
  readonly warnings: readonly string[];
}

export type ForgeErrorCode =
  | "ERR_PRISM_FORGE_AUTH"
  | "ERR_PRISM_FORGE_API"
  | "ERR_PRISM_FORGE_STALE"
  | "ERR_PRISM_FORGE_RATE_LIMIT"
  | "ERR_PRISM_FORGE_LIMIT"
  | "ERR_PRISM_FORGE_OWNERSHIP";

export class ForgeError extends Error {
  readonly code: ForgeErrorCode;
  constructor(code: ForgeErrorCode, message: string) {
    super(message);
    this.name = "ForgeError";
    this.code = code;
  }
}

export interface ForgeLimits {
  readonly pagesPerOperation?: number;
  readonly payloadBytes?: number;
  readonly commentsPerReview?: number;
  readonly requestConcurrency?: number;
  readonly requestTimeoutMs?: number;
}

export interface ResolvedForgeLimits {
  readonly pagesPerOperation: number;
  readonly payloadBytes: number;
  readonly commentsPerReview: number;
  readonly requestConcurrency: number;
  readonly requestTimeoutMs: number;
}

export function resolveForgeLimits(options?: ForgeLimits): ResolvedForgeLimits {
  return {
    pagesPerOperation: validateCodingLimit(
      "forge.pagesPerOperation",
      options?.pagesPerOperation ?? DEFAULT_MAX_FORGE_PAGES_PER_OPERATION,
      HARD_MAX_FORGE_PAGES_PER_OPERATION,
    ),
    payloadBytes: validateCodingLimit(
      "forge.payloadBytes",
      options?.payloadBytes ?? DEFAULT_MAX_FORGE_PAYLOAD_BYTES,
      HARD_MAX_FORGE_PAYLOAD_BYTES,
    ),
    commentsPerReview: validateCodingLimit(
      "forge.commentsPerReview",
      options?.commentsPerReview ?? DEFAULT_MAX_FORGE_COMMENTS_PER_REVIEW,
      HARD_MAX_FORGE_COMMENTS_PER_REVIEW,
    ),
    requestConcurrency: validateCodingLimit(
      "forge.requestConcurrency",
      options?.requestConcurrency ?? DEFAULT_MAX_FORGE_REQUEST_CONCURRENCY,
      HARD_MAX_FORGE_REQUEST_CONCURRENCY,
    ),
    requestTimeoutMs: validateCodingLimit(
      "forge.requestTimeoutMs",
      options?.requestTimeoutMs ?? DEFAULT_MAX_FORGE_REQUEST_TIMEOUT_MS,
      HARD_MAX_FORGE_REQUEST_TIMEOUT_MS,
    ),
  };
}

export interface ForgeOperations {
  issueContext(input: { number: number }): Promise<ForgeIssueContext>;
  push(input: { refspec?: string }): Promise<{ remoteRef: string }>;
  createPullRequest(input: { head: string; base: string; title: string; body: string }): Promise<ForgePullRequest>;
  updatePullRequest(input: { number: number; title?: string; body?: string; state?: "open" | "closed" }): Promise<ForgePullRequest>;
  createReviewComment(input: { number: number; path: string; line: number; body: string }): Promise<{ id: number }>;
  checks(input: { ref: string }): Promise<readonly ForgeCheck[]>;
  reconcileHandoff(input: { base: string; head: string }): Promise<ForgeHandoffReport>;
}

/** Structural mirror of the core `CredentialResolverSource` (not barrel-exported). */
export interface ForgeCredential {
  readonly type: "bearer" | "api_key" | "basic" | "custom";
  readonly value: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ForgeCredentialResolver {
  resolve(request: {
    readonly name: string;
    readonly provider?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<ForgeCredential | undefined> | ForgeCredential | undefined;
}

export interface ForgeCredentialResolverSource {
  readonly name: string;
  readonly resolver: ForgeCredentialResolver;
}

export interface CreateGitHubForgeOptions {
  /** Credential resolver — resolved with provider "github" per call. */
  readonly credentials: ForgeCredentialResolverSource;
  /** "owner/repo", bound per instance. */
  readonly repository: string;
  /** Local checkout the adapter pushes from. */
  readonly cwd: string;
  /** Git runner reused for authenticated push. */
  readonly git: CreateGitRunnerOptions | BoundGitRunner;
  /** Mutations are gated through this policy before any request. */
  readonly policy?: ExecutionPolicy;
  /** REQUIRED: idempotency + unknown-outcome recovery for mutations. */
  readonly effectStore: ToolEffectStore;
  /** Durable context for effect keys; required for mutations. */
  readonly identity?: AgentIdentity;
  readonly ownership?: OwnershipScope;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly limits?: ForgeLimits;
  /** Host-injectable fetch (e.g. routed through an egress proxy); defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch;
}
