/**
 * Compile a validated hooks config onto Prism's public seams.
 *
 * | hooks.json event   | Prism seam                                                              |
 * | ------------------ | ----------------------------------------------------------------------- |
 * | `SessionStart`     | `session_start` middleware → instruction-injector context queue         |
 * | `UserPromptSubmit` | `input` guardrail (block) → instruction-injector context queue          |
 * | `PreToolUse`       | `tool_call` middleware (`updatedInput`) + `tool_input` guardrail (`deny`) |
 * | `PostToolUse`      | `tool_result` middleware (context) + `tool_output` guardrail (`deny`)   |
 * | `Stop`             | registered stop hook (continue ⇄ stop, bounded by `maxStopContinuations`) |
 *
 * The extension contributes only inert seams: guardrails and stop hooks still
 * have to be activated by the host (`hooks.guardrails`, `activateKernel().stopHooks`,
 * `activateKernel().instructionInjectors`, `activateKernel().middleware`).
 */
import { createHash } from "node:crypto";

import type {
  Extension,
  ExtensionAPI,
  Guardrail,
  Guardrails,
  InstructionContribution,
  Message,
  StopHookDecision,
  ToolCallContent,
  ToolResult,
} from "@arnilo/prism";

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
} from "./schema.js";

/** Warning surfaced through the extension bus (`hooks:warning`) and `onWarning`. */
export interface HooksWarning {
  readonly code: "untrusted_handler" | "trust_all" | "handler_failed" | "handler_timed_out" | "matcher_ignored" | "seam_missing";
  readonly event: HookEventName;
  readonly handler: string;
  readonly message: string;
}

export interface HooksExtensionOptions {
  readonly name?: string;
  /** Command allowlist (Codex trust review): `{ "<command>": "<algo>-<hex>" }`, or `"all"` (logged loudly). */
  readonly trusted?: "all" | Readonly<Record<string, string>>;
  /** Digest algorithm for `hookCommandHash`; default `sha256`. */
  readonly hashAlgorithm?: string;
  /** Required for `mcp_tool` handlers; the host owns transport and auth. */
  readonly mcpClient?: McpToolClient;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Spill directory for oversized context; default `<tmpdir>/hook_outputs`. */
  readonly hookOutputDir?: string;
  readonly onWarning?: (warning: HooksWarning) => void;
}

/** What `createHooksExtension()` hands back: an `Extension` plus the guardrails the host must activate. */
export interface HooksExtension extends Extension {
  readonly guardrails: Guardrails;
  readonly config: HooksConfig;
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

export function createHooksExtension(config: HooksConfig, options: HooksExtensionOptions = {}): HooksExtension {
  const name = options.name ?? "hooks-json";
  const queue: ContextQueue = createContextQueue(config.additionalContextLimit, options.hookOutputDir ?? defaultHookOutputDir());
  const warned = new Set<string>();
  const preDecisions: DecisionMap<HandlerRunResult> = boundedMap();
  const postDecisions: DecisionMap<HandlerRunResult> = boundedMap();
  const callArguments: DecisionMap<Readonly<Record<string, unknown>>> = boundedMap();
  let api: ExtensionAPI | undefined;
  let sessionId: string | undefined;
  let runId: string | undefined;
  let missingGuardrailWarned = false;

  const definitions = (event: HookEventName): readonly HookDefinition[] => config.events[event] ?? [];
  const configured = (event: HookEventName): boolean => definitions(event).length > 0;

  function warn(event: HookEventName, handler: string, code: HooksWarning["code"], message: string, once = false): void {
    const key = `${code}:${handler}`;
    if (once && warned.has(key)) return;
    warned.add(key);
    const warning: HooksWarning = { code, event, handler, message };
    options.onWarning?.(warning);
    void api?.emit({
      type: "hooks:warning",
      extension: name,
      payload: { code, event, handler, message },
      metadata: { code, event, handler },
    });
  }

  function trusted(handler: HookHandler): boolean {
    if (handler.type !== "command") return true;
    if (options.trusted === "all") return true;
    const expected = options.trusted?.[handler.command];
    if (expected === undefined) {
      warn("SessionStart", handler.command, "untrusted_handler", "not in the trusted allowlist; handler skipped", true);
      return false;
    }
    let actual: string;
    try {
      actual = hookCommandHash(handler, { algorithm: options.hashAlgorithm });
    } catch (error) {
      warn("SessionStart", handler.command, "untrusted_handler", (error as Error).message, true);
      return false;
    }
    if (actual !== expected) {
      warn("SessionStart", handler.command, "untrusted_handler", "hash mismatch; handler skipped", true);
      return false;
    }
    return true;
  }

  async function invoke(handler: HookHandler, input: HookHandlerInput): Promise<HookOutcome> {
    if (handler.type === "command") return runCommandHandler(handler, input, { cwd: options.cwd, env: options.env });
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
        if (!trusted(handler)) continue;
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

  const guardrails: {
    input?: readonly Guardrail<"input">[];
    toolInput?: readonly Guardrail<"tool_input">[];
    toolOutput?: readonly Guardrail<"tool_output">[];
  } = {};

  if (configured("UserPromptSubmit")) {
    guardrails.input = [
      {
        name: `${name}:UserPromptSubmit`,
        stage: "input",
        async evaluate(context) {
          sessionId = context.sessionId;
          runId = context.runId;
          const result = await runHandlers("UserPromptSubmit", undefined, {
            event: "UserPromptSubmit",
            sessionId: context.sessionId,
            runId: context.runId,
            payload: { prompt: messageText(context.value) },
          });
          if (result.context !== "") queueContext(result);
          return result.blocked
            ? { action: "block", reason: result.reason !== "" ? result.reason : "blocked by UserPromptSubmit hook" }
            : { action: "allow" };
        },
      },
    ];
  }

  if (configured("PreToolUse")) {
    guardrails.toolInput = [
      {
        name: `${name}:PreToolUse`,
        stage: "tool_input",
        async evaluate(context) {
          const call = context.value;
          // The `tool_call` middleware already ran the handlers for this call; the
          // guardrail only consumes that verdict. Without the middleware it runs them
          // here so a host that activated guardrails alone still gets deny semantics.
          let result = preDecisions.get(call.id);
          if (result !== undefined) preDecisions.delete(call.id);
          else {
            if (!missingGuardrailWarned) {
              warn("PreToolUse", name, "seam_missing", "activate hooks.middleware so PreToolUse updatedInput applies", true);
              missingGuardrailWarned = true;
            }
            result = await runHandlers("PreToolUse", [call.name], {
              event: "PreToolUse",
              sessionId: sessionId ?? context.sessionId,
              runId: runId ?? context.runId,
              payload: { tool_name: call.name, tool_input: call.arguments, tool_use_id: call.id },
            });
          }
          // Context queued here is dropped when the decision denies the call.
          queueContext(result);
          if (!result.blocked) return { action: "allow" };
          return { action: "block", reason: result.reason !== "" ? result.reason : `blocked by PreToolUse hook for ${call.name}` };
        },
      },
    ];
  }

  if (configured("PostToolUse")) {
    guardrails.toolOutput = [
      {
        name: `${name}:PostToolUse`,
        stage: "tool_output",
        async evaluate(context) {
          const result = context.value;
          let decision = postDecisions.get(result.toolCallId);
          if (decision !== undefined) postDecisions.delete(result.toolCallId);
          else {
            decision = await runHandlers("PostToolUse", [result.name], {
              event: "PostToolUse",
              sessionId: sessionId ?? context.sessionId,
              runId: runId ?? context.runId,
              payload: {
                tool_name: result.name,
                tool_input: callArguments.get(result.toolCallId) ?? {},
                tool_response: resultSummary(result),
                tool_use_id: result.toolCallId,
              },
            });
          }
          if (!decision.blocked) return { action: "allow" };
          return { action: "block", reason: decision.reason !== "" ? decision.reason : `blocked by PostToolUse hook for ${result.name}` };
        },
      },
    ];
  }

  function setup(extensionApi: ExtensionAPI): void {
    api = extensionApi;

    if (options.trusted === "all") {
      warn("SessionStart", "all", "trust_all", 'options.trusted = "all": every command handler runs without a hash check');
    }
    for (const event of ["UserPromptSubmit", "Stop"] as const) {
      for (const definition of definitions(event)) {
        if (definition.matcher !== undefined) {
          warn(event, definition.matcher, "matcher_ignored", `${event} hooks have no matcher subject; the matcher is ignored`, true);
        }
      }
    }

    if (configured("SessionStart")) {
      extensionApi.use("session_start", async (payload: { readonly sessionId: string; readonly runId: string }, next) => {
        sessionId = payload.sessionId;
        runId = payload.runId;
        const result = await runHandlers("SessionStart", ["startup", "resume"], {
          event: "SessionStart",
          sessionId: payload.sessionId,
          runId: payload.runId,
          payload: { source: "startup" },
        });
        if (result.context !== "") queueContext(result);
        return next(payload);
      });
    }

    if (configured("PreToolUse") || configured("PostToolUse")) {
      extensionApi.use<ToolCallContent>("tool_call", async (call, next) => {
        if (configured("PostToolUse")) callArguments.put(call.id, call.arguments);
        if (!configured("PreToolUse")) return next(call);
        const result = await runHandlers("PreToolUse", [call.name], {
          event: "PreToolUse",
          sessionId,
          runId,
          payload: { tool_name: call.name, tool_input: call.arguments, tool_use_id: call.id },
        });
        preDecisions.put(call.id, result);
        if (result.blocked && guardrails.toolInput === undefined) {
          warn("PreToolUse", name, "seam_missing", `activate hooks.guardrails.toolInput to block ${call.name}`, true);
        }
        // The guardrail drops this context when it denies the call; without a guardrail
        // nothing can deny, so the middleware queues it here.
        if (guardrails.toolInput === undefined) queueContext(result);
        if (result.updatedInput === undefined) return next(call);
        return next({ ...call, arguments: result.updatedInput as ToolCallContent["arguments"] });
      });
    }

    if (configured("PostToolUse")) {
      extensionApi.use<ToolResult>("tool_result", async (result, next) => {
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
        postDecisions.put(result.toolCallId, decision);
        if (decision.context !== "") queueContext(decision);
        if (decision.blocked && guardrails.toolOutput === undefined) {
          warn("PostToolUse", name, "seam_missing", `activate hooks.guardrails.toolOutput to block ${result.name}`, true);
        }
        return next(result);
      });
    }

    if (configured("Stop")) {
      extensionApi.registerStopHook({
        name: `${name}:Stop`,
        async decide(context): Promise<StopHookDecision> {
          const result = await runHandlers("Stop", undefined, {
            event: "Stop",
            sessionId: context.sessionId,
            runId: context.runId,
            payload: { stop_hook_active: context.stopHookActive, turn: context.turn },
          });
          // Codex: on Stop, `continue: false` wins over every continuation decision.
          if (result.stopped) return { action: "stop" };
          if (result.blocked) {
            return { action: "continue", reason: result.reason !== "" ? result.reason : "blocked by Stop hook" };
          }
          if (result.context !== "") return { action: "continue", reason: "additional context from Stop hook", steer: result.context };
          return { action: "stop" };
        },
      });
    }

    if (configured("SessionStart") || configured("UserPromptSubmit") || configured("PreToolUse") || configured("PostToolUse")) {
      extensionApi.registerInstructionInjector({
        name: `${name}:context`,
        description: "Delivers hooks.json additionalContext once at the next turn boundary.",
        apply: (): InstructionContribution => {
          const instructions = queue.drain();
          return instructions === "" ? { when: "every_turn" } : { when: "every_turn", instructions };
        },
      });
    }
  }

  return {
    name,
    setup,
    config,
    guardrails: Object.freeze({ ...guardrails }),
  };
}
