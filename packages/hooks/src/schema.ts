/**
 * `hooks.json` schema: the declarative config shapes this adapter accepts, and
 * the validation that rejects everything else loudly (`ERR_PRISM_HOOKS_CONFIG`).
 *
 * Two authoring shapes are accepted, unchanged:
 *   - Claude settings: `{ "PreToolUse": [{ "matcher": "Bash", "hooks": [...] }] }`
 *   - Codex: `{ "hooks": { "PreToolUse": [{ "type": "command", ... }] } }`
 *
 * Unknown event names are a hard error — a typo that silently disables a hook is
 * exactly the failure mode this package exists to avoid.
 */

/** Hook events this adapter compiles onto Prism seams. */
export const HOOK_EVENT_NAMES = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

/** Config-level failure. Always thrown, never degraded to "no hooks configured". */
export class HooksConfigError extends Error {
  readonly code = "ERR_PRISM_HOOKS_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "HooksConfigError";
  }
}

/** Shell-free command handler. `timeout` is in seconds (Claude/Codex convention); default 600. */
export interface CommandHookHandler {
  readonly type: "command";
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeout?: number;
  /** Run detached; output is delivered at the next assembly (turn boundary). */
  readonly async?: boolean;
  readonly asyncRewake?: boolean;
  readonly statusMessage?: string;
  /** Per-handler inline cap override in estimated tokens; `0` = unlimited (Codex sets it per handler). */
  readonly additionalContextLimit?: number;
}

/** Handler that calls a host-provided MCP client tool. `${field.path}` templates substitute into `input`. */
export interface McpToolHookHandler {
  readonly type: "mcp_tool";
  readonly server: string;
  readonly tool: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly timeout?: number;
  readonly async?: boolean;
  /** Per-handler inline cap override in estimated tokens; `0` = unlimited (Codex sets it per handler). */
  readonly additionalContextLimit?: number;
}

export type HookHandler = CommandHookHandler | McpToolHookHandler;

/** One event binding: optional matcher plus the handlers it selects. */
export interface HookDefinition {
  readonly matcher?: string;
  readonly hooks: readonly HookHandler[];
}

/** Validated hooks config. `additionalContextLimit` is a token threshold (Codex convention). */
export interface HooksConfig {
  readonly events: Readonly<Partial<Record<HookEventName, readonly HookDefinition[]>>>;
  /** Inline cap for injected context in estimated tokens; `0` = unlimited. Default 2500. */
  readonly additionalContextLimit: number;
}

/** Default inline context cap (Codex `additionalContextLimit`), in estimated tokens. */
export const DEFAULT_ADDITIONAL_CONTEXT_LIMIT = 2500;

/** Matcher patterns stay bounded: host-authored, but a runaway regex is still a foot-gun. */
const MAX_MATCHER_LENGTH = 256;
const MAX_COMMAND_LENGTH = 4096;
const KNOWN_EVENTS = new Set<string>(HOOK_EVENT_NAMES);

function fail(message: string): never {
  throw new HooksConfigError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimeout(value: unknown, where: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${where}: timeout must be a positive number of seconds`);
  }
  return value;
}

/** Codex sets `additionalContextLimit` per handler; an omitted field falls back to the config limit. */
function parseHandlerLimit(value: unknown, where: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${where}: additionalContextLimit must be a non-negative safe integer (estimated tokens, 0 = unlimited)`);
  }
  return value;
}

function parseHandler(value: unknown, where: string): HookHandler {
  if (!isPlainObject(value)) fail(`${where}: handler must be an object`);
  const type = value.type;
  if (type === "command") {
    const command = value.command;
    if (typeof command !== "string" || command.trim() === "") fail(`${where}: command must be a non-empty string`);
    if (command.length > MAX_COMMAND_LENGTH) fail(`${where}: command exceeds ${MAX_COMMAND_LENGTH} characters`);
    if (value.shell === true) {
      fail(`${where}: "shell" is not supported — handlers spawn with an args array and never interpolate a shell`);
    }
    const args = value.args;
    if (args !== undefined) {
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail(`${where}: args must be a string array`);
    }
    for (const flag of ["async", "asyncRewake"] as const) {
      if (value[flag] !== undefined && typeof value[flag] !== "boolean") fail(`${where}: ${flag} must be a boolean`);
    }
    if (value.statusMessage !== undefined && typeof value.statusMessage !== "string") {
      fail(`${where}: statusMessage must be a string`);
    }
    return {
      type: "command",
      command,
      ...(args === undefined ? {} : { args: args as readonly string[] }),
      ...(value.timeout === undefined ? {} : { timeout: parseTimeout(value.timeout, where) }),
      ...(value.async === undefined ? {} : { async: value.async === true }),
      ...(value.asyncRewake === undefined ? {} : { asyncRewake: value.asyncRewake === true }),
      ...(value.statusMessage === undefined ? {} : { statusMessage: value.statusMessage as string }),
      ...(value.additionalContextLimit === undefined
        ? {}
        : { additionalContextLimit: parseHandlerLimit(value.additionalContextLimit, where) }),
    };
  }
  if (type === "mcp_tool") {
    const { server, tool, input } = value;
    if (typeof server !== "string" || server === "") fail(`${where}: mcp_tool.server must be a non-empty string`);
    if (typeof tool !== "string" || tool === "") fail(`${where}: mcp_tool.tool must be a non-empty string`);
    if (input !== undefined && !isPlainObject(input)) fail(`${where}: mcp_tool.input must be an object`);
    if (value.async !== undefined && typeof value.async !== "boolean") fail(`${where}: async must be a boolean`);
    return {
      type: "mcp_tool",
      server,
      tool,
      ...(input === undefined ? {} : { input: input as Readonly<Record<string, unknown>> }),
      ...(value.timeout === undefined ? {} : { timeout: parseTimeout(value.timeout, where) }),
      ...(value.async === undefined ? {} : { async: value.async === true }),
      ...(value.additionalContextLimit === undefined
        ? {}
        : { additionalContextLimit: parseHandlerLimit(value.additionalContextLimit, where) }),
    };
  }
  fail(`${where}: unsupported handler type ${JSON.stringify(type)} (expected "command" or "mcp_tool")`);
}

/** Claude shape wraps handlers in `{ matcher, hooks }`; Codex lists bare handlers. Both normalize here. */
function parseDefinition(value: unknown, where: string): HookDefinition {
  if (!isPlainObject(value)) fail(`${where}: entry must be an object`);
  if (value.hooks !== undefined) {
    if (!Array.isArray(value.hooks) || value.hooks.length === 0) fail(`${where}: hooks must be a non-empty array`);
    const matcher = value.matcher;
    if (matcher !== undefined && typeof matcher !== "string") fail(`${where}: matcher must be a string`);
    if (typeof matcher === "string" && matcher.length > MAX_MATCHER_LENGTH) {
      fail(`${where}: matcher exceeds ${MAX_MATCHER_LENGTH} characters`);
    }
    return {
      ...(matcher === undefined || matcher === "" ? {} : { matcher }),
      hooks: value.hooks.map((handler, index) => parseHandler(handler, `${where}.hooks[${index}]`)),
    };
  }
  if (value.type !== undefined) return { hooks: [parseHandler(value, where)] };
  fail(`${where}: entry must be { matcher?, hooks: [...] } or a handler object`);
}

function parseAdditionalContextLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_ADDITIONAL_CONTEXT_LIMIT;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("additionalContextLimit must be a non-negative safe integer (estimated tokens, 0 = unlimited)");
  }
  return value;
}

/**
 * Parse and validate a hooks config from JSON text or an already-parsed object.
 * Accepts the Claude flat shape and the Codex `{ hooks: { ... } }` shape.
 */
export function parseHooksConfig(input: string | object): HooksConfig {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      fail(`hooks config is not valid JSON: ${(error as Error).message}`);
    }
  }
  if (!isPlainObject(raw)) fail("hooks config must be a JSON object");

  const wrapped = isPlainObject(raw.hooks) ? (raw.hooks as Record<string, unknown>) : raw;
  const limit = parseAdditionalContextLimit(raw.additionalContextLimit ?? wrapped.additionalContextLimit);
  const events: Partial<Record<HookEventName, readonly HookDefinition[]>> = {};

  for (const [name, value] of Object.entries(wrapped)) {
    if (name === "additionalContextLimit" || name === "hooks" || name === "description") continue;
    if (!KNOWN_EVENTS.has(name)) {
      fail(`unknown hook event ${JSON.stringify(name)} (supported: ${HOOK_EVENT_NAMES.join(", ")})`);
    }
    if (!Array.isArray(value)) fail(`${name} must be an array of hook definitions`);
    if (value.length === 0) continue;
    events[name as HookEventName] = value.map((entry, index) => parseDefinition(entry, `${name}[${index}]`));
  }

  return Object.freeze({ events: Object.freeze(events), additionalContextLimit: limit });
}
