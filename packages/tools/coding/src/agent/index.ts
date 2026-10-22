// @arnilo/prism-tools-coding public barrel.
//
// First-party coding tools for the Prism agent harness. Factory functions return Prism
// `ToolDefinition`s that hosts register into a `ToolRegistry` (e.g.
// `createToolRegistry(createCodingTools(cwd))`). No tools are auto-registered — import what you need.

// --- per-tool factories & types ---

export type { TextFileClient } from "./acp-operations.js";
export { createAcpFilesystemOperations } from "./acp-operations.js";
export { createDirectoryArtifactWriter, createTempArtifactWriter, sha256Hex } from "./artifacts.js";
export type {
  AskUserDecisionAnswer,
  AskUserDecisionOption,
  AskUserDecisionRequest,
  AskUserDecisionSelectionMode,
  AskUserDecisionSuspendData,
  AskUserDecisionToolOptions,
  AskUserDecisionUiOutcome,
  ResolvedAskUserDecisionAnswer,
  ResolvedAskUserDecisionLimits,
} from "./ask-user-decision.js";
export {
  ASK_USER_DECISION_CUSTOM_VALUE,
  ASK_USER_DECISION_RATIONALE_COUNT,
  ASK_USER_DECISION_SUSPEND_REASON,
  ASK_USER_DECISION_TOOL_NAME,
  askUserDecisionResumeSchema,
  askUserDecisionViaUi,
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
  toAskUserDecisionSuspendData,
} from "./ask-user-decision.js";
export type { CodingCheckToolOptions, NamedCheckDefinition } from "./checks.js";
export { createCodingCheckTool } from "./checks.js";
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
export type { DeleteOperations, DeleteToolOptions, MutationStat } from "./delete.js";
export { createDeleteTool } from "./delete.js";
export type {
  DiagnosticDelta,
  DiagnosticDeltaRequest,
  DiagnosticSeverity,
  NormalizeDiagnosticsOptions,
  NormalizedDiagnostic,
  RawDiagnostic,
  ResolvedDiagnosticsLimits,
} from "./diagnostics.js";
export { diagnosticDelta, diagnosticIdentity, normalizeDiagnostics, resolveDiagnosticsLimits } from "./diagnostics.js";
export type { Edit, EditOperations, EditToolDetails, EditToolOptions } from "./edit.js";
export { createEditTool } from "./edit.js";
export type { CodingEffectReconciliation, CodingEffectReconciliationInput } from "./effects.js";
export {
  CODING_LOCAL_EFFECT,
  CODING_OBSERVATION_EFFECT,
  CODING_UNSUPPORTED_EFFECT,
  reconcileCodingToolEffect,
} from "./effects.js";
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
export type { GitAwareRepositoryOptions } from "./git-aware-repository.js";
export { createGitAwareRepositoryOperations, parseGitLsFilesZ } from "./git-aware-repository.js";
export type { GitToolsOptions } from "./git-tools.js";
export {
  createGitCommitTool,
  createGitDiffTool,
  createGitPrHandoffTool,
  createGitStatusTool,
  createGitTools,
} from "./git-tools.js";
export type { GlobToolOptions } from "./glob.js";
export { createGlobTool } from "./glob.js";
export { compileGlob, matchGlobPattern, validateGlobPattern } from "./glob-match.js";
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
export type { GrepToolOptions } from "./grep.js";
export { createGrepTool } from "./grep.js";
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
  languageIdForPath,
  resolveLanguageIntelligenceLimits,
} from "./language/index.js";
export type {
  CodingLifecycleEmitter,
  CodingLifecycleEvent,
  CodingLifecycleLimits,
  ConfigurationChangedEvent,
  CreateCodingLifecycleEmitterOptions,
  FileChangedEvent,
  FileChangeOp,
  PermissionDeniedEvent,
  ResolvedCodingLifecycleLimits,
  SubagentFailure,
  SubagentRecovery,
  SubagentRecoveryOutcome,
  SubagentStartedEvent,
  SubagentStoppedEvent,
  WorktreeChangedEvent,
} from "./lifecycle.js";
export {
  CodingLifecycleError,
  createCodingLifecycleEmitter,
  resolveCodingLifecycleLimits,
} from "./lifecycle.js";
export type { MoveOperations, MoveToolOptions } from "./move.js";
export { createMoveTool } from "./move.js";
export type {
  CodingProcessEvent,
  CreateProcessSessionsOptions,
  ProcessExitResult,
  ProcessOutputChunk,
  // host-selected PTY backend: pass ptyBackend to createProcessSessions to
  // enable pty: true (delegates only to the host adapter; see process/types.ts)
  ProcessPtyBackend,
  ProcessPtyHandle,
  ProcessPtyStartRequest,
  ProcessRecoveryBackend,
  ProcessRecoveryErrorCode,
  ProcessRecoveryLimits,
  ProcessRecoveryOutcome,
  ProcessRecoveryRecord,
  ProcessRecoveryRecordReport,
  ProcessRecoveryReport,
  ProcessSandboxBackend,
  ProcessSandboxHandle,
  ProcessSandboxStartRequest,
  ProcessSession,
  ProcessSessionLimits,
  ProcessSessionMetadata,
  ProcessSessionState,
  ProcessSessions,
  ProcessStartRequest,
  ProcessTerminalRequest,
  ProcessTerminalResize,
  ResolvedProcessRecoveryLimits,
  ResolvedProcessSessionLimits,
} from "./process/index.js";
// durable process/ACP recovery seam (plan 026 Task 5): recover() is
// attach-if-attested and never fabricates an exit code; exports below
export {
  createProcessSessions,
  PROCESS_RECOVERY_CATEGORY,
  PROCESS_RECOVERY_LEASE_NAMESPACE,
  PROCESS_RECOVERY_NAMESPACE,
  PROCESS_RECOVERY_SCHEMA_VERSION,
  ProcessRecoveryError,
  ProcessSessionError,
  resolveProcessRecoveryLimits,
  resolveProcessSessionLimits,
  validateBackendRef,
  validateProcessRecoveryRecord,
} from "./process/index.js";
export type {
  DocumentReader,
  DocumentReaderResult,
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
export {
  createReadPathSet,
  createReadPathSetPersistence,
  DEFAULT_MAX_PERSISTED_READ_PATH_CHARS,
  DEFAULT_MAX_PERSISTED_READ_PATHS,
  READ_PATH_SET_NAMESPACE,
} from "./read-path-set.js";
export type {
  IndexedRepositoryOptions,
  IndexFacade,
  IndexFileChange,
  IndexLimitOptions,
  IndexResourceDiagnostics,
  IndexSearchHit,
  IndexState,
  RepoEntryKind,
  RepoListEntry,
  RepoSearchMode,
  RepoSearchOutputMode,
  RepositoryFileMatcher,
  RepositoryGlobRequest,
  RepositoryGlobResult,
  RepositoryIndexBackend,
  RepositoryIndexQueryRequest,
  RepositoryIndexQueryResult,
  RepositoryIndexRemoveRequest,
  RepositoryIndexStatus,
  RepositoryIndexUpdateRequest,
  RepositoryLimitOptions,
  RepositoryLineMatch,
  RepositoryListRequest,
  RepositoryListResult,
  RepositoryOperations,
  RepositorySearchMatch,
  RepositorySearchRequest,
  RepositorySearchResult,
  RepositoryWalk,
  RepositoryWalkEvent,
  RepositoryWalkLimits,
  ResolvedIndexLimits,
  ResolvedRepositoryLimits,
} from "./repository.js";
// host-indexed search seam (plan 026 Task 2): compose a host index with the
// literal fallback; indexed_literal/semantic never fall back silently
export {
  compileSearchPattern,
  createIndexedRepositoryOperations,
  createLocalRepositoryOperations,
  DEFAULT_REPO_EXCLUDE,
  IndexError,
  isBinaryBuffer,
  literalMatcher,
  matchLines,
  RepositoryError,
  resolveIndexLimits,
  resolveRepoPath,
  resolveRepositoryLimits,
  toRepoRelative,
} from "./repository.js";
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
export type {
  BackgroundProcesses,
  BackgroundProcessOptions,
  BackgroundRead,
  BackgroundReadInput,
  BackgroundStarted,
  BackgroundStartInput,
} from "./shell-background.js";
export {
  BACKGROUND_FIRST_OUTPUT_MS,
  createBackgroundProcesses,
  DEFAULT_MAX_BACKGROUND_PROCESSES,
  HARD_MAX_BACKGROUND_PROCESSES,
  HARD_MAX_BACKGROUND_WAIT_SECONDS,
} from "./shell-background.js";
export type { ShellOutputToolOptions } from "./shell-output.js";
export { createShellOutputTool } from "./shell-output.js";
export type { DiagnosticsToolHandle, DiagnosticsToolOptions } from "./diagnostics-tool.js";
export { createDiagnosticsTool } from "./diagnostics-tool.js";
export type {
  TodoContinuationDecision,
  TodoContinuationOptions,
  TodoItem,
  TodoListMetadata,
  TodoNoProgressStopInfo,
  TodoStatus,
  TodoWriteToolOptions,
} from "./todo.js";
export {
  createTodoContinuationDecision,
  createTodoWriteTool,
  DEFAULT_MAX_TODO_CONTENT_BYTES,
  DEFAULT_MAX_TODO_ID_BYTES,
  DEFAULT_MAX_TODO_ITEMS,
  DEFAULT_MAX_TODO_NO_PROGRESS,
  DEFAULT_MAX_TODO_STEER_BYTES,
  DEFAULT_MAX_TODO_STEER_ITEMS,
  formatTodoList,
  HARD_MAX_TODO_CONTENT_BYTES,
  HARD_MAX_TODO_ID_BYTES,
  HARD_MAX_TODO_ITEMS,
  HARD_MAX_TODO_NO_PROGRESS,
  HARD_MAX_TODO_STEER_BYTES,
  HARD_MAX_TODO_STEER_ITEMS,
  latestTodoList,
  parseTodoListMetadata,
  parseTodoWriteArgs,
  TODO_STATUSES,
  TODO_WRITE_TOOL_NAME,
  todoPinnedEntryIds,
} from "./todo.js";
export type { WriteOperations, WriteToolOptions } from "./write.js";
export { createWriteTool } from "./write.js";

// --- generic primitives (re-exported for hosts that want them) ---

export type { ExecutionAction, ExecutionDecision, ExecutionPolicy, ExecutionRisk } from "./execution-policy.js";
export {
  applyExecutionDecision,
  assertExecutionAllowed,
  checkExecution,
  ExecutionDeniedError,
  enforceExecutionPolicy,
} from "./execution-policy.js";
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
  DEFAULT_MAX_GIT_PATCH_BYTES,
  DEFAULT_MAX_GIT_PATHS,
  DEFAULT_MAX_GIT_REF_BYTES,
  DEFAULT_MAX_GIT_WORKTREES,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_LS_FILES_OUTPUT_BYTES,
  DEFAULT_MAX_LSP_DIAGNOSTICS_PER_FILE,
  DEFAULT_MAX_LSP_MESSAGE_BYTES,
  DEFAULT_MAX_LSP_PENDING_REQUESTS,
  DEFAULT_MAX_LSP_RESULTS_PER_QUERY,
  DEFAULT_MAX_LSP_SERVERS,
  DEFAULT_MAX_LSP_TIMEOUT_MS,
  DEFAULT_MAX_PLAN_BYTES,
  DEFAULT_MAX_PR_COMMITS,
  DEFAULT_MAX_PR_HANDOFF_BYTES,
  DEFAULT_MAX_PROCESS_INPUT_BYTES,
  DEFAULT_MAX_PROCESS_LIFETIME_MS,
  DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
  DEFAULT_MAX_PROCESS_SESSIONS,
  DEFAULT_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
  DEFAULT_MAX_PTY_ATTACH_TIMEOUT_MS,
  DEFAULT_MAX_PTY_BACKEND_METADATA_BYTES,
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
  DEFAULT_MAX_TERMINAL_COLUMNS,
  DEFAULT_MAX_TERMINAL_RESIZES_PER_MINUTE,
  DEFAULT_MAX_TERMINAL_ROWS,
  DEFAULT_MAX_TERMINAL_TERM_BYTES,
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
  HARD_MAX_GIT_PATCH_BYTES,
  HARD_MAX_GIT_PATHS,
  HARD_MAX_GIT_REF_BYTES,
  HARD_MAX_GIT_WORKTREES,
  HARD_MAX_IMAGE_BYTES,
  HARD_MAX_LINES,
  HARD_MAX_LS_FILES_OUTPUT_BYTES,
  HARD_MAX_LSP_DIAGNOSTICS_PER_FILE,
  HARD_MAX_LSP_MESSAGE_BYTES,
  HARD_MAX_LSP_PENDING_REQUESTS,
  HARD_MAX_LSP_RESULTS_PER_QUERY,
  HARD_MAX_LSP_SERVERS,
  HARD_MAX_LSP_TIMEOUT_MS,
  HARD_MAX_PLAN_BYTES,
  HARD_MAX_PR_COMMITS,
  HARD_MAX_PR_HANDOFF_BYTES,
  HARD_MAX_PROCESS_INPUT_BYTES,
  HARD_MAX_PROCESS_LIFETIME_MS,
  HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES,
  HARD_MAX_PROCESS_SESSIONS,
  HARD_MAX_PROCESS_TOTAL_OUTPUT_BYTES,
  HARD_MAX_PTY_ATTACH_TIMEOUT_MS,
  HARD_MAX_PTY_BACKEND_METADATA_BYTES,
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
  HARD_MAX_TERMINAL_COLUMNS,
  HARD_MAX_TERMINAL_RESIZES_PER_MINUTE,
  HARD_MAX_TERMINAL_ROWS,
  HARD_MAX_TERMINAL_TERM_BYTES,
  HARD_MAX_TEXT_SCAN_BYTES,
  HARD_MAX_TODO_TEXT_BYTES,
  HARD_MAX_TODOS,
  HARD_MAX_TOTAL_OUTPUT_BYTES,
  HARD_MAX_WRITE_BYTES,
  HARD_SHELL_TIMEOUT_SECONDS,
  LSP_RESTARTS_PER_SERVER,
} from "./limits.js";

// --- aggregators ---

import type { ToolDefinition } from "@arnilo/prism";
import type { DeleteToolOptions } from "./delete.js";
import { createDeleteTool } from "./delete.js";
import type { EditToolOptions } from "./edit.js";
import { createEditTool } from "./edit.js";
import type { ExecutionPolicy } from "./execution-policy.js";
import type { GlobToolOptions } from "./glob.js";
import { createGlobTool } from "./glob.js";
import type { GrepToolOptions } from "./grep.js";
import { createGrepTool } from "./grep.js";
import type { MoveToolOptions } from "./move.js";
import { createMoveTool } from "./move.js";
import type { ReadToolOptions } from "./read.js";
import { createReadTool } from "./read.js";
import type { RepositoryLimitOptions, RepositoryOperations } from "./repository.js";
import type { ShellToolOptions } from "./shell.js";
import { createShellTool } from "./shell.js";
import { createShellOutputTool } from "./shell-output.js";
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
  /**
   * Whether a shell backs this set (default true). When false, `shell` is omitted and the
   * effect-classified `delete`/`move` substitutes are registered instead.
   */
  shellAvailable?: boolean;
  grep?: GrepToolOptions;
  /** @deprecated use `grep` */
  search?: GrepToolOptions;
  glob?: GlobToolOptions;
  /**
   * Shared repository limits/backends for `grep` / `glob`.
   * Per-tool `search` / `glob` options override these when both are set.
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
  toolOptions: GrepToolOptions | GlobToolOptions | undefined,
  shared?: ToolsOptions["repository"],
): GrepToolOptions | GlobToolOptions {
  if (!shared && !toolOptions) return {};
  return {
    ...(toolOptions ?? {}),
    repository: toolOptions?.repository ?? shared,
    operations: toolOptions?.operations ?? shared?.operations,
    exclude: toolOptions?.exclude ?? shared?.exclude,
  };
}

/**
 * Full coding tool set: `shell`, `read`, `write`, `edit`, `grep`, `glob` — plus `delete` and `move`
 * when `shellAvailable` is false. `delete`/`move` exist so a shell-less host still has
 * effect-classified deletes and moves; with a shell, `rm`/`mv` are one call and the extra
 * schemas are pure cost (plan 189 Task 8).
 * Opt-in tools (`createGitTools`, `createAskUserDecisionTool`, `createCodingCheckTool`)
 * stay out — hosts register them explicitly.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  const searchOpts = withRepositoryDefaults(options?.grep ?? options?.search, options?.repository) as GrepToolOptions;
  const globOpts = withRepositoryDefaults(options?.glob, options?.repository) as GlobToolOptions;
  const fileTools: ToolDefinition[] = [
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createWriteTool(cwd, withSharedExecutionPolicy(options?.write, policy)),
    createEditTool(cwd, withSharedExecutionPolicy(options?.edit, policy)),
    createGrepTool(cwd, withSharedExecutionPolicy(searchOpts, policy)),
    createGlobTool(cwd, withSharedExecutionPolicy(globOpts, policy)),
  ];
  if (options?.shellAvailable === false) {
    return [
      ...fileTools,
      createDeleteTool(cwd, withSharedExecutionPolicy(options.delete, policy)),
      createMoveTool(cwd, withSharedExecutionPolicy(options.move, policy)),
    ];
  }
  const shellOptions = withSharedExecutionPolicy(options?.shell, policy);
  return [
    createShellTool(cwd, shellOptions),
    ...fileTools,
    // `shell_output` is one half of `background: true`, so it ships only with a background runtime.
    ...(shellOptions.background !== undefined ? [createShellOutputTool({ background: shellOptions.background })] : []),
  ];
}

/** Read-only subset: `read`, `grep`, `glob`. Never mutating, never a shell. */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  const searchOpts = withRepositoryDefaults(options?.grep ?? options?.search, options?.repository) as GrepToolOptions;
  const globOpts = withRepositoryDefaults(options?.glob, options?.repository) as GlobToolOptions;
  return [
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createGrepTool(cwd, withSharedExecutionPolicy(searchOpts, policy)),
    createGlobTool(cwd, withSharedExecutionPolicy(globOpts, policy)),
  ];
}

/** Every tool this package provides — identical to {@link createCodingTools}. */
export function createAllTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  return createCodingTools(cwd, options);
}
