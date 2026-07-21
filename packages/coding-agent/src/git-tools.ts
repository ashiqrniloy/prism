/**
 * Structured Git tool factories and aggregator.
 *
 * Tools cover status, diff, branch, worktree, apply, commit, and PR handoff.
 * Shell is never used internally; all Git invocations go through typed arg arrays.
 */
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { enforceExecutionPolicy } from "./execution-policy.js";
import {
  createGitOperations,
  GitError,
  type ArtifactWriter,
  type CreateGitOperationsOptions,
  type GitOperations,
  type PrHandoff,
} from "./git.js";
import { createCodingCheckTool, type CodingCheckToolOptions, type NamedCheckDefinition } from "./checks.js";

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

export function createGitBranchTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_branch",
    description:
      "Validate, list, create, or switch branches. Switch refuses a dirty worktree unless createCheckpoint=true.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["validate", "create", "switch", "list"],
          description: "Branch operation",
        },
        name: { type: "string", description: "Branch name (required except for list)" },
        createCheckpoint: {
          type: "boolean",
          description: "Stash a checkpoint before switch when dirty (default false)",
        },
      },
      required: ["action"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_branch", toolCallId, "Operation aborted");
      const action = args.action;
      if (action !== "validate" && action !== "create" && action !== "switch" && action !== "list") {
        return errorResult("git_branch", toolCallId, "action must be validate|create|switch|list");
      }
      const name = typeof args.name === "string" ? args.name : undefined;
      const createCheckpoint = args.createCheckpoint === true;
      const risk = action === "list" || action === "validate" ? "low" : "high";
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: `branch_${action}`,
          paths: [cwd],
          risk,
          metadata: { name, createCheckpoint, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_branch",
      );
      if (!policy.allowed) return policy.result;
      try {
        const result = await (await getOps()).branch({
          action,
          name,
          createCheckpoint,
          signal: context.signal,
        });
        return {
          toolCallId,
          name: "git_branch",
          content: [
            {
              type: "text",
              text:
                action === "list"
                  ? (result.refs ?? []).join("\n") || "(no branches)"
                  : `ok action=${action} name=${result.name ?? ""}${result.checkpoint ? ` checkpoint=${result.checkpoint}` : ""}`,
            },
          ],
          metadata: result,
        };
      } catch (error) {
        return errorResult("git_branch", toolCallId, messageOf(error));
      }
    },
  };
}

export function createGitWorktreeTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_worktree",
    description: "List, add, or remove Git worktrees within finite caps. Prefer disposable worktrees for mutating transactions.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "remove"] },
        path: { type: "string", description: "Worktree path (add/remove)" },
        branch: { type: "string", description: "Optional new branch name for add (-b)" },
        force: { type: "boolean", description: "Force remove (default false)" },
      },
      required: ["action"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_worktree", toolCallId, "Operation aborted");
      const action = args.action;
      if (action !== "list" && action !== "add" && action !== "remove") {
        return errorResult("git_worktree", toolCallId, "action must be list|add|remove");
      }
      const path = typeof args.path === "string" ? args.path : undefined;
      const branch = typeof args.branch === "string" ? args.branch : undefined;
      const force = args.force === true;
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: `worktree_${action}`,
          paths: path ? [path] : [cwd],
          risk: action === "list" ? "low" : "high",
          metadata: { branch, force, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_worktree",
      );
      if (!policy.allowed) return policy.result;
      try {
        const result = await (await getOps()).worktree({
          action,
          path,
          branch,
          force,
          signal: context.signal,
        });
        const text =
          action === "list"
            ? result.worktrees.map((w) => `${w.path}\t${w.branch ?? ""}\t${w.head ?? ""}`).join("\n") ||
              "(no worktrees)"
            : `ok action=${action} path=${result.path ?? ""}`;
        return {
          toolCallId,
          name: "git_worktree",
          content: [{ type: "text", text }],
          metadata: result,
        };
      } catch (error) {
        return errorResult("git_worktree", toolCallId, messageOf(error));
      }
    },
  };
}

export function createGitApplyTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_apply",
    description:
      "Check, apply, or reverse a unified patch. Always runs apply --check first for apply/reverse. Dirty trees require createCheckpoint=true; failures restore the checkpoint or clean tree.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["check", "apply", "reverse"] },
        patch: { type: "string", description: "Unified diff text" },
        createCheckpoint: {
          type: "boolean",
          description: "Stash checkpoint before mutating apply/reverse when dirty",
        },
      },
      required: ["action", "patch"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("git_apply", toolCallId, "Operation aborted");
      const action = args.action;
      if (action !== "check" && action !== "apply" && action !== "reverse") {
        return errorResult("git_apply", toolCallId, "action must be check|apply|reverse");
      }
      const patch = typeof args.patch === "string" ? args.patch : "";
      const createCheckpoint = args.createCheckpoint === true;
      const policy = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "git",
          operation: `apply_${action}`,
          paths: [cwd],
          risk: action === "check" ? "low" : "high",
          metadata: { createCheckpoint, sessionId: context.sessionId, runId: context.runId },
        },
        toolCallId,
        "git_apply",
      );
      if (!policy.allowed) return policy.result;
      try {
        const result = await (await getOps()).apply({
          action,
          patch,
          createCheckpoint,
          signal: context.signal,
        });
        if (!result.ok) {
          return {
            toolCallId,
            name: "git_apply",
            content: [{ type: "text", text: result.output }],
            error: { message: result.output },
            metadata: result,
          };
        }
        return {
          toolCallId,
          name: "git_apply",
          content: [{ type: "text", text: result.output }],
          metadata: result,
        };
      } catch (error) {
        return errorResult("git_apply", toolCallId, messageOf(error));
      }
    },
  };
}

export function createGitCommitTool(cwd: string, options?: GitToolsOptions): ToolDefinition {
  const getOps = opsFactory(cwd, options);
  return {
    name: "git_commit",
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
      const checks = Array.isArray(args.checks)
        ? (args.checks as Array<{ name: string; exitCode: number; summary: string }>)
        : undefined;
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
    createGitBranchTool(cwd, options),
    createGitWorktreeTool(cwd, options),
    createGitApplyTool(cwd, options),
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
