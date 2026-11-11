import type { ModelRef, OwnershipScope, RunLimits } from "@arnilo/prism";
import type { DelegateContextConfig } from "./context.js";

export type { DelegateContextConfig };

export type DelegateReport = "on-complete" | "milestones" | "stream";

/** One child the model may delegate to. The child runs as its own agent over the inherited packages. */
export interface DelegateChildConfig {
  /** Package names (loaded in the parent) the child inherits. Never includes this package. */
  readonly inherit: readonly string[];
  readonly instructions?: string;
  /** One line the parent model reads to choose this child. Defaults to the first sentence of `instructions`. */
  readonly description?: string;
  /** Defaults to the parent session's model. */
  readonly model?: ModelRef;
  readonly tools?: { readonly only?: readonly string[] };
  /** May only narrow the delegate ceilings; a larger value is clamped. */
  readonly limits?: DelegateChildLimits;
  readonly report?: DelegateReport;
  /** Which of the parent's skills the child gets: `"inherit"` (default), `"none"`, or names. An unknown name fails the delegation. */
  readonly skills?: "inherit" | "none" | readonly string[];
  /**
   * How much of the parent's conversation the child is given: `"none"` (default), `"summary"` (one model
   * call, then a summary entry), or `{ lastTurns, maxChars? }`. Host config only; the tool cannot widen it.
   */
  readonly context?: DelegateContextConfig;
  /** Left out of the `delegate` description and its `child` enum; only the `delegate` service can start it. */
  readonly hidden?: boolean;
  /** Cap on the answer text the parent sees. Default 12,000; clamped to 64,000. The rest is paged by `delegate_wait`. */
  readonly resultMaxChars?: number;
  /**
   * `"worktree"` runs the child in its own git worktree of the inherited coding package's repository
   * and merges its branch into the parent's current branch when it completes. `"none"` (default)
   * leaves it in whatever tree the inherited tools use.
   */
  readonly isolation?: "none" | "worktree";
}

export interface DelegateChildLimits {
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxTotalTokens?: number;
  readonly maxWallTimeMs?: number;
}

export interface DelegateConfig {
  readonly children: Readonly<Record<string, DelegateChildConfig>>;
  /**
   * A directory holding Claude Code subagent files: `<agentsRoot>/.agents/agents/*.md` then
   * `<agentsRoot>/.claude/agents/*.md`. Each file becomes a child that inherits `defaultInherit`,
   * narrowed by its own `tools` list; a file never names a package.
   */
  readonly agentsRoot?: string;
  /** The packages file-defined children inherit. Required when `agentsRoot` is set. */
  readonly defaultInherit?: readonly string[];
  /**
   * The scope each child agent appends under. Set it to the parent agent's `ownership`: a child has no
   * store of its own to infer it from, and an inherited coding tool's durable effect (a file write)
   * fails without one. Mirrors `RunWorkflowOptions.ownership` for the same reason.
   */
  readonly ownership?: OwnershipScope;
  /** Only `1` today: a child never sees `delegate`, because the package is excluded from its own inherit. */
  readonly maxDepth?: number;
  readonly maxConcurrent?: number;
}

export const DEFAULT_MAX_CONCURRENT = 4;
export const HARD_MAX_CONCURRENT = 32;

const modelRef = {
  anyOf: [
    { type: "string" },
    { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: ["provider", "model"] },
  ],
} as const;

export const delegateConfigSchema = {
  type: "object",
  properties: {
    children: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          inherit: { type: "array", items: { type: "string" } },
          instructions: { type: "string" },
          model: modelRef,
          tools: { type: "object", properties: { only: { type: "array", items: { type: "string" } } }, additionalProperties: false },
          limits: {
            type: "object",
            properties: {
              maxTurns: { type: "integer", minimum: 1 },
              maxToolCalls: { type: "integer", minimum: 1 },
              maxTotalTokens: { type: "integer", minimum: 1 },
              maxWallTimeMs: { type: "integer", minimum: 1 },
            },
            additionalProperties: false,
          },
          report: { type: "string", enum: ["on-complete", "milestones", "stream"] },
          skills: {
            anyOf: [
              { type: "string", enum: ["inherit", "none"] },
              { type: "array", items: { type: "string" } },
            ],
          },
          resultMaxChars: { type: "integer", minimum: 1 },
          context: {
            anyOf: [
              { type: "string", enum: ["none", "summary"] },
              {
                type: "object",
                properties: { lastTurns: { type: "integer", minimum: 1, maximum: 50 }, maxChars: { type: "integer", minimum: 1 } },
                required: ["lastTurns"],
                additionalProperties: false,
              },
            ],
          },
          hidden: { type: "boolean" },
          isolation: { type: "string", enum: ["none", "worktree"] },
          description: { type: "string", minLength: 1 },
        },
        required: ["inherit"],
        additionalProperties: false,
      },
    },
    agentsRoot: { type: "string", minLength: 1 },
    defaultInherit: { type: "array", items: { type: "string" } },
    ownership: {
      type: "object",
      properties: { tenantId: { type: "string" }, accountId: { type: "string" }, userId: { type: "string" } },
      additionalProperties: false,
    },
    maxDepth: { type: "integer", minimum: 1, maximum: 1 },
    maxConcurrent: { type: "integer", minimum: 1, maximum: HARD_MAX_CONCURRENT },
  },
  additionalProperties: false,
} as const;

export type { RunLimits };
