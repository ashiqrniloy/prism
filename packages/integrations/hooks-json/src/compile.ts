/**
 * Compile a validated hooks config onto Prism's public seams.
 *
 * | hooks.json event   | Prism hook                                                          |
 * | ------------------ | ------------------------------------------------------------------- |
 * | `SessionStart`     | `session.opened` (once per session; context drains on the next `context.build`) |
 * | `UserPromptSubmit` | `run.input` (block via `ctx.reject`, or queue additionalContext)       |
 * | `PreToolUse`       | `tool.call` (`updatedInput` rewrites args; `deny` blocks)             |
 * | `PostToolUse`      | `tool.result` (blocked handler withholds the result)                  |
 * | `Stop`             | `run.end` (continue ⇄ stop, bounded by `limits.maxContinuations`)     |
 *
 * Registrations are active once the package loads. No extension kernel.
 */
import { createHash } from "node:crypto";

import type { Message, PackageAPI, RunEndPayload, ToolResult } from "@arnilo/prism";
import { PackageLoadError } from "@arnilo/prism";

import { type ContextQueue, createContextQueue, defaultHookOutputDir } from "./async-queue.js";
import {
  DEFAULT_HANDLER_TIMEOUT_SECONDS,
  type HookHandlerInput,
  type HookOutcome,
  runCommandHandler,
  tokenizeCommand,
} from "./handlers/command.js";
import { type McpToolClient, runMcpToolHandler } from "./handlers/mcp.js";
import { compileMatcher } from "./matchers.js";
import {
  type CommandHookHandler,
  type HookDefinition,
  type HookEventName,
  type HookHandler,
  type HooksConfig,
  HooksConfigError,
  parseHooksConfig,
} from "./schema.js";

/** Warning surfaced through the extension bus (`hooks:warning`) and `onWarning`. */
export interface HooksWarning {
  readonly code: "untrusted_handler" | "trust_all" | "handler_failed" | "handler_timed_out" | "matcher_ignored" | "seam_missing";
  readonly event: HookEventName;
  readonly handler: string;
  readonly message: string;
}

export interface HooksJsonOptions {
  /** Required for `mcp_tool` handlers; the host owns transport and auth. */
  readonly mcpClient?: McpToolClient;
  readonly cwd?: string;
  /** Digest algorithm for `hookCommandHash`; default `sha256`. */
  readonly hashAlgorithm?: string;
  /** Spill directory for oversized context; default `<tmpdir>/hook_outputs`. */
  readonly hookOutputDir?: string;
  readonly onWarning?: (warning: HooksWarning) => void;
}

/** Config after schema defaults. `allowCommands` is the hash allow-list, or `"all"`. */
export interface HooksJsonConfig {
  readonly hooks?: Readonly<Record<string, unknown>>;
  readonly allowCommands?: "all" | Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly additionalContextLimit?: number;
  readonly SessionStart?: readonly unknown[];
  readonly UserPromptSubmit?: readonly unknown[];
  readonly PreToolUse?: readonly unknown[];
  readonly PostToolUse?: readonly unknown[];
  readonly Stop?: readonly unknown[];
}

/**
 * Digest of a command handler's effective argv (file + args). Hosts hash their own
 * handlers with this to build `options.trusted`; args are covered, so appending an
 * argument invalidates the entry.
 */
export function hookCommandHash(handler: CommandHookHandler, options: { readonly algorithm?: string } = {}): string {
  const algorithm = options.algorithm ?? "sha256";
  let argv: string[];
  try {
    argv = tokenizeCommand(handler.command).concat(handler.args ?? []);
  } catch (error) {
    throw new HooksConfigError((error as Error).message);
  }
  let digest: string;
  try {
    digest = createHash(algorithm).update(JSON.stringify(argv)).digest("hex");
  } catch {
    throw new HooksConfigError(`unknown hash algorithm ${JSON.stringify(algorithm)}`);
  }
  return `${algorithm}-${digest}`;
}

function handlerLabel(handler: HookHandler): string {
  return handler.type === "command" ? handler.command : `${handler.server}/${handler.tool}`;
}

function handlerTimeoutMs(handler: HookHandler): number {
  return (handler.timeout ?? DEFAULT_HANDLER_TIMEOUT_SECONDS) * 1000;
}

/** Bounded FIFO: hook decisions are per-tool-call and must not grow without bound. */
function boundedMap<V>(limit = 128): DecisionMap<V> {
  const map = new Map<string, V>() as DecisionMap<V>;
  map.put = (key: string, value: V) => {
    if (map.size >= limit) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, value);
  };
  return map;
}

type DecisionMap<V> = Map<string, V> & { put(key: string, value: V): void };

interface HandlerRunResult {
  readonly blocked: boolean;
  /** A handler returned the common-field stop signal (`continue: false`); the Stop seam honours it. */
  readonly stopped: boolean;
  readonly reason: string;
  readonly context: string;
  /** Per-handler context with its own inline cap, so `additionalContextLimit` stays per handler. */
  readonly contextItems: readonly { readonly text: string; readonly limit: number | undefined }[];
  readonly updatedInput?: Readonly<Record<string, unknown>>;
}

function messageText(messages: readonly Message[]): string {
  return messages
    .map((message) =>
      message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { readonly text: string }).text)
        .join("\n"),
    )
    .join("\n")
    .trim();
}

function resultSummary(result: ToolResult): Record<string, unknown> {
  return {
    ...(result.value === undefined ? {} : { value: result.value }),
    ...(result.content === undefined ? {} : { content: result.content }),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

async function withTimeout(outcome: Promise<HookOutcome>, timeoutMs: number, label: string): Promise<HookOutcome> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      outcome,
      new Promise<HookOutcome>((resolve) => {
        // ponytail: the losing call keeps running detached; cancel needs an MCP client with abort support.
        timer = setTimeout(
          () =>
            resolve({
              blocked: false,
              stopped: false,
              reason: `${label} timed out`,
              context: "",
              timedOut: true,
              failed: false,
              exitCode: null,
            }),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const PACKAGE = "@arnilo/prism-hooks-json";

function assertAllowListed(parsed: HooksConfig, allow: HooksJsonConfig["allowCommands"], algorithm?: string): void {
  if (allow === "all") return;
  const pins = allow ?? {};
  for (const definitions of Object.values(parsed.events)) {
    for (const definition of definitions ?? []) {
      for (const handler of definition.hooks) {
        if (handler.type !== "command") continue;
        let actual = "";
        try {
          actual = hookCommandHash(handler, { algorithm });
        } catch {
          actual = "";
        }
        if (pins[handler.command] !== actual) {
          throw new PackageLoadError("config_invalid", `Package ${PACKAGE} command is not allow-listed.`, {
            package: PACKAGE,
            path: "/allowCommands",
          });
        }
      }
    }
  }
}

export async function compileHooks(prism: PackageAPI<HooksJsonConfig>, options: HooksJsonOptions = {}): Promise<void> {
  const config = parseHooksConfig(prism.config);
  assertAllowListed(config, prism.config.allowCommands, options.hashAlgorithm);
  const env: Record<string, string> = {};
  for (const [key, ref] of Object.entries(prism.config.env ?? {})) {
    const credential = await prism.credentials.resolve(ref);
    if (!credential?.value) {
      throw new PackageLoadError("config_invalid", `Package ${PACKAGE} env ref did not resolve.`, { package: PACKAGE, path: `/env/${key}` });
    }
    env[key] = credential.value;
  }
  const name = PACKAGE;
  const queue: ContextQueue = createContextQueue(config.additionalContextLimit, options.hookOutputDir ?? defaultHookOutputDir());
  const warned = new Set<string>();
  const callArguments: DecisionMap<Readonly<Record<string, unknown>>> = boundedMap();
  let sessionId: string | undefined;
  let runId: string | undefined;

  const definitions = (event: HookEventName): readonly HookDefinition[] => config.events[event] ?? [];
  const configured = (event: HookEventName): boolean => definitions(event).length > 0;

  function warn(event: HookEventName, handler: string, code: HooksWarning["code"], message: string, once = false): void {
    const key = `${code}:${handler}`;
    if (once && warned.has(key)) return;
    warned.add(key);
    const warning: HooksWarning = { code, event, handler, message };
    options.onWarning?.(warning);
    prism.status.note("warn", `${code}: ${message}`.slice(0, 240));
  }

  async function invoke(handler: HookHandler, input: HookHandlerInput): Promise<HookOutcome> {
    if (handler.type === "command") return runCommandHandler(handler, input, { cwd: options.cwd, env });
    const call = runMcpToolHandler(handler, input, { mcpClient: options.mcpClient });
    return handler.timeout === undefined ? call : withTimeout(call, handlerTimeoutMs(handler), `${handler.server}/${handler.tool}`);
  }

  async function runHandlers(
    event: HookEventName,
    candidates: readonly string[] | undefined,
    input: HookHandlerInput,
  ): Promise<HandlerRunResult> {
    let blocked = false;
    let stopped = false;
    let reason = "";
    const contexts: string[] = [];
    const contextItems: { text: string; limit: number | undefined }[] = [];
    let updatedInput: Readonly<Record<string, unknown>> | undefined;

    for (const definition of definitions(event)) {
      const matcher = compileMatcher(definition.matcher);
      if (candidates !== undefined && !candidates.some((candidate) => matcher(candidate))) continue;
      for (const handler of definition.hooks) {
        const label = handlerLabel(handler);
        if (handler.async === true) {
          void invoke(handler, input)
            .then((outcome) => {
              if (outcome.context !== "") queue.add(outcome.context, handler.additionalContextLimit);
              if (outcome.failed) warn(event, label, "handler_failed", outcome.reason);
              if (outcome.timedOut) warn(event, label, "handler_timed_out", outcome.reason);
            })
            .catch((error: unknown) => warn(event, label, "handler_failed", (error as Error).message));
          continue;
        }
        const outcome = await invoke(handler, input);
        if (outcome.timedOut) {
          warn(event, label, "handler_timed_out", outcome.reason);
          continue;
        }
        if (outcome.failed) {
          warn(event, label, "handler_failed", outcome.reason);
          continue;
        }
        if (outcome.context !== "") {
          contexts.push(outcome.context);
          contextItems.push({ text: outcome.context, limit: handler.additionalContextLimit });
        }
        if (outcome.updatedInput !== undefined) updatedInput = outcome.updatedInput;
        if (outcome.stopped) stopped = true;
        if (outcome.blocked) {
          blocked = true;
          reason = outcome.reason !== "" ? outcome.reason : reason;
          // Keep evaluating: later handlers can still contribute context, which the
          // caller drops for a blocked call (dropping beats injecting into a veto).
        }
      }
    }

    return {
      blocked,
      stopped,
      reason,
      context: blocked ? "" : contexts.join("\n\n"),
      contextItems: blocked ? [] : contextItems,
      ...(updatedInput === undefined ? {} : { updatedInput }),
    };
  }

  /** Queue hook context through the shared injector, keeping each handler's own inline cap. */
  function queueContext(result: HandlerRunResult): void {
    for (const item of result.contextItems) queue.add(item.text, item.limit);
  }

  if (configured("PreToolUse")) {
    // PreToolUse now runs as a `tool.call` hook (see `setup`), not a tool-input guardrail.
  }

  if (configured("PostToolUse")) {
    // PostToolUse now runs as a `tool.result` hook (see `setup`).
  }

  if (prism.config.allowCommands === "all") {
    warn("SessionStart", "all", "trust_all", 'allowCommands "all": every command handler runs without a hash check');
  }
    for (const event of ["UserPromptSubmit", "Stop"] as const) {
      for (const definition of definitions(event)) {
        if (definition.matcher !== undefined) {
          warn(event, definition.matcher, "matcher_ignored", `${event} hooks have no matcher subject; the matcher is ignored`, true);
        }
      }
    }

  if (configured("SessionStart")) {
    prism.hooks.on("session.opened", async (event) => {
      sessionId = event.sessionId;
      runId = event.runId;
      const source = event.restored ? "resume" : "startup";
      const started = await runHandlers("SessionStart", [source], {
        event: "SessionStart",
        sessionId: event.sessionId,
        runId: event.runId,
        payload: { source },
      });
      if (started.context !== "") queueContext(started);
    });
  }

  if (configured("UserPromptSubmit")) {
      prism.hooks.on("run.input", async (messages, context) => {
        sessionId = context.sessionId;
        runId = context.runId;
        const result = await runHandlers("UserPromptSubmit", undefined, {
          event: "UserPromptSubmit",
          sessionId: context.sessionId,
          runId: context.runId,
          payload: { prompt: messageText(messages) },
        });
        if (result.context !== "") queueContext(result);
        // `run.input` is a transform: a blocking handler rejects the run instead of returning a decision.
        return result.blocked ? context.reject(result.reason !== "" ? result.reason : "blocked by UserPromptSubmit hook") : undefined;
      });
    }

    if (configured("PreToolUse")) {
      prism.hooks.on("tool.call", async (call) => {
        if (configured("PostToolUse")) callArguments.put(call.callId, call.args);
        const result = await runHandlers("PreToolUse", [call.name], {
          event: "PreToolUse",
          sessionId: sessionId ?? call.sessionId,
          runId: runId ?? call.runId,
          payload: { tool_name: call.name, tool_input: call.args, tool_use_id: call.callId },
        });
        if (result.blocked) {
          return { deny: result.reason !== "" ? result.reason : `blocked by PreToolUse hook for ${call.name}` };
        }
        queueContext(result);
        if (result.updatedInput !== undefined) return { rewrite: result.updatedInput as import("@arnilo/prism").JsonObject };
        return undefined;
      });
    }

    if (configured("PostToolUse")) {
      prism.hooks.on("tool.result", async (result) => {
        const decision = await runHandlers("PostToolUse", [result.name], {
          event: "PostToolUse",
          sessionId,
          runId,
          payload: {
            tool_name: result.name,
            tool_input: callArguments.get(result.toolCallId) ?? {},
            tool_response: resultSummary(result),
            tool_use_id: result.toolCallId,
          },
        });
        if (decision.context !== "") queueContext(decision);
        if (decision.blocked) {
          // `tool.result` is a transform: withhold the raw result by returning an error result.
          return {
            toolCallId: result.toolCallId,
            name: result.name,
            error: { message: decision.reason !== "" ? decision.reason : `blocked by PostToolUse hook for ${result.name}` },
          };
        }
        return undefined;
      });
    }

    if (configured("Stop")) {
      prism.hooks.on("run.end", async (payload: RunEndPayload) => {
        const result = await runHandlers("Stop", undefined, {
          event: "Stop",
          sessionId: payload.sessionId,
          runId: payload.runId,
          payload: { stop_hook_active: payload.history.length > 0, turn: payload.history.length },
        });
        // Codex: on Stop, `continue: false` wins over every continuation decision.
        if (result.stopped) return undefined;
        if (result.blocked) {
          return { continue: { reason: result.reason !== "" ? result.reason : "blocked by Stop hook" } };
        }
        if (result.context !== "") return { continue: { reason: "additional context from Stop hook", steer: result.context } };
        return undefined;
      }, { id: "Stop" });
    }

    if (configured("SessionStart") || configured("UserPromptSubmit") || configured("PreToolUse") || configured("PostToolUse")) {
      // `additionalContext` queued by any handler reaches the next turn as a system message at
      // the stable-prefix boundary, ahead of the dynamic transcript.
      prism.hooks.on("context.build", async (draft) => {
        const instructions = queue.drain();
        if (instructions === "") return undefined;
        const boundary = draft.messages.findIndex((message) => message.role !== "system");
        const at = boundary === -1 ? draft.messages.length : boundary;
        return {
          ...draft,
          messages: [
            ...draft.messages.slice(0, at),
            { id: `hooks-json:ctx:${at}`, role: "system", content: [{ type: "text", text: instructions }] },
            ...draft.messages.slice(at),
          ],
        };
      }, { id: "context" });
    }
}
