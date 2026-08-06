// @arnilo/prism-coding-agent public barrel.
//
// First-party coding tools for the Prism agent harness. Factory functions return Prism
// `ToolDefinition`s that hosts register into a `ToolRegistry` (e.g.
// `createToolRegistry(createCodingTools(cwd))`). No tools are auto-registered — import what you need.

// --- per-tool factories & types ---

export { createDirectoryArtifactWriter, createTempArtifactWriter, sha256Hex } from "./artifacts.js";
export type {
  AskUserDecisionAnswer,
  AskUserDecisionHandler,
  AskUserDecisionOption,
  AskUserDecisionRequest,
  AskUserDecisionSelectionMode,
  AskUserDecisionSuspendData,
  AskUserDecisionToolOptions,
  ResolvedAskUserDecisionAnswer,
  ResolvedAskUserDecisionLimits,
  SuspendAskUserDecisionOptions,
} from "./ask-user-decision.js";
export {
  ASK_USER_DECISION_RATIONALE_COUNT,
  ASK_USER_DECISION_SUSPEND_REASON,
  ASK_USER_DECISION_TOOL_NAME,
  askUserDecisionResumeSchema,
  createAskUserDecisionResumeValidator,
  createAskUserDecisionTool,
  DEFAULT_MAX_ASK_USER_DECISION_BULLET_BYTES,
  DEFAULT_MAX_ASK_USER_DECISION_CUSTOM_BYTES,
  DEFAULT_MAX_ASK_USER_DECISION_LABEL_BYTES,
  DEFAULT_MAX_ASK_USER_DECISION_OPTIONS,
  DEFAULT_MAX_ASK_USER_DECISION_QUESTION_BYTES,
  HARD_MAX_ASK_USER_DECISION_BULLET_BYTES,
  HARD_MAX_ASK_USER_DECISION_CUSTOM_BYTES,
  HARD_MAX_ASK_USER_DECISION_LABEL_BYTES,
  HARD_MAX_ASK_USER_DECISION_OPTIONS,
  HARD_MAX_ASK_USER_DECISION_QUESTION_BYTES,
  parseAskUserDecisionArgs,
  resolveAskUserDecisionAnswer,
  resolveAskUserDecisionLimits,
  suspendAskUserDecision,
  toAskUserDecisionSuspendData,
  validateAskUserDecisionAgentResume,
  validateAskUserDecisionResume,
} from "./ask-user-decision.js";
export type { CodingCheckToolOptions, NamedCheckDefinition } from "./checks.js";
export { createCodingCheckTool } from "./checks.js";
export type { DeleteOperations, DeleteToolOptions, MutationStat } from "./delete.js";
export { createDeleteTool } from "./delete.js";
export type {
  CodingArtifactKind,
  CodingArtifactRef,
  CodingCheckpointLimitOptions,
  CodingCheckpointMetadata,
  CodingCheckSummary,
  CodingFingerprints,
  CodingHandoffSummary,
  CodingTaskStatus,
  CodingTodoItem,
  ResolvedCodingCheckpointLimits,
} from "./coding-checkpoint.js";
export {
  assertCodingResumeAllowed,
  buildCodingCheckpointMetadata,
  CODING_CHECKPOINT_SCHEMA_VERSION,
  CODING_STATE_KEY,
  CodingCheckpointError,
  codingCheckpointStatePatch,
  codingPlanPathForTask,
  createCodingArtifactRef,
  createCodingPlanMarkdown,
  fingerprintJson,
  parseCodingPlanTodos,
  readCodingCheckpointFromState,
  readCodingPlanFile,
  resolveCodingCheckpointLimits,
  validateCodingCheckpointMetadata,
  verifyCodingArtifactBytes,
  writeCodingPlanFile,
} from "./coding-checkpoint.js";
export type { Edit, EditOperations, EditToolDetails, EditToolOptions } from "./edit.js";
export { createEditTool } from "./edit.js";
export type { CodingEffectReconciliation, CodingEffectReconciliationInput } from "./effects.js";
export {
  classifyGitApplyEffect,
  classifyGitBranchEffect,
  classifyGitWorktreeEffect,
  CODING_LOCAL_EFFECT,
  CODING_OBSERVATION_EFFECT,
  CODING_UNSUPPORTED_EFFECT,
  reconcileCodingToolEffect,
} from "./effects.js";
export type {
  ArtifactReference,
  ArtifactWriter,
  BoundGitRunner,
  CreateGitOperationsOptions,
  CreateGitRunnerOptions,
  GitExecRequest,
  GitExecResult,
  GitLimitOptions,
  GitOperations,
  GitRunner,
  GitStatusBranch,
  GitStatusEntry,
  GitStatusEntryKind,
  GitStatusResult,
  PrHandoff,
  ResolvedGitLimits,
} from "./git.js";
export {
  createBoundGitRunner,
  createGitOperations,
  GitError,
  parsePorcelainV2,
  resolveGitLimits,
  runGitCli,
  SAFE_GIT_CONFIG_ARGS,
  SAFE_GIT_ENV,
} from "./git.js";
export type { GitToolsOptions } from "./git-tools.js";
export {
  createGitApplyTool,
  createGitBranchTool,
  createGitCommitTool,
  createGitDiffTool,
  createGitPrHandoffTool,
  createGitStatusTool,
  createGitTools,
  createGitWorktreeTool,
} from "./git-tools.js";
export type {
  CodingGoalVerifyApproval,
  RunCodingGoalVerifyOptions,
} from "./goal-verify.js";
export {
  CODING_GOAL_VERIFY_REVISION,
  CODING_GOAL_VERIFY_SUSPEND_REASON,
  CODING_GOAL_VERIFY_WORKFLOW_ID,
  CodingGoalVerifyError,
  createCodingGoalVerifyWorkflow,
  runCodingGoalVerify,
} from "./goal-verify.js";
export type { GlobToolOptions } from "./glob.js";
export { createGlobTool } from "./glob.js";
export { matchGlobPattern, validateGlobPattern } from "./glob-match.js";
export type { ListToolOptions } from "./list.js";
export { createRepoListTool } from "./list.js";
export type { MoveOperations, MoveToolOptions } from "./move.js";
export { createMoveTool } from "./move.js";
export type {
  ReadOperations,
  ReadTextOptions,
  ReadTextResult,
  ReadToolOptions,
  TransformImage,
  TransformImageInput,
} from "./read.js";
export {
  createReadTool,
  DEFAULT_MAX_IMAGE_BYTES,
  detectSupportedImageMimeType,
  detectSupportedImageMimeTypeFromFile,
} from "./read.js";
export type { ReadPathSet } from "./read-path-set.js";
export { createReadPathSet } from "./read-path-set.js";
export type {
  RepoEntryKind,
  RepoListEntry,
  RepositoryGlobRequest,
  RepositoryGlobResult,
  RepositoryLimitOptions,
  RepositoryListRequest,
  RepositoryListResult,
  RepositoryOperations,
  RepoSearchOutputMode,
  RepositorySearchMatch,
  RepositorySearchRequest,
  RepositorySearchResult,
  ResolvedRepositoryLimits,
  RepositoryWalk,
  RepositoryWalkEvent,
  RepositoryWalkLimits,
} from "./repository.js";
export {
  compileSearchPattern,
  createLocalRepositoryOperations,
  DEFAULT_REPO_EXCLUDE,
  isBinaryBuffer,
  RepositoryError,
  resolveRepoPath,
  resolveRepositoryLimits,
  toRepoRelative,
} from "./repository.js";
export type { GitAwareRepositoryOptions } from "./git-aware-repository.js";
export { createGitAwareRepositoryOperations, parseGitLsFilesZ } from "./git-aware-repository.js";
export type {
  CreateLanguageIntelligenceOptions,
  LanguageDiagnostic,
  LanguageIntelligence,
  LanguageIntelligenceLimits,
  LanguageLocation,
  LanguageServerSpec,
  LanguageSymbol,
  LanguageTextEdit,
  LanguageWorkspaceEdit,
} from "./language/index.js";
export {
  applyTextEdits,
  createLanguageIntelligence,
  encodeLspFrame,
  LanguageIntelligenceError,
  LspFrameError,
  LspFrameReader,
  resolveLanguageIntelligenceLimits,
} from "./language/index.js";
export type {
  CreateGitHubForgeOptions,
  ForgeCheck,
  ForgeCredential,
  ForgeCredentialResolver,
  ForgeCredentialResolverSource,
  ForgeErrorCode,
  ForgeHandoffReport,
  ForgeIssueContext,
  ForgeLimits,
  ForgeOperations,
  ForgePullRequest,
  ResolvedForgeLimits,
} from "./forge/index.js";
export { createGitHubForge, ForgeError, resolveForgeLimits } from "./forge/index.js";
export type {
  CodingProcessEvent,
  CreateProcessSessionsOptions,
  ProcessExitResult,
  ProcessOutputChunk,
  ProcessSandboxBackend,
  ProcessSandboxHandle,
  ProcessSandboxStartRequest,
  ProcessSession,
  ProcessSessionLimits,
  ProcessSessionMetadata,
  ProcessSessions,
  ProcessSessionState,
  ProcessStartRequest,
  ResolvedProcessSessionLimits,
} from "./process/index.js";
export {
  createProcessSessions,
  ProcessSessionError,
  resolveProcessSessionLimits,
} from "./process/index.js";
export type { SearchToolOptions } from "./search.js";
export { createRepoSearchTool } from "./search.js";
export type {
  BashExecOptions,
  BashOperations,
  BashSpawnContext,
  BashSpawnHook,
  ShellConfig,
  ShellToolOptions,
} from "./shell.js";
export {
  createLocalBashOperations,
  createShellTool,
  getShellConfig,
  killProcessTree,
  waitForChildProcess,
} from "./shell.js";
export type { WriteOperations, WriteToolOptions } from "./write.js";
export { createWriteTool } from "./write.js";

// --- generic primitives (re-exported for hosts that want them) ---

export { enforceExecutionPolicy } from "./execution-policy.js";
export { withFileMutationQueue } from "./file-mutation-queue.js";
export {
  DEFAULT_CHECK_TIMEOUT_MS,
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_CHECK_CONCURRENCY,
  DEFAULT_MAX_CHECK_DIAGNOSTIC_LINES,
  DEFAULT_MAX_CHECK_NAMES,
  DEFAULT_MAX_CHECK_OUTPUT_BYTES,
  DEFAULT_MAX_CHECK_SUMMARY_BYTES,
  DEFAULT_MAX_CODING_ARTIFACT_BYTES,
  DEFAULT_MAX_CODING_ARTIFACTS,
  DEFAULT_MAX_CODING_CHECKPOINT_BYTES,
  DEFAULT_MAX_EDIT_FILE_BYTES,
  DEFAULT_MAX_EDIT_INPUT_BYTES,
  DEFAULT_MAX_EDITS,
  DEFAULT_MAX_FORGE_COMMENTS_PER_REVIEW,
  DEFAULT_MAX_FORGE_PAGES_PER_OPERATION,
  DEFAULT_MAX_FORGE_PAYLOAD_BYTES,
  DEFAULT_MAX_FORGE_REQUEST_CONCURRENCY,
  DEFAULT_MAX_FORGE_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_GIT_CHANGED_FILES,
  DEFAULT_MAX_GIT_DIFF_LINES,
  DEFAULT_MAX_GIT_MESSAGE_BYTES,
  DEFAULT_MAX_GIT_OUTPUT_BYTES,
  DEFAULT_MAX_LS_FILES_OUTPUT_BYTES,
  DEFAULT_MAX_LSP_DIAGNOSTICS_PER_FILE,
  DEFAULT_MAX_LSP_MESSAGE_BYTES,
  DEFAULT_MAX_LSP_PENDING_REQUESTS,
  DEFAULT_MAX_LSP_RESULTS_PER_QUERY,
  DEFAULT_MAX_LSP_SERVERS,
  DEFAULT_MAX_LSP_TIMEOUT_MS,
  DEFAULT_MAX_GIT_PATCH_BYTES,
  DEFAULT_MAX_GIT_PATHS,
  DEFAULT_MAX_GIT_REF_BYTES,
  DEFAULT_MAX_GIT_WORKTREES,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_PLAN_BYTES,
  DEFAULT_MAX_PR_COMMITS,
  DEFAULT_MAX_PR_HANDOFF_BYTES,
  DEFAULT_MAX_PROCESS_INPUT_BYTES,
  DEFAULT_MAX_PROCESS_LIFETIME_MS,
  DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
  DEFAULT_MAX_PROCESS_SESSIONS,
  DEFAULT_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
  DEFAULT_MAX_REPO_CONCURRENCY,
  DEFAULT_MAX_REPO_DEPTH,
  DEFAULT_MAX_REPO_ENTRIES,
  DEFAULT_MAX_REPO_FILES,
  DEFAULT_MAX_REPO_RESULTS,
  DEFAULT_MAX_SEARCH_CONTEXT_LINES,
  DEFAULT_MAX_SEARCH_FILE_BYTES,
  DEFAULT_MAX_SEARCH_LINE_BYTES,
  DEFAULT_MAX_SEARCH_MATCHES,
  DEFAULT_MAX_SEARCH_PATTERN_BYTES,
  DEFAULT_MAX_SEARCH_SCAN_BYTES,
  DEFAULT_MAX_SEARCH_TIME_MS,
  DEFAULT_MAX_TEXT_SCAN_BYTES,
  DEFAULT_MAX_TODO_TEXT_BYTES,
  DEFAULT_MAX_TODOS,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
  DEFAULT_MAX_WRITE_BYTES,
  DEFAULT_SHELL_TIMEOUT_SECONDS,
  HARD_CHECK_TIMEOUT_MS,
  HARD_GIT_TIMEOUT_MS,
  HARD_MAX_BYTES,
  HARD_MAX_CHECK_CONCURRENCY,
  HARD_MAX_CHECK_DIAGNOSTIC_LINES,
  HARD_MAX_CHECK_NAMES,
  HARD_MAX_CHECK_OUTPUT_BYTES,
  HARD_MAX_CHECK_SUMMARY_BYTES,
  HARD_MAX_CODING_ARTIFACT_BYTES,
  HARD_MAX_CODING_ARTIFACTS,
  HARD_MAX_CODING_CHECKPOINT_BYTES,
  HARD_MAX_EDIT_FILE_BYTES,
  HARD_MAX_EDIT_INPUT_BYTES,
  HARD_MAX_EDITS,
  HARD_MAX_FORGE_COMMENTS_PER_REVIEW,
  HARD_MAX_FORGE_PAGES_PER_OPERATION,
  HARD_MAX_FORGE_PAYLOAD_BYTES,
  HARD_MAX_FORGE_REQUEST_CONCURRENCY,
  HARD_MAX_FORGE_REQUEST_TIMEOUT_MS,
  HARD_MAX_GIT_CHANGED_FILES,
  HARD_MAX_GIT_DIFF_LINES,
  HARD_MAX_GIT_MESSAGE_BYTES,
  HARD_MAX_GIT_OUTPUT_BYTES,
  HARD_MAX_LS_FILES_OUTPUT_BYTES,
  HARD_MAX_LSP_DIAGNOSTICS_PER_FILE,
  HARD_MAX_LSP_MESSAGE_BYTES,
  HARD_MAX_LSP_PENDING_REQUESTS,
  HARD_MAX_LSP_RESULTS_PER_QUERY,
  HARD_MAX_LSP_SERVERS,
  HARD_MAX_LSP_TIMEOUT_MS,
  HARD_MAX_GIT_PATCH_BYTES,
  HARD_MAX_GIT_PATHS,
  HARD_MAX_GIT_REF_BYTES,
  HARD_MAX_GIT_WORKTREES,
  HARD_MAX_IMAGE_BYTES,
  HARD_MAX_LINES,
  HARD_MAX_PLAN_BYTES,
  HARD_MAX_PR_COMMITS,
  HARD_MAX_PR_HANDOFF_BYTES,
  HARD_MAX_PROCESS_INPUT_BYTES,
  HARD_MAX_PROCESS_LIFETIME_MS,
  HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
  HARD_MAX_PROCESS_SESSIONS,
  HARD_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
  HARD_MAX_REPO_CONCURRENCY,
  HARD_MAX_REPO_DEPTH,
  HARD_MAX_REPO_ENTRIES,
  HARD_MAX_REPO_FILES,
  HARD_MAX_REPO_RESULTS,
  HARD_MAX_SEARCH_CONTEXT_LINES,
  HARD_MAX_SEARCH_FILE_BYTES,
  HARD_MAX_SEARCH_LINE_BYTES,
  HARD_MAX_SEARCH_MATCHES,
  HARD_MAX_SEARCH_PATTERN_BYTES,
  HARD_MAX_SEARCH_SCAN_BYTES,
  HARD_MAX_SEARCH_TIME_MS,
  HARD_MAX_TEXT_SCAN_BYTES,
  HARD_MAX_TODO_TEXT_BYTES,
  HARD_MAX_TODOS,
  HARD_MAX_TOTAL_OUTPUT_BYTES,
  HARD_MAX_WRITE_BYTES,
  HARD_SHELL_TIMEOUT_SECONDS,
  LSP_RESTARTS_PER_SERVER,
} from "./limits.js";

// --- aggregators ---

import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import type { DeleteToolOptions } from "./delete.js";
import { createDeleteTool } from "./delete.js";
import type { EditToolOptions } from "./edit.js";
import { createEditTool } from "./edit.js";
import type { GlobToolOptions } from "./glob.js";
import { createGlobTool } from "./glob.js";
import type { ListToolOptions } from "./list.js";
import { createRepoListTool } from "./list.js";
import type { MoveToolOptions } from "./move.js";
import { createMoveTool } from "./move.js";
import type { ReadToolOptions } from "./read.js";
import { createReadTool } from "./read.js";
import type { RepositoryLimitOptions, RepositoryOperations } from "./repository.js";
import type { SearchToolOptions } from "./search.js";
import { createRepoSearchTool } from "./search.js";
import type { ShellToolOptions } from "./shell.js";
import { createShellTool } from "./shell.js";
import type { WriteToolOptions } from "./write.js";
import { createWriteTool } from "./write.js";

/** Per-tool options combined for the aggregator factories. */
export interface ToolsOptions {
  /** Shared execution policy applied to every coding tool unless overridden per tool. */
  executionPolicy?: ExecutionPolicy;
  shell?: ShellToolOptions;
  read?: ReadToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  delete?: DeleteToolOptions;
  move?: MoveToolOptions;
  list?: ListToolOptions;
  search?: SearchToolOptions;
  glob?: GlobToolOptions;
  /**
   * Shared repository limits/backends for `repo_list` / `repo_search` / `glob`.
   * Per-tool `list` / `search` / `glob` options override these when both are set.
   */
  repository?: RepositoryLimitOptions & { operations?: RepositoryOperations };
}

function withSharedExecutionPolicy<T extends { executionPolicy?: ExecutionPolicy }>(
  toolOptions: T | undefined,
  shared?: ExecutionPolicy,
): T {
  if (!shared) return (toolOptions ?? {}) as T;
  return { ...(toolOptions ?? {}), executionPolicy: toolOptions?.executionPolicy ?? shared } as T;
}

function withRepositoryDefaults(
  toolOptions: ListToolOptions | SearchToolOptions | GlobToolOptions | undefined,
  shared?: ToolsOptions["repository"],
): ListToolOptions | SearchToolOptions | GlobToolOptions {
  if (!shared && !toolOptions) return {};
  return {
    ...(toolOptions ?? {}),
    repository: toolOptions?.repository ?? shared,
    operations: toolOptions?.operations ?? shared?.operations,
    exclude: toolOptions?.exclude ?? shared?.exclude,
  };
}

/**
 * Full coding tool set: `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move`.
 * Opt-in tools (`createGitTools`, `createAskUserDecisionTool`, `createCodingCheckTool`)
 * stay out — hosts register them explicitly.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  const listOpts = withRepositoryDefaults(options?.list, options?.repository) as ListToolOptions;
  const searchOpts = withRepositoryDefaults(options?.search, options?.repository) as SearchToolOptions;
  const globOpts = withRepositoryDefaults(options?.glob, options?.repository) as GlobToolOptions;
  return [
    createShellTool(cwd, withSharedExecutionPolicy(options?.shell, policy)),
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createWriteTool(cwd, withSharedExecutionPolicy(options?.write, policy)),
    createEditTool(cwd, withSharedExecutionPolicy(options?.edit, policy)),
    createRepoListTool(cwd, withSharedExecutionPolicy(listOpts, policy)),
    createRepoSearchTool(cwd, withSharedExecutionPolicy(searchOpts, policy)),
    createGlobTool(cwd, withSharedExecutionPolicy(globOpts, policy)),
    createDeleteTool(cwd, withSharedExecutionPolicy(options?.delete, policy)),
    createMoveTool(cwd, withSharedExecutionPolicy(options?.move, policy)),
  ];
}

/**
 * Read-only subset: `read`, `repo_list`, `repo_search`, `glob`.
 * Deliberate 0.0.9 expansion from the previous `read`-only set.
 */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  const listOpts = withRepositoryDefaults(options?.list, options?.repository) as ListToolOptions;
  const searchOpts = withRepositoryDefaults(options?.search, options?.repository) as SearchToolOptions;
  const globOpts = withRepositoryDefaults(options?.glob, options?.repository) as GlobToolOptions;
  return [
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createRepoListTool(cwd, withSharedExecutionPolicy(listOpts, policy)),
    createRepoSearchTool(cwd, withSharedExecutionPolicy(searchOpts, policy)),
    createGlobTool(cwd, withSharedExecutionPolicy(globOpts, policy)),
  ];
}

/** Every tool this package provides — identical to {@link createCodingTools}. */
export function createAllTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  return createCodingTools(cwd, options);
}
