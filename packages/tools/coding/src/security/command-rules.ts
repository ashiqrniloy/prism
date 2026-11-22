/**
 * Shell command classification. The built-in deny list runs first and no configured rule can
 * override it; then every configured rule is evaluated and the strictest match wins
 * (`deny` > `requireApproval` > `allow`). The built-in list is a tripwire for obvious destructive
 * forms, not a containment boundary: the sandbox is the control.
 */
export type CommandRuleAction = "allow" | "deny" | "requireApproval";

export interface CommandRule {
  readonly pattern: RegExp | string;
  readonly action: CommandRuleAction;
  readonly reason?: string;
}

export interface CommandRuleEvaluation {
  readonly action: CommandRuleAction;
  readonly reason?: string;
}

/** One built-in deny entry: an id (named in the deny reason) and a test. */
export interface BuiltinDenyRule {
  readonly id: string;
  readonly test: (command: string) => boolean;
}

/** Longest `/pattern/` source a configured rule may compile. */
export const MAX_COMMAND_RULE_PATTERN_LENGTH = 512;

const SHELLS = "(?:sh|bash|zsh|dash|ksh|fish)";

// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansions as literal text, not templates
const RM_DANGEROUS_TARGETS = new Set(["/", "/*", "~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*", "${HOME}", "${HOME}/", "${HOME}/*"]);

/**
 * `rm` with both a recursive and a force flag (any order, bundled or separate, short or long) aimed
 * at `/`, `~`, or `$HOME`. A linear token scan per `rm` segment, not a regex.
 */
function isRecursiveForceRmOfRootOrHome(command: string): boolean {
  const finder = /(?:^|[\s;&|(`])(?:\S*\/)?rm(?=\s)/g;
  for (let match = finder.exec(command); match !== null; match = finder.exec(command)) {
    const rest = command.slice(match.index + match[0].length);
    const end = rest.search(/[;&|\n)`]/);
    const segment = end === -1 ? rest : rest.slice(0, end);
    let recursive = false;
    let force = false;
    let dangerous = false;
    for (const raw of segment.split(/\s+/)) {
      const token = raw.replace(/^['"]|['"]$/g, "");
      if (token.length === 0) continue;
      if (token === "--recursive") recursive = true;
      else if (token === "--force") force = true;
      else if (token.startsWith("--")) continue;
      else if (token.startsWith("-") && token.length > 1) {
        if (/[rR]/.test(token)) recursive = true;
        if (token.includes("f")) force = true;
      } else if (RM_DANGEROUS_TARGETS.has(token)) dangerous = true;
    }
    if (recursive && force && dangerous) return true;
  }
  return false;
}

function regexRule(id: string, pattern: RegExp): BuiltinDenyRule {
  return { id, test: (command) => pattern.test(command) };
}

/** The built-in deny list. Data, evaluated before any configured rule. */
export const BUILTIN_DENY_RULES: readonly BuiltinDenyRule[] = [
  regexRule("privilege-escalation", /\b(?:sudo|doas|pkexec)\b/i),
  regexRule("su-command", /(?:^|[\s;&|(`/])su\s+(?:\S+\s+)*?-[a-z]*c\b/),
  regexRule("chmod-777", /\bchmod\b.*\b777\b/i),
  { id: "rm-recursive-force-root", test: isRecursiveForceRmOfRootOrHome },
  regexRule(
    "download-piped-to-shell",
    new RegExp(`\\b(?:curl|wget)\\b[^\\n|]*\\|\\s*(?:(?:\\S*\\/)?(?:sudo|env)\\s+){0,2}(?:\\S*\\/)?${SHELLS}\\b`, "i"),
  ),
  regexRule("shell-runs-download", new RegExp(`\\b(?:${SHELLS}|eval)\\b[^\\n;&|]*(?:\\$\\(|\`|<\\()\\s*(?:curl|wget)\\b`, "i")),
  regexRule("raw-disk-write", />\s*\/dev\/sd[a-z]/i),
  regexRule("mkfs", /\bmkfs\b/i),
  regexRule("dd", /\bdd\s+if=/i),
];

const METACHARACTER_PATTERN = /[;|&`$()<>]|\\n|\$\(/;

export function hasShellMetacharacters(command: string): boolean {
  return METACHARACTER_PATTERN.test(command);
}

/**
 * Reject a pattern whose quantified group itself contains a quantifier (`(a+)+`, `(a*)*`,
 * `(a{2,})+`): the nested-quantifier shape behind catastrophic backtracking. A linear scan.
 */
function hasNestedQuantifier(source: string): boolean {
  const groups: boolean[] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "(") groups.push(false);
    else if (ch === ")") {
      const innerQuantified = groups.pop() ?? false;
      const next = source[i + 1];
      const quantified = next === "*" || next === "+" || next === "{";
      if (innerQuantified && quantified) return true;
      if ((innerQuantified || quantified) && groups.length > 0) groups[groups.length - 1] = true;
    } else if ((ch === "*" || ch === "+" || ch === "{") && groups.length > 0) {
      groups[groups.length - 1] = true;
    }
  }
  return false;
}

const SLASH_PATTERN = /^\/(.+)\/([dgimsuvy]*)$/s;

/** One configured rule as the package config declares it. */
export interface CommandRuleSpec {
  readonly match: string;
  readonly decision: CommandRuleAction;
  readonly reason?: string;
}

/**
 * Compile configured rules once. A `match` of the form `/pattern/` or `/pattern/i` becomes a
 * `RegExp`; any other string stays a substring. Other flags, an invalid pattern, a pattern over
 * {@link MAX_COMMAND_RULE_PATTERN_LENGTH} characters, or a nested-quantifier shape throws, naming
 * the rule index.
 */
export function compileCommandRules(specs: readonly CommandRuleSpec[] | undefined): readonly CommandRule[] {
  return (specs ?? []).map((spec, index) => {
    const where = `prism-tools-coding: commandRules[${index}]`;
    const slash = SLASH_PATTERN.exec(spec.match);
    let pattern: RegExp | string = spec.match;
    if (slash) {
      const source = slash[1] as string;
      const flags = slash[2] as string;
      if (flags !== "" && flags !== "i") throw new Error(`${where} pattern flags must be empty or "i"`);
      if (source.length > MAX_COMMAND_RULE_PATTERN_LENGTH) {
        throw new Error(`${where} pattern exceeds ${MAX_COMMAND_RULE_PATTERN_LENGTH} characters`);
      }
      if (hasNestedQuantifier(source)) throw new Error(`${where} pattern has a nested quantifier`);
      try {
        pattern = new RegExp(source, flags);
      } catch (error) {
        throw new Error(`${where} has an invalid pattern`, { cause: error });
      }
    }
    return { pattern, action: spec.decision, ...(spec.reason !== undefined ? { reason: spec.reason } : {}) };
  });
}

const RANK: Readonly<Record<CommandRuleAction, number>> = { allow: 1, requireApproval: 2, deny: 3 };

function ruleMatches(pattern: RegExp | string, command: string): boolean {
  if (typeof pattern === "string") return command.includes(pattern);
  pattern.lastIndex = 0;
  return pattern.test(command);
}

/**
 * Classify a command: a built-in deny wins outright; otherwise the strictest matching configured
 * rule decides (ties keep the first). Reasons name the rule, never the command.
 */
export function evaluateCommandRules(
  command: string,
  rules: readonly CommandRule[] | undefined,
  options?: { denyMetacharacters?: boolean },
): CommandRuleEvaluation {
  for (const builtin of BUILTIN_DENY_RULES) {
    if (builtin.test(command)) return { action: "deny", reason: `command matches built-in deny rule "${builtin.id}"` };
  }

  let decided: { rule: CommandRule; index: number } | undefined;
  const configured = rules ?? [];
  for (let index = 0; index < configured.length; index++) {
    const rule = configured[index] as CommandRule;
    if (!ruleMatches(rule.pattern, command)) continue;
    if (decided === undefined || RANK[rule.action] > RANK[decided.rule.action]) decided = { rule, index };
    if (rule.action === "deny") break;
  }
  if (decided !== undefined) {
    return { action: decided.rule.action, reason: decided.rule.reason ?? `command matches commandRules[${decided.index}]` };
  }

  if (options?.denyMetacharacters !== false && hasShellMetacharacters(command)) {
    return { action: "requireApproval", reason: "command contains shell metacharacters" };
  }

  return { action: "allow" };
}
