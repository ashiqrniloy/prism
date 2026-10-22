import type { ApprovalMode } from "./config.js";

/** The cell of the Task 1 (c) table, before rules, grants, and the prompt. */
export type ApprovalCell = "allow" | "ask" | "deny";

const RISKY = new Set(["execute", "network", "external"]);

/**
 * Mode × effect. `inside` matters only for a write that is not also execute/network/external.
 * Empty effects are not a non-read call. `deny` ignores rules: it denies every non-read call.
 */
export function decideApproval(input: {
  readonly mode: ApprovalMode;
  readonly effects: readonly string[];
  readonly inside: boolean;
  readonly granted: boolean;
}): ApprovalCell {
  const readOnly = input.effects.length > 0 && input.effects.every((effect) => effect === "read");
  if (readOnly || input.effects.length === 0) return "allow";
  if (input.mode === "deny") return "deny";
  if (input.granted) return "allow";
  if (input.mode === "auto") return "allow";
  const risky = input.effects.some((effect) => RISKY.has(effect));
  if (input.mode === "edits" && !risky && input.effects.includes("write") && input.inside) return "allow";
  return "ask";
}

/** First two whitespace tokens, bounded to 64 chars. `bun test --watch` is `bun test`. */
export function commandPrefix(command: string): string {
  return command
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, 2)
    .join(" ")
    .slice(0, 64);
}

export function grantKey(tool: string, command?: string): string {
  return command === undefined || command.length === 0 ? tool : `${tool}\u0000${commandPrefix(command)}`;
}
