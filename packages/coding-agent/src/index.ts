// @arnilo/prism-coding-agent public barrel.
//
// First-party coding tools for the Prism agent harness. Factory functions return Prism
// `ToolDefinition`s that hosts register into a `ToolRegistry` (e.g.
// `createToolRegistry(createCodingTools(cwd))`). No tools are auto-registered — import what you need.

// --- per-tool factories & types ---

export {
  createShellTool,
  createLocalBashOperations,
  getShellConfig,
  killProcessTree,
  waitForChildProcess,
} from "./shell.js";
export type {
  ShellToolOptions,
  ShellConfig,
  BashOperations,
  BashExecOptions,
  BashSpawnContext,
  BashSpawnHook,
} from "./shell.js";

export {
  createReadTool,
  detectSupportedImageMimeType,
  detectSupportedImageMimeTypeFromFile,
  DEFAULT_MAX_IMAGE_BYTES,
} from "./read.js";
export type {
  ReadToolOptions,
  ReadOperations,
  ReadTextOptions,
  ReadTextResult,
  TransformImage,
  TransformImageInput,
} from "./read.js";

export { createWriteTool } from "./write.js";
export type { WriteToolOptions, WriteOperations } from "./write.js";

export { createEditTool } from "./edit.js";
export type { EditToolOptions, EditOperations, EditToolDetails, Edit } from "./edit.js";

export { createRepoListTool } from "./list.js";
export type { ListToolOptions } from "./list.js";

export { createRepoSearchTool } from "./search.js";
export type { SearchToolOptions } from "./search.js";

export {
  createLocalRepositoryOperations,
  resolveRepositoryLimits,
  compileSearchPattern,
  isBinaryBuffer,
  resolveRepoPath,
  toRepoRelative,
  RepositoryError,
  DEFAULT_REPO_EXCLUDE,
} from "./repository.js";
export type {
  RepoEntryKind,
  RepoListEntry,
  RepositoryListRequest,
  RepositoryListResult,
  RepositorySearchMatch,
  RepositorySearchRequest,
  RepositorySearchResult,
  RepositoryOperations,
  RepositoryLimitOptions,
  ResolvedRepositoryLimits,
} from "./repository.js";

export {
  createGitOperations,
  resolveGitLimits,
  parsePorcelainV2,
  GitError,
  SAFE_GIT_ENV,
  SAFE_GIT_CONFIG_ARGS,
  createBoundGitRunner,
  runGitCli,
} from "./git.js";
export type {
  GitOperations,
  GitLimitOptions,
  ResolvedGitLimits,
  ArtifactReference,
  ArtifactWriter,
  PrHandoff,
  CreateGitOperationsOptions,
  GitStatusResult,
  GitStatusEntry,
  GitStatusBranch,
  GitStatusEntryKind,
  GitRunner,
  GitExecRequest,
  GitExecResult,
  BoundGitRunner,
  CreateGitRunnerOptions,
} from "./git.js";

export {
  createGitTools,
  createGitStatusTool,
  createGitDiffTool,
  createGitBranchTool,
  createGitWorktreeTool,
  createGitApplyTool,
  createGitCommitTool,
  createGitPrHandoffTool,
} from "./git-tools.js";
export type { GitToolsOptions } from "./git-tools.js";

export { createCodingCheckTool } from "./checks.js";
export type { CodingCheckToolOptions, NamedCheckDefinition } from "./checks.js";

export {
  ASK_USER_DECISION_RATIONALE_COUNT,
  ASK_USER_DECISION_SUSPEND_REASON,
  ASK_USER_DECISION_TOOL_NAME,
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
  askUserDecisionResumeSchema,
  createAskUserDecisionResumeValidator,
  createAskUserDecisionTool,
  parseAskUserDecisionArgs,
  resolveAskUserDecisionAnswer,
  resolveAskUserDecisionLimits,
  suspendAskUserDecision,
  toAskUserDecisionSuspendData,
  validateAskUserDecisionAgentResume,
  validateAskUserDecisionResume,
} from "./ask-user-decision.js";
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

export { createDirectoryArtifactWriter, createTempArtifactWriter, sha256Hex } from "./artifacts.js";

export {
  CODING_CHECKPOINT_SCHEMA_VERSION,
  CODING_STATE_KEY,
  CodingCheckpointError,
  assertCodingResumeAllowed,
  buildCodingCheckpointMetadata,
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
export type {
  CodingArtifactKind,
  CodingArtifactRef,
  CodingCheckSummary,
  CodingCheckpointLimitOptions,
  CodingCheckpointMetadata,
  CodingFingerprints,
  CodingHandoffSummary,
  CodingTaskStatus,
  CodingTodoItem,
  ResolvedCodingCheckpointLimits,
} from "./coding-checkpoint.js";

export {
  CODING_GOAL_VERIFY_REVISION,
  CODING_GOAL_VERIFY_SUSPEND_REASON,
  CODING_GOAL_VERIFY_WORKFLOW_ID,
  CodingGoalVerifyError,
  createCodingGoalVerifyWorkflow,
  runCodingGoalVerify,
} from "./goal-verify.js";
export type {
  CodingGoalVerifyApproval,
  RunCodingGoalVerifyOptions,
} from "./goal-verify.js";

// --- generic primitives (re-exported for hosts that want them) ---

export { withFileMutationQueue } from "./file-mutation-queue.js";
export { enforceExecutionPolicy } from "./execution-policy.js";
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_TEXT_SCAN_BYTES,
  DEFAULT_MAX_WRITE_BYTES,
  DEFAULT_MAX_EDIT_FILE_BYTES,
  DEFAULT_MAX_EDIT_INPUT_BYTES,
  DEFAULT_MAX_EDITS,
  DEFAULT_SHELL_TIMEOUT_SECONDS,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
  DEFAULT_MAX_REPO_DEPTH,
  DEFAULT_MAX_REPO_ENTRIES,
  DEFAULT_MAX_REPO_FILES,
  DEFAULT_MAX_REPO_RESULTS,
  DEFAULT_MAX_REPO_CONCURRENCY,
  DEFAULT_MAX_SEARCH_SCAN_BYTES,
  DEFAULT_MAX_SEARCH_FILE_BYTES,
  DEFAULT_MAX_SEARCH_MATCHES,
  DEFAULT_MAX_SEARCH_PATTERN_BYTES,
  DEFAULT_MAX_SEARCH_LINE_BYTES,
  DEFAULT_MAX_SEARCH_CONTEXT_LINES,
  DEFAULT_MAX_SEARCH_TIME_MS,
  DEFAULT_MAX_GIT_PATHS,
  DEFAULT_MAX_GIT_REF_BYTES,
  DEFAULT_MAX_GIT_MESSAGE_BYTES,
  DEFAULT_MAX_GIT_OUTPUT_BYTES,
  DEFAULT_MAX_GIT_DIFF_LINES,
  DEFAULT_MAX_GIT_CHANGED_FILES,
  DEFAULT_MAX_GIT_PATCH_BYTES,
  DEFAULT_MAX_GIT_WORKTREES,
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_MAX_CHECK_NAMES,
  DEFAULT_MAX_CHECK_CONCURRENCY,
  DEFAULT_CHECK_TIMEOUT_MS,
  DEFAULT_MAX_CHECK_DIAGNOSTIC_LINES,
  DEFAULT_MAX_CHECK_OUTPUT_BYTES,
  DEFAULT_MAX_PR_HANDOFF_BYTES,
  DEFAULT_MAX_PR_COMMITS,
  DEFAULT_MAX_PLAN_BYTES,
  DEFAULT_MAX_TODOS,
  DEFAULT_MAX_TODO_TEXT_BYTES,
  DEFAULT_MAX_CODING_ARTIFACTS,
  DEFAULT_MAX_CODING_ARTIFACT_BYTES,
  DEFAULT_MAX_CHECK_SUMMARY_BYTES,
  DEFAULT_MAX_CODING_CHECKPOINT_BYTES,
  HARD_MAX_BYTES,
  HARD_MAX_LINES,
  HARD_MAX_TEXT_SCAN_BYTES,
  HARD_MAX_IMAGE_BYTES,
  HARD_MAX_WRITE_BYTES,
  HARD_MAX_EDIT_FILE_BYTES,
  HARD_MAX_EDIT_INPUT_BYTES,
  HARD_MAX_EDITS,
  HARD_SHELL_TIMEOUT_SECONDS,
  HARD_MAX_TOTAL_OUTPUT_BYTES,
  HARD_MAX_REPO_DEPTH,
  HARD_MAX_REPO_ENTRIES,
  HARD_MAX_REPO_FILES,
  HARD_MAX_REPO_RESULTS,
  HARD_MAX_REPO_CONCURRENCY,
  HARD_MAX_SEARCH_SCAN_BYTES,
  HARD_MAX_SEARCH_FILE_BYTES,
  HARD_MAX_SEARCH_MATCHES,
  HARD_MAX_SEARCH_PATTERN_BYTES,
  HARD_MAX_SEARCH_LINE_BYTES,
  HARD_MAX_SEARCH_CONTEXT_LINES,
  HARD_MAX_SEARCH_TIME_MS,
  HARD_MAX_GIT_PATHS,
  HARD_MAX_GIT_REF_BYTES,
  HARD_MAX_GIT_MESSAGE_BYTES,
  HARD_MAX_GIT_OUTPUT_BYTES,
  HARD_MAX_GIT_DIFF_LINES,
  HARD_MAX_GIT_CHANGED_FILES,
  HARD_MAX_GIT_PATCH_BYTES,
  HARD_MAX_GIT_WORKTREES,
  HARD_GIT_TIMEOUT_MS,
  HARD_MAX_CHECK_NAMES,
  HARD_MAX_CHECK_CONCURRENCY,
  HARD_CHECK_TIMEOUT_MS,
  HARD_MAX_CHECK_DIAGNOSTIC_LINES,
  HARD_MAX_CHECK_OUTPUT_BYTES,
  HARD_MAX_PR_HANDOFF_BYTES,
  HARD_MAX_PR_COMMITS,
  HARD_MAX_PLAN_BYTES,
  HARD_MAX_TODOS,
  HARD_MAX_TODO_TEXT_BYTES,
  HARD_MAX_CODING_ARTIFACTS,
  HARD_MAX_CODING_ARTIFACT_BYTES,
  HARD_MAX_CHECK_SUMMARY_BYTES,
  HARD_MAX_CODING_CHECKPOINT_BYTES,
} from "./limits.js";

// --- aggregators ---

import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import { createShellTool } from "./shell.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createRepoListTool } from "./list.js";
import { createRepoSearchTool } from "./search.js";
import type { ShellToolOptions } from "./shell.js";
import type { ReadToolOptions } from "./read.js";
import type { WriteToolOptions } from "./write.js";
import type { EditToolOptions } from "./edit.js";
import type { ListToolOptions } from "./list.js";
import type { SearchToolOptions } from "./search.js";
import type { RepositoryLimitOptions, RepositoryOperations } from "./repository.js";

/** Per-tool options combined for the aggregator factories. */
export interface ToolsOptions {
  /** Shared execution policy applied to every coding tool unless overridden per tool. */
  executionPolicy?: ExecutionPolicy;
  shell?: ShellToolOptions;
  read?: ReadToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  list?: ListToolOptions;
  search?: SearchToolOptions;
  /**
   * Shared repository limits/backends for `repo_list` / `repo_search`.
   * Per-tool `list` / `search` options override these when both are set.
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
  toolOptions: ListToolOptions | SearchToolOptions | undefined,
  shared?: ToolsOptions["repository"],
): ListToolOptions | SearchToolOptions {
  if (!shared && !toolOptions) return {};
  return {
    ...(toolOptions ?? {}),
    repository: toolOptions?.repository ?? shared,
    operations: toolOptions?.operations ?? shared?.operations,
    exclude: toolOptions?.exclude ?? shared?.exclude,
  };
}

/**
 * Full coding tool set: `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`.
 * Opt-in tools (`createGitTools`, `createAskUserDecisionTool`, `createCodingCheckTool`)
 * stay out — hosts register them explicitly.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  const listOpts = withRepositoryDefaults(options?.list, options?.repository) as ListToolOptions;
  const searchOpts = withRepositoryDefaults(options?.search, options?.repository) as SearchToolOptions;
  return [
    createShellTool(cwd, withSharedExecutionPolicy(options?.shell, policy)),
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createWriteTool(cwd, withSharedExecutionPolicy(options?.write, policy)),
    createEditTool(cwd, withSharedExecutionPolicy(options?.edit, policy)),
    createRepoListTool(cwd, withSharedExecutionPolicy(listOpts, policy)),
    createRepoSearchTool(cwd, withSharedExecutionPolicy(searchOpts, policy)),
  ];
}

/**
 * Read-only subset: `read`, `repo_list`, `repo_search`.
 * Deliberate 0.0.9 expansion from the previous `read`-only set.
 */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  const listOpts = withRepositoryDefaults(options?.list, options?.repository) as ListToolOptions;
  const searchOpts = withRepositoryDefaults(options?.search, options?.repository) as SearchToolOptions;
  return [
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createRepoListTool(cwd, withSharedExecutionPolicy(listOpts, policy)),
    createRepoSearchTool(cwd, withSharedExecutionPolicy(searchOpts, policy)),
  ];
}

/** Every tool this package provides — identical to {@link createCodingTools}. */
export function createAllTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  return createCodingTools(cwd, options);
}
