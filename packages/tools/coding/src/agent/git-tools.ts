/**
 * Structured Git tool factories and aggregator.
 *
 * Tools cover status, diff, commit, and PR handoff. Branch, worktree, and patch application are
 * not tools: `shell` runs `git`, and worktrees belong to the `workspace` service (plan 189 Task 8).
 * Shell is never used internally; all Git invocations go through typed arg arrays.
 */
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { type CodingCheckToolOptions, createCodingCheckTool, type NamedCheckDefinition } from "./checks.js";
import { CODING_LOCAL_EFFECT, CODING_OBSERVATION_EFFECT, CODING_UNSUPPORTED_EFFECT } from "./effects.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import {
  type ArtifactWriter,
  type CreateGitOperationsOptions,
  createGitOperations,
  GitError,
  type GitOperations,
  type PrHandoff,
} from "./git.js";
import type { ExecutionPolicy } from "./execution-policy.js";

export interface GitToolsOptions {
  readonly executionPolicy?: ExecutionPolicy;
  readonly gitPath?: string;
  readonly execFile?: CreateGitOperationsOptions["execFile"];
  readonly runner?: CreateGitOperationsOptions["runner"];
  readonly artifactWriter?: ArtifactWriter;
  readonly commitIdentity?: CreateGitOperationsOptions["commitIdentity"];
  readonly limits?: CreateGitOperationsOptions;
  readonly operations?: GitOperations;
  /** Optional named checks included by `createGitTools` when provided. */
  readonly checks?: Readonly<Record<string, NamedCheckDefinition>>;
  readonly checkOptions?: Omit<CodingCheckToolOptions, "checks" | "executionPolicy">;
}

function errorResult(toolName: string, toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: toolName,
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function messageOf(error: unknown): string {
  if (error instanceof GitError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function opsFactory(cwd: string, options?: GitToolsOptions): () => Promise<GitOperations> {
  if (options?.operations) {
    const ops = options.operations;
    return async () => ops;
  }
  let cached: Promise<GitOperations> | undefined;
  return () => {
    cached ??= createGitOperations({
      cwd,
      gitPath: options?.gitPath,
      execFile: options?.execFile,
      runner: options?.runner,
      artifactWriter: options?.artifactWriter,
      commitIdentity: options?.commitIdentity,
      ...(options?.limits ?? {}),
    });
    return cached;
  };
}

export function createGitStatusTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_status",
    effect: CODING_OBSERVATION_EFFECT,
    effects: ["read"],
    description:
      "Return structured Git status (porcelain v2) including branch metadata and dirty-state. Does not follow shell; paths are repository-relative.",
    parameters: {
      type: "object",
      properties: {
        includeIgnored: { type: "boolean", description: "Include ignored files (default false)" },
      },
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_status", toolCallId, "Operation aborted");
      const includeIgnored = args.includeIgnored === true;
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: "status",
          paths: [cwd],
          risk: "low",
          metadata: { includeIgnored, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_status",
      );
      if (!policy.allowed) return policy.result;
      try {
        const status = await (await getOps()).status({ includeIgnored, signal: context.signal });
        const lines = [
          `branch=${status.branch.head ?? "(detached)"} oid=${status.branch.oid ?? "(initial)"} dirty=${status.dirty}`,
          ...status.entries.map((e) => `${e.kind}\t${e.xy}\t${e.path}${e.origPath ? `\t${e.origPath}` : ""}`),
        ];
        return {
          toolCallId,
          name: "git_status",
          content: [{ type: "text", text: lines.join("\n") }],
          metadata: { ...status },
        };
      } catch (error) {
        return errorResult("git_status", toolCallId, messageOf(error));
      }
    },
  };
}

export function createGitDiffTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_diff",
    effect: CODING_OBSERVATION_EFFECT,
    effects: ["read"],
    description:
      "Return a bounded unified diff (--no-ext-diff --no-textconv). Large diffs truncate inline and may spill through the host artifact writer.",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Diff the index (default false)" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional pathspecs (passed after --)",
        },
      },
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_diff", toolCallId, "Operation aborted");
      const staged = args.staged === true;
      const paths = Array.isArray(args.paths) ? (args.paths as string[]) : undefined;
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: "diff",
          paths: paths ?? [cwd],
          risk: "low",
          metadata: { staged, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_diff",
      );
      if (!policy.allowed) return policy.result;
      try {
        const result = await (await getOps()).diff({ staged, paths, signal: context.signal });
        const suffix = result.truncated
          ? `\n[truncated after ${result.lineCount} lines${result.artifact ? `; artifact ${result.artifact.uri}` : ""}]`
          : "";
        return {
          toolCallId,
          name: "git_diff",
          content: [{ type: "text", text: `${result.text}${suffix}`.trim() || "(empty diff)" }],
          metadata: {
            truncated: result.truncated,
            lineCount: result.lineCount,
            artifact: result.artifact,
          },
        };
      } catch (error) {
        return errorResult("git_diff", toolCallId, messageOf(error));
      }
    },
  };
}

export function createGitCommitTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_commit",
    effect: CODING_LOCAL_EFFECT,
    effects: ["write"],
    description:
      "Stage and commit explicit paths only (never `git add -A`). Refuses dirty unrelated worktrees unless createCheckpoint=true. Uses --no-verify and a temp message file; never pushes.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Exact paths to stage and commit",
        },
        message: { type: "string", description: "Commit message" },
        createCheckpoint: {
          type: "boolean",
          description: "Stash checkpoint first when the tree is already dirty",
        },
      },
      required: ["paths", "message"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_commit", toolCallId, "Operation aborted");
      const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
      const message = typeof args.message === "string" ? args.message : "";
      const createCheckpoint = args.createCheckpoint === true;
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: "commit",
          paths,
          risk: "high",
          metadata: { createCheckpoint, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_commit",
      );
      if (!policy.allowed) return policy.result;
      try {
        const result = await (await getOps()).commit({
          paths,
          message,
          createCheckpoint,
          signal: context.signal,
        });
        return {
          toolCallId,
          name: "git_commit",
          content: [{ type: "text", text: `committed ${result.sha}` }],
          metadata: result,
        };
      } catch (error) {
        return errorResult("git_commit", toolCallId, messageOf(error));
      }
    },
  };
}

export function createGitPrHandoffTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_pr_handoff",
    effect: CODING_UNSUPPORTED_EFFECT,
    effects: ["external", "network"],
    description:
      "Build a bounded host-owned PR handoff payload (base/head/commits/paths/diffstat/checks/artifact). Never pushes, authenticates, or opens a PR.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        base: { type: "string", description: "Base ref/commit for the handoff" },
        head: { type: "string", description: "Head ref/commit (default HEAD)" },
        includeBundle: {
          type: "boolean",
          description: "Prefer a git bundle artifact over a patch when an artifact writer is configured",
        },
        checks: {
          type: "array",
          description: "Optional check summaries to embed",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              exitCode: { type: "number" },
              summary: { type: "string" },
            },
          },
        },
      },
      required: ["base"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_pr_handoff", toolCallId, "Operation aborted");
      const base = typeof args.base === "string" ? args.base : "";
      const head = typeof args.head === "string" ? args.head : undefined;
      const includeBundle = args.includeBundle === true;
      const checks = Array.isArray(args.checks) ? (args.checks as Array<{ name: string; exitCode: number; summary: string }>) : undefined;
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: "pr_handoff",
          paths: [cwd],
          risk: "medium",
          metadata: { base, head, includeBundle, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_pr_handoff",
      );
      if (!policy.allowed) return policy.result;
      try {
        const handoff: PrHandoff = await (await getOps()).prHandoff({
          base,
          head,
          checks,
          includeBundle,
          signal: context.signal,
        });
        return {
          toolCallId,
          name: "git_pr_handoff",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  base: handoff.base,
                  head: handoff.head,
                  commits: handoff.commits.length,
                  changedPaths: handoff.changedPaths.length,
                  diffstat: handoff.diffstat,
                  checks: handoff.checks,
                  artifact: handoff.artifact,
                },
                null,
                2,
              ),
            },
          ],
          metadata: { ...handoff } as Readonly<Record<string, unknown>>,
        };
      } catch (error) {
        return errorResult("git_pr_handoff", toolCallId, messageOf(error));
      }
    },
  };
}

/**
 * Structured Git tool set. Optionally appends `coding_check` when `checks` are declared.
 * Not included in `createCodingTools()` — hosts opt in explicitly.
 */
export function createGitTools(cwd: string, options?: GitToolsOptions): readonly ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createGitStatusTool(cwd, options),
    createGitDiffTool(cwd, options),
    createGitCommitTool(cwd, options),
    createGitPrHandoffTool(cwd, options),
  ];
  if (options?.checks) {
    tools.push(
      createCodingCheckTool(cwd, {
        checks: options.checks,
        executionPolicy: options.executionPolicy,
        ...(options.checkOptions ?? {}),
      }),
    );
  }
  return tools;
}
