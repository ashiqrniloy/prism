import type { JsonSchema } from "@arnilo/prism";

/** Roadmap approval modes. Prism Code maps `accept-edits` to `edits` at its edge. */
export type ApprovalMode = "deny" | "ask" | "edits" | "auto";

/** A static allow. `commandPrefix` matches a shell command's first two tokens. */
export interface ApprovalRule {
  readonly tool: string;
  readonly commandPrefix?: string;
}

export interface ApprovalConfig {
  readonly mode?: ApprovalMode;
  /** Extra roots that count as inside, beyond `coding.targets`. */
  readonly roots?: readonly string[];
  readonly rules?: readonly ApprovalRule[];
  readonly timeoutMs?: number;
}

const ruleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tool"],
  properties: {
    tool: { type: "string", minLength: 1, maxLength: 128 },
    commandPrefix: { type: "string", minLength: 1, maxLength: 64 },
  },
};

export const approvalConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["deny", "ask", "edits", "auto"], default: "ask" },
    roots: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 4096 },
      maxItems: 64,
      default: [],
    },
    rules: { type: "array", items: ruleSchema, maxItems: 500, default: [] },
    timeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000 },
  },
};
