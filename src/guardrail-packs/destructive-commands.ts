import type { GuardrailPackDefinition } from "./types.js";

/** Shell commands that destroy data or history. Denies `--force-with-lease` too: both rewrite remote history. */
const DESTRUCTIVE_COMMANDS = [
  {
    id: "no-recursive-force-delete",
    pattern: /\brm\s+(?:[^\n;&|]*?\s)?-(?=[a-z]*r)(?=[a-z]*f)[a-z]+/i,
    reason: "Recursive force delete is not allowed",
  },
  {
    id: "no-long-flag-force-delete",
    pattern: /\brm\s+[^\n;&|]*--recursive\b[^\n;&|]*--force\b|\brm\s+[^\n;&|]*--force\b[^\n;&|]*--recursive\b/i,
    reason: "Recursive force delete is not allowed",
  },
  {
    id: "no-force-push",
    pattern: /\bgit\s+push\b[^\n;&|]*(?:--force\b|(?:^|\s)-f(?:\s|$))/i,
    reason: "Force push is not allowed",
  },
  {
    id: "no-destructive-sql",
    pattern: /\b(?:drop|truncate)\s+table\b/i,
    reason: "Destructive SQL is not allowed",
  },
  {
    id: "no-device-overwrite",
    pattern: /\bmkfs(?:\.\w+)?\b|\bdd\b[^\n;&|]*\bof=\/dev\//i,
    reason: "Raw device overwrite is not allowed",
  },
] as const;

/** Canned destructive shell/SQL patterns on the `shell` tool's `command` argument. */
export const destructiveCommandsPack: GuardrailPackDefinition = {
  id: "destructive-commands",
  version: 1,
  description: "Blocks destructive shell and SQL commands (recursive force delete, force push, drop table, device overwrite).",
  build() {
    return {
      rules: DESTRUCTIVE_COMMANDS.map(({ id, pattern, reason }) => ({
        id,
        tool: "shell",
        pattern,
        argPath: "command",
        reason,
      })),
    };
  },
};
