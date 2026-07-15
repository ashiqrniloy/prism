export type CommandRuleAction = "allow" | "deny" | "requireApproval";

export interface CommandRule {
  readonly pattern: RegExp | string;
  readonly action: CommandRuleAction;
  readonly reason?: string;
}

const DEFAULT_DENY_PATTERNS: readonly (RegExp | string)[] = [
  /\bsudo\b/i,
  /\bchmod\b.*\b777\b/i,
  /\brm\s+-rf\s+\//,
  /\bcurl\b[^\n|]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^\n|]*\|\s*(ba)?sh\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

const METACHARACTER_PATTERN = /[;|&`$()<>]|\\n|\$\(/;

export function hasShellMetacharacters(command: string): boolean {
  return METACHARACTER_PATTERN.test(command);
}

export interface CommandRuleEvaluation {
  readonly action: CommandRuleAction;
  readonly reason?: string;
}

export function evaluateCommandRules(
  command: string,
  rules: readonly CommandRule[] | undefined,
  options?: { denyMetacharacters?: boolean },
): CommandRuleEvaluation {
  const configured = rules ?? [];
  for (const rule of configured) {
    const pattern = rule.pattern;
    const matches =
      typeof pattern === "string"
        ? command.includes(pattern)
        : pattern.test(command);
    if (matches) {
      return { action: rule.action, reason: rule.reason };
    }
  }

  for (const pattern of DEFAULT_DENY_PATTERNS) {
    const matches = typeof pattern === "string" ? command.includes(pattern) : pattern.test(command);
    if (matches) {
      return { action: "deny", reason: "command matches default deny pattern" };
    }
  }

  if (options?.denyMetacharacters !== false && hasShellMetacharacters(command)) {
    return { action: "requireApproval", reason: "command contains shell metacharacters" };
  }

  return { action: "allow" };
}
