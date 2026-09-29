import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExecutionAction, ExecutionDecision, ExecutionPolicy } from "@arnilo/prism";
import { assertPathInsideRoots, type CommandRule, evaluateCommandRules } from "@arnilo/prism-coding-tools/security";
import { PrismCodeConfigError } from "./errors.js";

/** Canonical repo key for persisted rules: realpath when the workspace exists, resolved path otherwise. */
function canonicalRepoRoot(cwd: string): string {
  try {
    const resolved = resolve(cwd);
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  } catch {
    return resolve(cwd);
  }
}

// ---------------------------------------------------------------------------
// Approval Modes & Config
// ---------------------------------------------------------------------------

/**
 * `ask` prompts for shell, mutations outside the workspace, and destructive git;
 * `accept-edits` auto-allows file edits inside the workspace and prompts for shell;
 * `auto` allows everything except the execution security hard denies.
 */
export type PrismCodeApprovalMode = "ask" | "accept-edits" | "auto";

export const PRISM_CODE_APPROVAL_MODES: readonly PrismCodeApprovalMode[] = ["ask", "accept-edits", "auto"];

export interface PrismCodeApprovalConfig {
  readonly mode?: PrismCodeApprovalMode;
  /** Approval timeout in ms; unset/0 means no timeout (the run waits for the operator). */
  readonly timeoutMs?: number;
}

const KNOWN_APPROVAL_KEYS = new Set(["mode", "timeoutMs"]);

export function resolvePrismCodeApprovalMode(config?: PrismCodeApprovalConfig): PrismCodeApprovalMode {
  return config?.mode ?? "ask";
}

/** `auto` is rejected unless the caller owns the trust boundary (global config, flags, `/approval`). */
export function validatePrismCodeApproval(raw: unknown, source: string, allowAuto = false): PrismCodeApprovalConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PrismCodeConfigError(`${source}: approval must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !KNOWN_APPROVAL_KEYS.has(key));
  if (unknown.length > 0) throw new PrismCodeConfigError(`${source}: unknown key(s): ${unknown.join(", ")}`);

  let mode: PrismCodeApprovalMode | undefined;
  if (record.mode !== undefined) {
    if (record.mode !== "ask" && record.mode !== "accept-edits" && record.mode !== "auto") {
      throw new PrismCodeConfigError(`${source}.mode: mode must be ask, accept-edits, or auto (got ${JSON.stringify(record.mode)})`);
    }
    if (record.mode === "auto" && !allowAuto) {
      throw new PrismCodeConfigError(
        `${source}.mode: "auto" cannot be set by a project config; use the global config, --approve, or /approval`,
      );
    }
    mode = record.mode;
  }

  let timeoutMs: number | undefined;
  if (record.timeoutMs !== undefined) {
    if (typeof record.timeoutMs !== "number" || !Number.isSafeInteger(record.timeoutMs) || record.timeoutMs < 0) {
      throw new PrismCodeConfigError(`${source}.timeoutMs: timeoutMs must be a non-negative safe integer`);
    }
    timeoutMs = record.timeoutMs;
  }

  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Persisted "always allow" rules
// ---------------------------------------------------------------------------

export interface PrismCodePermissionRule {
  /** Canonical repository root the rule was granted in; rules never apply across repos. */
  readonly repo: string;
  readonly tool: string;
  /** `shell` rules carry the approved command prefix; other tools are scoped by tool name alone. */
  readonly commandPrefix?: string;
  readonly createdAt: string;
}

export const PERMISSIONS_FILE_NAME = "permissions.json";
const MAX_PERMISSION_RULES = 500;
const MAX_COMMAND_PREFIX_CHARS = 64;

export function permissionRulesPath(home: string): string {
  return join(home, PERMISSIONS_FILE_NAME);
}

/** Owner-only store: a corrupt or unreadable file yields no rules, never a parse error. */
export function loadPermissionRules(home: string, repo: string): readonly PrismCodePermissionRule[] {
  const path = permissionRulesPath(home);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const rawRules = typeof parsed === "object" && parsed !== null ? (parsed as { rules?: unknown }).rules : undefined;
  if (!Array.isArray(rawRules)) return [];
  const canonical = canonicalRepoRoot(repo);
  return rawRules
    .map((entry) => coercePermissionRule(entry))
    .filter((rule): rule is PrismCodePermissionRule => rule !== undefined && rule.repo === canonical)
    .slice(0, MAX_PERMISSION_RULES);
}

function coercePermissionRule(entry: unknown): PrismCodePermissionRule | undefined {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
  const record = entry as Record<string, unknown>;
  if (typeof record.repo !== "string" || record.repo.length === 0 || typeof record.tool !== "string" || record.tool.length === 0) {
    return undefined;
  }
  return {
    repo: record.repo,
    tool: record.tool,
    ...(typeof record.commandPrefix === "string" && record.commandPrefix.length > 0 ? { commandPrefix: record.commandPrefix } : {}),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
  };
}

/** Replaces only `repo`'s rules; other repos' entries are preserved. Written `0600`. */
export function savePermissionRules(home: string, repo: string, rules: readonly PrismCodePermissionRule[]): void {
  const canonical = canonicalRepoRoot(repo);
  const path = permissionRulesPath(home);
  const existing: PrismCodePermissionRule[] = [];
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      const rawRules = typeof parsed === "object" && parsed !== null ? (parsed as { rules?: unknown }).rules : undefined;
      if (Array.isArray(rawRules)) {
        for (const entry of rawRules) {
          const rule = coercePermissionRule(entry);
          if (rule && rule.repo !== canonical) existing.push(rule);
        }
      }
    } catch {
      // A corrupt file is replaced with the rules the host just approved.
    }
  }
  const bounded = [...existing, ...rules.filter((rule) => rule.repo === canonical)].slice(-MAX_PERMISSION_RULES);
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ rules: bounded }, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

/** First two whitespace-separated tokens, bounded; `bun test --watch` persists as `bun test`. */
export function commandPrefix(command: string): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  return tokens.slice(0, 2).join(" ").slice(0, MAX_COMMAND_PREFIX_CHARS);
}

// ---------------------------------------------------------------------------
// Execution policy
// ---------------------------------------------------------------------------

export type PrismCodeApprovalDecision = "once" | "run" | "always" | "deny";

export interface PrismCodeApprovalRequest {
  readonly action: ExecutionAction;
  /** Operator-facing one-liner (kind/operation/paths/command). */
  readonly summary: string;
}

export type PrismCodeApprovalPrompt = (request: PrismCodeApprovalRequest) => Promise<PrismCodeApprovalDecision>;

export interface PrismCodeApprovalOptions {
  /** Trusted filesystem roots; paths outside them need approval in `ask` and are denied otherwise. */
  readonly roots: readonly string[];
  /** Workspace root used as the persisted-rule key (canonicalized). */
  readonly cwd: string;
  /** Prism home for `permissions.json`; omitted means rules are session-only. */
  readonly home?: string;
  readonly mode?: PrismCodeApprovalMode;
  readonly timeoutMs?: number;
  readonly prompt?: PrismCodeApprovalPrompt;
  /** Initial rules; when omitted and `home` is set, loaded from the permissions file. */
  readonly rules?: readonly PrismCodePermissionRule[];
  readonly commandRules?: readonly CommandRule[];
  /** Fired whenever an approval-required call is refused (headless tracks refusals for the exit code). */
  readonly onDenied?: (info: { readonly tool: string; readonly reason: string }) => void;
}

export interface PrismCodeApprovalController {
  readonly policy: ExecutionPolicy;
  getMode(): PrismCodeApprovalMode;
  setMode(mode: PrismCodeApprovalMode): void;
  listRules(): readonly PrismCodePermissionRule[];
  addRule(tool: string, commandValue?: string): PrismCodePermissionRule;
  removeRule(index: number): PrismCodePermissionRule | undefined;
}

const GIT_READ_OPERATIONS = new Set(["status", "diff"]);
const MAX_RUN_APPROVALS = 1_000;

function isMutatingAction(action: ExecutionAction): boolean {
  switch (action.kind) {
    case "shell":
    case "write":
    case "edit":
    case "delete":
    case "move":
    case "mcp":
      return true;
    case "git":
      return !GIT_READ_OPERATIONS.has(action.operation);
    default:
      return false;
  }
}

function actionToolId(action: ExecutionAction): string {
  const metadataTool = action.metadata?.toolName;
  return typeof metadataTool === "string" && metadataTool.length > 0 ? metadataTool : action.kind;
}

function summarizeAction(action: ExecutionAction): string {
  const paths = action.paths && action.paths.length > 0 ? ` [${action.paths.join(", ")}]` : "";
  const command = action.command ? ` $ ${action.command}` : "";
  return `${action.kind}: ${action.operation}${paths}${command}`;
}

function readAbortSignal(action: ExecutionAction): AbortSignal | undefined {
  const signal = action.metadata?.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

async function waitForPrompt(
  prompt: PrismCodeApprovalPrompt,
  request: PrismCodeApprovalRequest,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<PrismCodeApprovalDecision> {
  if (signal?.aborted) return "deny";
  const promptPromise = Promise.resolve(prompt(request)).catch(() => "deny" as const);
  if (!timeoutMs || timeoutMs <= 0) return promptPromise;

  return new Promise<PrismCodeApprovalDecision>((resolve) => {
    let settled = false;
    const finish = (decision: PrismCodeApprovalDecision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    const onAbort = () => finish("deny");
    const timer = setTimeout(() => finish("deny"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    promptPromise.then(finish, () => finish("deny"));
  });
}

export function createPrismCodeApprovalPolicy(options: PrismCodeApprovalOptions): PrismCodeApprovalController {
  const roots = [...options.roots];
  const canonicalRepo = canonicalRepoRoot(options.cwd);
  const rules: PrismCodePermissionRule[] =
    options.rules !== undefined
      ? [...options.rules]
      : options.home !== undefined
        ? [...loadPermissionRules(options.home, canonicalRepo)]
        : [];
  let mode = resolvePrismCodeApprovalMode(options);

  const persist = () => {
    if (options.home !== undefined) savePermissionRules(options.home, canonicalRepo, rules);
  };

  const matchesRule = (action: ExecutionAction): boolean => {
    const tool = actionToolId(action);
    return rules.some((rule) => {
      if (rule.repo !== canonicalRepo || rule.tool !== tool) return false;
      if (rule.commandPrefix !== undefined) {
        const prefix = commandPrefix(action.command ?? "");
        return prefix === rule.commandPrefix && action.command?.trim().startsWith(rule.commandPrefix) === true;
      }
      return true;
    });
  };

  // "Allow for run" memo: keyed by run, tool, and (for shell) command prefix.
  const runApprovals = new Map<string, true>();
  const runApprovalKey = (action: ExecutionAction): string | undefined => {
    const runId = action.metadata?.runId;
    if (typeof runId !== "string" || runId.length === 0) return undefined;
    const prefix = action.kind === "shell" ? commandPrefix(action.command ?? "") : "";
    return `${runId}:${actionToolId(action)}:${prefix}`;
  };
  const matchesRunApproval = (action: ExecutionAction): boolean => {
    const key = runApprovalKey(action);
    return key !== undefined && runApprovals.has(key);
  };
  const rememberRunApproval = (action: ExecutionAction): void => {
    const key = runApprovalKey(action);
    if (key === undefined) return;
    if (runApprovals.size >= MAX_RUN_APPROVALS) {
      const oldest = runApprovals.keys().next().value;
      if (oldest !== undefined) runApprovals.delete(oldest);
    }
    runApprovals.set(key, true);
  };

  const deny = (tool: string, reason: string): ExecutionDecision => {
    options.onDenied?.({ tool, reason });
    return { allowed: false, reason };
  };

  const policy: ExecutionPolicy = {
    async check(action: ExecutionAction): Promise<ExecutionDecision> {
      let outsideRoots = false;
      for (const path of action.paths ?? []) {
        if (!(await assertPathInsideRoots(roots, path))) {
          outsideRoots = true;
          break;
        }
      }

      // Hard denies come first and no mode or persisted rule can override them.
      if (action.kind === "shell" && typeof action.command === "string" && action.command.length > 0) {
        const evaluation = evaluateCommandRules(action.command, options.commandRules, { denyMetacharacters: true });
        if (evaluation.action === "deny") {
          return deny(actionToolId(action), evaluation.reason ?? "command denied by security rules");
        }
      }

      const mutating = isMutatingAction(action);
      let needsApproval = false;
      if (mode === "auto") {
        needsApproval = false;
      } else if (action.kind === "shell") {
        needsApproval = true;
      } else if (outsideRoots) {
        if (mode === "ask") {
          needsApproval = true;
        } else {
          return deny(actionToolId(action), `path outside trusted roots: ${(action.paths ?? []).join(", ")}`);
        }
      } else if (mutating) {
        needsApproval = mode === "ask";
      }

      const exclusive = action.kind === "shell";
      if (!needsApproval) return { allowed: true, exclusive };
      if (matchesRule(action) || matchesRunApproval(action)) return { allowed: true, exclusive };
      if (!options.prompt) return deny(actionToolId(action), `approval required for ${summarizeAction(action)} (no interactive approver)`);

      const request: PrismCodeApprovalRequest = { action, summary: summarizeAction(action) };
      const decision = await waitForPrompt(options.prompt, request, options.timeoutMs, readAbortSignal(action));
      if (decision === "deny") return deny(actionToolId(action), `approval denied for ${summarizeAction(action)}`);
      if (decision === "run") {
        rememberRunApproval(action);
      } else if (decision === "always") {
        addRule(actionToolId(action), action.kind === "shell" ? action.command : undefined);
      }
      return { allowed: true, exclusive };
    },
  };

  function addRule(tool: string, commandValue?: string): PrismCodePermissionRule {
    const prefix = commandValue !== undefined ? commandPrefix(commandValue) : undefined;
    const rule: PrismCodePermissionRule = {
      repo: canonicalRepo,
      tool,
      ...(prefix !== undefined && prefix.length > 0 ? { commandPrefix: prefix } : {}),
      createdAt: new Date().toISOString(),
    };
    const duplicate = rules.findIndex(
      (existing) => existing.repo === rule.repo && existing.tool === rule.tool && existing.commandPrefix === rule.commandPrefix,
    );
    if (duplicate >= 0) rules[duplicate] = rule;
    else rules.push(rule);
    persist();
    return rule;
  }

  return {
    policy,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    listRules: () => [...rules],
    addRule,
    removeRule: (index) => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= rules.length) return undefined;
      const [removed] = rules.splice(index, 1);
      persist();
      return removed;
    },
  };
}
