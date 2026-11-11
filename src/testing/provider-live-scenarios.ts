import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type {
  ContentBlock,
  JsonObject,
  ModelConfig,
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
  ToolCallContent,
  ToolDefinition,
  Usage,
} from "../contracts.js";
import type { PackageInstance } from "../packages/api.js";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderStreamConforms,
  collectProviderEvents,
} from "../provider-kit/conformance.js";

/** Non-sensitive prompt text repeated to exceed typical prefix-cache minimum thresholds (~1 KiB). */
export const DEFAULT_LIVE_CACHE_PREFIX =
  "Memory is the residue of thought. We remember what we think about, not what we merely see. " +
  "This is why active recall outperforms passive rereading: retrieval re-weaves the trace. " +
  "Spacing practice widens the window in which a trace survives. Interleaving forces discrimination. " +
  "Elaboration binds new traces to old. Each of these effects is small alone and large together. ".repeat(8);

/** Reusable weather tool definition for tool-loop probes across providers. */
export const LIVE_WEATHER_TOOL: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a location.",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City or location name" },
      city: { type: "string", description: "Alternative city property" },
    },
    required: [],
  },
  execute: (args) => ({
    toolCallId: "live",
    name: "get_weather",
    value: { location: args.location ?? args.city ?? "Tokyo", temp: "18C", conditions: "cloudy" },
  }),
};

export type LiveRouteName = "native" | "openai" | "anthropic" | "responses";

export interface LiveRouteConfig {
  readonly model: string | ModelConfig;
  /** Whether model supports structured output. Defaults to checking model.capabilities.structuredOutput === "json_schema". */
  readonly structuredOutput?: "json_schema" | "reject" | boolean;
  /** Custom session id (OpenCode Go requires sessionId). */
  readonly sessionId?: string;
  /** Custom cache prefix if desired. */
  readonly cachePrefix?: string;
  /** Optional model override for cache probe if primary model does not report cache accounting. */
  readonly cacheModel?: string | ModelConfig;
  /** Structured-output prompt, for services that answer the shared schema-less prompt in prose. */
  readonly structuredPrompt?: string;
  /** Model used by the error scenario when the service accepts an empty `messages` array. */
  readonly errorModel?: string | ModelConfig;
}

export type LiveRouteInput = string | ModelConfig | LiveRouteConfig;

export interface ProviderLiveScenariosOptions {
  /** Restrict probes, e.g. a separately budgeted paid cache row. Absent runs all scenarios. */
  readonly scenarios?: readonly ("text" | "tool-loop" | "structured-output" | "abort" | "error" | "cache")[];
  /** Provider instance or factory. If a PackageInstance is given, it is automatically resolved. */
  readonly provider:
    | ModelProvider
    | PackageInstance
    | ((options?: { fetch?: typeof fetch }) => ModelProvider | PackageInstance | Promise<ModelProvider | PackageInstance>);
  /** Route definitions: chat/openai, anthropic/messages, responses (OpenAI Responses, stateless). */
  readonly routes: {
    readonly native?: LiveRouteInput;
    readonly openai?: LiveRouteInput;
    readonly anthropic?: LiveRouteInput;
    readonly responses?: LiveRouteInput;
  };
  /** Name of env var holding secret (e.g. "HYPER_API_KEY", "OPENCODE_GO_API_KEY"). */
  readonly secretEnv?: string | readonly string[];
  /** Optional explicit secrets to assert no leak. Defaults to reading from process.env[secretEnv]. */
  readonly secrets?: readonly string[];
  /** Optional suite title override. */
  readonly title?: string;
  /** Optional skip condition function. Returns skip reason string or false. */
  readonly skipUnless?: () => string | false;
  /** Optional fetch override (e.g. for recorded hermetic testing). */
  readonly fetch?: typeof fetch;
}

export interface SystemOneLiveScenariosOptions {
  readonly provider:
    | ModelProvider
    | PackageInstance
    | ((options?: { fetch?: typeof fetch }) => ModelProvider | PackageInstance | Promise<ModelProvider | PackageInstance>);
  readonly model: string | ModelConfig;
  readonly secretEnv?: string | readonly string[];
  readonly secrets?: readonly string[];
  readonly baseUrl?: string;
  readonly title?: string;
  readonly reachabilityCheck?: boolean | ((baseUrl: string) => Promise<{ reachable: boolean; reason?: string }>);
  readonly skipUnless?: () => string | false;
  readonly fetch?: typeof fetch;
  /** Test name for the shared decide leg; packages pass e.g. `typesafe_live_decide`. */
  readonly decideTestName?: string;
}

export interface LiveSuiteRegistrationResult {
  readonly skipped: boolean;
  readonly reason?: string;
}

/** Check whether a local Laya server is reachable; skips cleanly if absent. */
export async function checkLayaServerReachable(baseUrl: string): Promise<{ reachable: boolean; reason?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "probe", state: "ping", questions: {} }),
      signal: controller.signal,
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);
    return { reachable: true };
  } catch (err) {
    return {
      reachable: false,
      reason: `laya-serve is not running at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Resolves a ModelProvider from a direct instance, factory function, or PackageInstance. */
export async function resolveLiveProvider(
  target: ProviderLiveScenariosOptions["provider"],
  options?: { fetch?: typeof fetch; secrets?: readonly string[] },
): Promise<ModelProvider> {
  const resolved = typeof target === "function" ? await target(options) : target;
  if ("generate" in resolved && typeof resolved.generate === "function") {
    return resolved;
  }
  let captured: ModelProvider | undefined;
  const pkgInstance = resolved as PackageInstance;
  const mockPrism: unknown = {
    config: pkgInstance.config ?? {},
    credentials: {
      resolve: async (ref: string) => {
        if (ref.startsWith("env:")) {
          const varName = ref.slice(4);
          const val = process.env[varName];
          return val !== undefined ? { value: val } : undefined;
        }
        return undefined;
      },
    },
    status: {
      note: () => {},
    },
    providers: {
      register: (p: ModelProvider) => {
        captured = p;
      },
    },
  };
  await pkgInstance.definition.setup(mockPrism as never);
  if (!captured) {
    throw new Error(`Package ${pkgInstance.definition.name} did not register a provider during setup`);
  }
  return captured;
}

export function resolveSecrets(secretEnv?: string | readonly string[], explicit?: readonly string[]): string[] {
  if (explicit && explicit.length > 0) return [...explicit];
  if (!secretEnv) return [];
  const envVars = Array.isArray(secretEnv) ? secretEnv : [secretEnv];
  const list: string[] = [];
  for (const name of envVars) {
    const val = process.env[name];
    if (val) list.push(val);
  }
  return list;
}

export function determineSkipReason(options: {
  readonly secretEnv?: string | readonly string[];
  readonly secrets?: readonly string[];
  readonly skipUnless?: () => string | false;
}): string | false {
  const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
  const secrets = resolveSecrets(options.secretEnv, options.secrets);
  const customSkip = options.skipUnless ? options.skipUnless() : false;

  if (customSkip) return customSkip;
  if (!LIVE) return "set PRISM_LIVE_PROVIDER_TESTS=1 to run provider live tests";
  if (options.secretEnv && secrets.length === 0) {
    const names = Array.isArray(options.secretEnv) ? options.secretEnv.join(" or ") : options.secretEnv;
    return `set PRISM_LIVE_PROVIDER_TESTS=1 and ${names} to run live smoke tests`;
  }
  return false;
}

async function resolveModelConfig(
  provider: ModelProvider,
  input: LiveRouteInput,
  route: LiveRouteName,
): Promise<{ readonly model: ModelConfig; readonly config: LiveRouteConfig }> {
  const config: LiveRouteConfig =
    typeof input === "string"
      ? { model: input }
      : "model" in input && typeof input.model === "string" && !("provider" in input)
        ? (input as LiveRouteConfig)
        : { model: input as ModelConfig };

  const modelId = typeof config.model === "string" ? config.model : config.model.model;
  let modelConfig: ModelConfig | undefined;

  if (typeof config.model !== "string") {
    modelConfig = config.model;
  } else if (provider.models) {
    const catalog = await provider.models();
    const found = catalog.find((m) => m.model === modelId);
    if (found) {
      modelConfig = {
        ...found,
        compat: { ...(found.compat ?? {}), route },
      };
    }
  }

  if (!modelConfig) {
    modelConfig = {
      provider: provider.id,
      model: modelId,
      capabilities: {
        structuredOutput: modelId.includes("mimo") || modelId.includes("deepseek") ? "json_schema" : undefined,
      },
      compat: { route },
    };
  }

  return { model: modelConfig, config };
}

// ── Shared Scenario Executors ────────────────────────────────────────────────

/**
 * Names the provider's terminal `error` event in a failed assertion, so a billing, quota, or
 * retired-model refusal is not reported as an empty answer. Secrets are masked before printing.
 */
function terminalErrorSuffix(events: readonly ProviderEvent[], secrets: readonly string[]): string {
  const last = events.at(-1);
  if (last?.type !== "error") return "";
  let message = last.error.message;
  for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
  return ` (provider error: ${message.slice(0, 500)})`;
}

export async function liveScenarioTextStream(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly route: string;
  readonly secrets: readonly string[];
  readonly sessionId?: string;
  readonly prompt?: string;
}): Promise<{ readonly text: string; readonly usage?: Usage }> {
  const events = await assertProviderStreamConforms({
    provider: options.provider,
    request: {
      model: options.model,
      messages: [{ role: "user", content: [{ type: "text", text: options.prompt ?? "Say hello in one sentence." }] }],
      options: {
        sessionId: options.sessionId ?? `live-text-${Date.now()}`,
      },
    },
  });
  const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
  assert.ok(text.length > 0, `live text response was empty${terminalErrorSuffix(events, options.secrets)}`);
  assertNoSecretLeak(events, options.secrets);
  const usage = events.find((e) => e.type === "usage")?.usage;
  if (usage) {
    console.info(`[${options.provider.id} live] ${options.route} text usage: ${JSON.stringify(usage)}`);
  }
  return { text, usage };
}

export async function systemOneScenarioDecide(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly secrets: readonly string[];
}): Promise<{ readonly model: string; readonly answers: unknown; readonly timingMs: number }> {
  const decisions = options.provider.decisions;
  assert.ok(decisions, "System One provider must expose decisions()");
  const result = await decisions().decide({
    model: options.model.model,
    state: "A customer reports that checkout fails with error 500 and asks for a refund.",
    questions: {
      urgent: { type: "noul", instructions: "Is the customer blocked right now?" },
      team: { type: "choice", instructions: "Which team owns this?", criteria: { billing: null, shipping: null } },
      severity: { type: "score", instructions: "How severe is it?", criteria: ["low", "medium", "high"] },
    },
  });
  const answers = result.answers;
  assert.equal(answers.urgent?.type, "noul", "noul answer must keep its type");
  assert.equal(answers.team?.type, "choice", "choice answer must keep its type");
  assert.equal(answers.severity?.type, "score", "score answer must keep its type");
  assert.ok(typeof result.timingMs === "number" && result.timingMs >= 0);
  const serialized = JSON.stringify(result);
  for (const secret of options.secrets) {
    assert.ok(!serialized.includes(secret), "a live decide result must not contain a credential");
  }
  return result;
}

export async function liveScenarioToolLoop(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly route: string;
  readonly secrets: readonly string[];
  readonly sessionId?: string;
  readonly prompt?: string;
  readonly tool?: ToolDefinition;
}): Promise<{ readonly toolCalls: readonly ToolCallContent[]; readonly turn1Usage?: Usage; readonly turn2Usage?: Usage }> {
  const tool = options.tool ?? LIVE_WEATHER_TOOL;
  const turn1Request: ProviderRequest = {
    model: options.model,
    messages: [{ role: "user", content: [{ type: "text", text: options.prompt ?? "What is the weather in Tokyo?" }] }],
    tools: [tool],
    options: {
      sessionId: options.sessionId ?? `live-tool-loop-${Date.now()}`,
    },
  };
  const turn1Events = await assertProviderStreamConforms({ provider: options.provider, request: turn1Request });
  assertNoSecretLeak(turn1Events, options.secrets);
  const turn1Usage = turn1Events.find((e) => e.type === "usage")?.usage;
  if (turn1Usage) {
    console.info(`[${options.provider.id} live] ${options.route} tool-loop turn1 usage: ${JSON.stringify(turn1Usage)}`);
  }

  const toolCallEvents = turn1Events.filter((e) => e.type === "tool_call");
  assert.ok(toolCallEvents.length > 0, `Turn 1 tool prompt produced no tool calls${terminalErrorSuffix(turn1Events, options.secrets)}`);
  const toolCalls: ToolCallContent[] = [];
  for (const tc of toolCallEvents) {
    if (tc.type === "tool_call") {
      assert.ok(tc.call.name, "tool call missing name");
      toolCalls.push(tc.call);
    }
  }

  const assistantContent: ContentBlock[] = [];
  for (const e of turn1Events) {
    if (e.type === "content_delta") {
      if (e.content.type === "thinking") {
        assistantContent.push({
          type: "thinking",
          text: e.content.text,
          signature: e.content.signature,
        });
      } else if (e.content.type === "text" && e.content.text) {
        const prev = assistantContent.at(-1);
        if (prev && prev.type === "text") {
          (prev as { text: string }).text += e.content.text;
        } else {
          assistantContent.push({ type: "text", text: e.content.text });
        }
      }
    } else if (e.type === "tool_call") {
      assistantContent.push({
        type: "tool_call",
        id: e.call.id,
        name: e.call.name,
        arguments: (e.call.arguments ?? {}) as JsonObject,
      });
    }
  }

  const turn2Request: ProviderRequest = {
    model: options.model,
    messages: [
      ...turn1Request.messages,
      {
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : [{ type: "text", text: "" }],
      },
      {
        role: "tool",
        content: toolCalls.map((tc) => ({
          type: "tool_result" as const,
          toolCallId: tc.id,
          name: tc.name,
          result: { location: "Tokyo", temp: "18C", conditions: "cloudy" },
        })),
      },
    ],
    tools: [tool],
    options: turn1Request.options,
  };

  const turn2Events = await assertProviderStreamConforms({ provider: options.provider, request: turn2Request });
  const term2 = turn2Events.at(-1);
  assert.equal(term2?.type, "done", "Turn 2 must finish with done, proving thinking/reasoning replay acceptance");
  assertNoSecretLeak(turn2Events, options.secrets);
  const turn2Usage = turn2Events.find((e) => e.type === "usage")?.usage;
  if (turn2Usage) {
    console.info(`[${options.provider.id} live] ${options.route} tool-loop turn2 usage: ${JSON.stringify(turn2Usage)}`);
  }

  return { toolCalls, turn1Usage, turn2Usage };
}

export async function liveScenarioStructuredOutput(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly route: string;
  readonly secrets: readonly string[];
  readonly sessionId?: string;
  readonly structuredOutput?: "json_schema" | "reject" | boolean;
  readonly schema?: JsonObject;
  readonly prompt?: string;
}): Promise<{ readonly ok: boolean; readonly rejected?: boolean; readonly value?: unknown }> {
  const schema = options.schema ?? {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  };

  const modelToUse: ModelConfig =
    options.structuredOutput === "json_schema" || options.structuredOutput === true
      ? { ...options.model, capabilities: { ...(options.model.capabilities ?? {}), structuredOutput: "json_schema" } }
      : options.model;

  const request: ProviderRequest = {
    model: modelToUse,
    messages: [
      { role: "user", content: [{ type: "text", text: options.prompt ?? "Reply with a JSON object matching the requested schema." }] },
    ],
    options: {
      sessionId: options.sessionId ?? `live-structured-${Date.now()}`,
      structuredOutput: { name: "probe", schema },
    },
  };

  if (options.structuredOutput === "reject") {
    let rejected = false;
    try {
      const events = await collectProviderEvents(options.provider, request);
      const term = events.at(-1);
      assertNoSecretLeak(events, options.secrets);
      if (term?.type === "error") rejected = true;
    } catch {
      rejected = true;
    }
    assert.ok(rejected, `Model ${options.model.model} was expected to reject structured output but succeeded`);
    return { ok: true, rejected: true };
  }

  const events = await collectProviderEvents(options.provider, request);
  assertNoSecretLeak(events, options.secrets);
  const term = events.at(-1);
  if (term?.type === "error") {
    // Documented rejection
    return { ok: true, rejected: true };
  }

  assert.equal(term?.type, "done", "structured output completed with done");
  const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
  const parsed = JSON.parse(text);
  assert.ok(typeof parsed === "object" && parsed !== null, "structured output was not valid JSON");
  const usage = events.find((e) => e.type === "usage")?.usage;
  if (usage) {
    console.info(`[${options.provider.id} live] ${options.route} structured output usage: ${JSON.stringify(usage)}`);
  }
  return { ok: true, value: parsed };
}

export async function liveScenarioAbort(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly route: string;
  readonly sessionId?: string;
}): Promise<void> {
  await assertAbortIsObserved({
    provider: options.provider,
    request: {
      model: options.model,
      messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: pong" }] }],
      options: { sessionId: options.sessionId ?? "live-abort" },
    },
  });
}

export async function liveScenarioErrorResponse(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly route: string;
  readonly secrets: readonly string[];
  readonly sessionId?: string;
  /** Unknown model to provoke the error; used when the service accepts an empty `messages` array. */
  readonly errorModel?: ModelConfig;
}): Promise<void> {
  const badReq: ProviderRequest = options.errorModel
    ? {
        model: options.errorModel,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: pong" }] }],
        options: { sessionId: options.sessionId ?? "live-error" },
      }
    : {
        model: options.model,
        messages: [],
        options: { sessionId: options.sessionId ?? "live-error" },
      };
  const events = await collectProviderEvents(options.provider, badReq);
  const term = events.at(-1);
  assert.ok(term, "live error request produced no events");
  assert.equal(term.type, "error", "invalid request unexpectedly succeeded");
  assertNoSecretLeak(events, options.secrets);
}

export async function liveScenarioCacheProbe(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly route: string;
  readonly secrets: readonly string[];
  readonly sessionId?: string;
  readonly cachePrefix?: string;
  readonly isHermetic?: boolean;
}): Promise<{ readonly turn1Usage?: Usage; readonly turn2Usage?: Usage }> {
  const prefix = options.cachePrefix ?? DEFAULT_LIVE_CACHE_PREFIX;
  const isAnthropic = options.route === "anthropic" || options.model.compat?.route === "anthropic";

  if (options.isHermetic) {
    // Hermetic replay mode: verify single recorded warm cache turn
    const req: ProviderRequest = {
      model: options.model,
      messages: [{ role: "user", content: [{ type: "text", text: prefix }] }],
      options: { sessionId: options.sessionId ?? "live-cache-hermetic" },
    };
    const events = await assertProviderStreamConforms({ provider: options.provider, request: req });
    const usage = events.find((e) => e.type === "usage")?.usage;
    assert.ok(usage, "Hermetic cache recording must include usage");
    assert.ok((usage.cacheReadTokens ?? 0) > 0, "Hermetic cache recording reported no cached tokens");
    assert.ok((usage.inputTokens ?? 0) >= (usage.cacheReadTokens ?? 0), "inputTokens must be >= cacheReadTokens");
    assertNoSecretLeak(events, options.secrets);
    return { turn2Usage: usage };
  }

  if (isAnthropic) {
    const sessionId = options.sessionId ?? `live-cache-anthropic-${Date.now()}`;
    const makeAnthropicTurn = (label: string): ProviderRequest => ({
      model: options.model,
      messages: [
        { role: "user", content: [{ type: "text", text: prefix }] },
        { role: "user", content: [{ type: "text", text: `Reply with exactly the word: ${label}` }] },
      ],
      options: {
        sessionId,
        cache: { breakpoints: [{ location: "last_message" }] },
      },
    });
    const turn1Events = await assertProviderStreamConforms({ provider: options.provider, request: makeAnthropicTurn("one") });
    const turn2Events = await assertProviderStreamConforms({ provider: options.provider, request: makeAnthropicTurn("two") });
    const u1 = turn1Events.find((e) => e.type === "usage")?.usage;
    const u2 = turn2Events.find((e) => e.type === "usage")?.usage;
    console.info(
      `[${options.provider.id} live] messages-route cache probe: create {write:${u1?.cacheWriteTokens ?? 0}, read:${u1?.cacheReadTokens ?? 0}} ` +
        `warm {read:${u2?.cacheReadTokens ?? 0}, write:${u2?.cacheWriteTokens ?? 0}}`,
    );
    assert.ok((u2?.cacheReadTokens ?? 0) > 0, "Warm messages-route replay reported no cached tokens");
    assert.ok((u2?.inputTokens ?? 0) >= (u2?.cacheReadTokens ?? 0), "inputTokens must be >= cacheReadTokens");
    assertNoSecretLeak(turn1Events, options.secrets);
    assertNoSecretLeak(turn2Events, options.secrets);
    return { turn1Usage: u1, turn2Usage: u2 };
  }

  // Keep routing affinity and explicit cache boundary on the stable prefix across turns.
  const sessionId = options.sessionId ?? `live-cache-chat-${Date.now()}`;
  const makeTurn = (label: string): ProviderRequest => ({
    model: options.model,
    messages: [
      { role: "user", content: [{ type: "text", text: prefix }] },
      { role: "user", content: [{ type: "text", text: `Reply with exactly the word: ${label}` }] },
    ],
    options: {
      sessionId,
      ...(options.model.cache?.kind === "cache_control" ? { cache: { breakpoints: [{ location: "stable_context" as const }] } } : {}),
    },
  });

  const turn1Events = await assertProviderStreamConforms({ provider: options.provider, request: makeTurn("one") });
  const turn2Events = await assertProviderStreamConforms({ provider: options.provider, request: makeTurn("two") });
  const u1 = turn1Events.find((e) => e.type === "usage")?.usage;
  const u2 = turn2Events.find((e) => e.type === "usage")?.usage;
  console.info(
    `[${options.provider.id} live] chat-route cache probe: turn1 {read:${u1?.cacheReadTokens ?? 0}, write:${u1?.cacheWriteTokens ?? 0}} ` +
      `turn2 {read:${u2?.cacheReadTokens ?? 0}, write:${u2?.cacheWriteTokens ?? 0}}`,
  );
  assert.ok((u2?.cacheReadTokens ?? 0) > 0, "Warm chat-route replay reported no cached tokens");
  assert.ok((u2?.inputTokens ?? 0) >= (u2?.cacheReadTokens ?? 0), "inputTokens must be >= cacheReadTokens");
  assertNoSecretLeak(turn1Events, options.secrets);
  assertNoSecretLeak(turn2Events, options.secrets);
  return { turn1Usage: u1, turn2Usage: u2 };
}

// ── System One Shared Scenario Executors ────────────────────────────────────

export async function systemOneScenarioDecision(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly secrets: readonly string[];
  readonly prompt?: string;
  readonly schema?: JsonObject;
}): Promise<{ readonly decision: unknown; readonly usage?: Usage }> {
  const schema = options.schema ?? {
    type: "object",
    properties: { risky: { type: "boolean", description: "Would running this destroy data or leak secrets?" } },
  };
  const req: ProviderRequest = {
    model: options.model,
    messages: [{ role: "user", content: [{ type: "text", text: options.prompt ?? "rm -rf ./build" }] }],
    options: {
      structuredOutput: {
        name: "decision",
        schema,
      },
    },
  };
  const events = await collectProviderEvents(options.provider, req);
  const terminal = events.at(-1);
  assert.ok(
    terminal && terminal.type === "done",
    `System One decision request failed: ${terminal?.type === "error" ? terminal.error.message : "no done event"}`,
  );
  const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
  const parsed = JSON.parse(text);
  assert.ok(typeof parsed === "object" && parsed !== null, "Rendered decision must be schema-valid JSON");
  const usage = events.find((e) => e.type === "usage")?.usage;
  if (usage) {
    console.info(`[${options.provider.id} live] System One decision usage: ${JSON.stringify(usage)}`);
  }
  assertNoSecretLeak(events, options.secrets);
  return { decision: parsed, usage };
}

export async function systemOneScenarioToolsRejected(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly secrets: readonly string[];
}): Promise<void> {
  const req: ProviderRequest = {
    model: options.model,
    messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
    tools: [LIVE_WEATHER_TOOL],
    options: {
      structuredOutput: {
        name: "decision",
        schema: { type: "object", properties: { risky: { type: "boolean" } } },
      },
    },
  };
  const events = await collectProviderEvents(options.provider, req);
  const terminal = events.at(-1);
  assert.ok(terminal && terminal.type === "error", "Tools must be rejected for System One decision models");
  assertNoSecretLeak(events, options.secrets);
}

export async function systemOneScenarioAbort(options: { readonly provider: ModelProvider; readonly model: ModelConfig }): Promise<void> {
  await assertAbortIsObserved({
    provider: options.provider,
    request: {
      model: options.model,
      messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
      options: {
        structuredOutput: {
          name: "decision",
          schema: { type: "object", properties: { risky: { type: "boolean" } } },
        },
      },
    },
  });
}

export async function systemOneScenarioErrorResponse(options: {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
  readonly secrets: readonly string[];
}): Promise<void> {
  const badReq: ProviderRequest = {
    model: options.model,
    messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
  };
  const events = await collectProviderEvents(options.provider, badReq);
  const terminal = events.at(-1);
  assert.ok(terminal && terminal.type === "error", "Missing structuredOutput must fail on System One");
  assertNoSecretLeak(events, options.secrets);
}

// ── Programmatic Multi-Scenario Executors (for Hermetic Tests) ───────────────

export interface ProviderLiveScenarioResult {
  readonly scenario: string;
  readonly route: string;
  readonly ok: boolean;
  readonly details?: unknown;
}

export interface ProviderLiveScenariosExecutionResult {
  readonly ok: boolean;
  readonly scenarios: readonly ProviderLiveScenarioResult[];
}

export async function executeProviderLiveScenarios(
  options: ProviderLiveScenariosOptions & { readonly isHermetic?: boolean },
): Promise<ProviderLiveScenariosExecutionResult> {
  const secrets = resolveSecrets(options.secretEnv, options.secrets);
  const provider = await resolveLiveProvider(options.provider, { fetch: options.fetch, secrets });
  const results: ProviderLiveScenarioResult[] = [];

  const routeEntries: [LiveRouteName, LiveRouteInput][] = [];
  if (options.routes.native) routeEntries.push(["native", options.routes.native]);
  if (options.routes.openai) routeEntries.push(["openai", options.routes.openai]);
  if (options.routes.anthropic) routeEntries.push(["anthropic", options.routes.anthropic]);
  if (options.routes.responses) routeEntries.push(["responses", options.routes.responses]);

  for (const [routeName, routeInput] of routeEntries) {
    const { model, config } = await resolveModelConfig(provider, routeInput, routeName);

    if (!options.scenarios || options.scenarios.includes("text")) {
      const textRes = await liveScenarioTextStream({
        provider,
        model,
        route: routeName,
        secrets,
        sessionId: config.sessionId,
      });
      results.push({ scenario: "text", route: routeName, ok: true, details: textRes });
    }

    if (!options.scenarios || options.scenarios.includes("tool-loop")) {
      const toolRes = await liveScenarioToolLoop({
        provider,
        model,
        route: routeName,
        secrets,
        sessionId: config.sessionId,
      });
      results.push({ scenario: "tool-loop", route: routeName, ok: true, details: toolRes });
    }

    if (!options.scenarios || options.scenarios.includes("structured-output")) {
      const structRes = await liveScenarioStructuredOutput({
        provider,
        model,
        route: routeName,
        secrets,
        sessionId: config.sessionId,
        structuredOutput: config.structuredOutput ?? (model.capabilities?.structuredOutput === "json_schema" ? "json_schema" : undefined),
        prompt: config.structuredPrompt,
      });
      results.push({ scenario: "structured-output", route: routeName, ok: true, details: structRes });
    }

    if (!options.scenarios || options.scenarios.includes("abort")) {
      await liveScenarioAbort({
        provider,
        model,
        route: routeName,
        sessionId: config.sessionId,
      });
      results.push({ scenario: "abort", route: routeName, ok: true });
    }

    if (!options.scenarios || options.scenarios.includes("error")) {
      const errorModel = config.errorModel ? (await resolveModelConfig(provider, config.errorModel, routeName)).model : undefined;
      await liveScenarioErrorResponse({
        provider,
        model,
        route: routeName,
        secrets,
        sessionId: config.sessionId,
        errorModel,
      });
      results.push({ scenario: "error", route: routeName, ok: true });
    }

    if (!options.scenarios || options.scenarios.includes("cache")) {
      let cacheProbeModel = model;
      if (config.cacheModel) {
        const resolved = await resolveModelConfig(provider, config.cacheModel, routeName);
        cacheProbeModel = resolved.model;
      }
      const cacheRes = await liveScenarioCacheProbe({
        provider,
        model: cacheProbeModel,
        route: routeName,
        secrets,
        sessionId: config.sessionId,
        cachePrefix: config.cachePrefix,
        isHermetic: options.isHermetic,
      });
      results.push({ scenario: "cache", route: routeName, ok: true, details: cacheRes });
    }
  }

  return { ok: true, scenarios: results };
}

export interface SystemOneLiveScenarioResult {
  readonly scenario: string;
  readonly ok: boolean;
  readonly details?: unknown;
}

export interface SystemOneLiveScenariosExecutionResult {
  readonly ok: boolean;
  readonly scenarios: readonly SystemOneLiveScenarioResult[];
}

export async function executeSystemOneLiveScenarios(
  options: SystemOneLiveScenariosOptions,
): Promise<SystemOneLiveScenariosExecutionResult> {
  const secrets = resolveSecrets(options.secretEnv, options.secrets);
  const provider = await resolveLiveProvider(options.provider, { fetch: options.fetch, secrets });
  const modelConfig: ModelConfig =
    typeof options.model === "string"
      ? { provider: provider.id, model: options.model, capabilities: { structuredOutput: "json_schema", decisions: true } }
      : options.model;

  const results: SystemOneLiveScenarioResult[] = [];

  const decisionRes = await systemOneScenarioDecision({ provider, model: modelConfig, secrets });
  results.push({ scenario: "decision", ok: true, details: decisionRes });

  const decideRes = await systemOneScenarioDecide({ provider, model: modelConfig, secrets });
  results.push({ scenario: "decide", ok: true, details: decideRes });

  await systemOneScenarioToolsRejected({ provider, model: modelConfig, secrets });
  results.push({ scenario: "tools-rejected", ok: true });

  await systemOneScenarioAbort({ provider, model: modelConfig });
  results.push({ scenario: "abort", ok: true });

  await systemOneScenarioErrorResponse({ provider, model: modelConfig, secrets });
  results.push({ scenario: "error", ok: true });

  return { ok: true, scenarios: results };
}

// ── Test Runner Integration Suites ──────────────────────────────────────────

/**
 * Runs tier-1 shared live scenarios for routed chat and Anthropic provider packages.
 * Automatically skips cleanly when credentials or opt-in flags are absent.
 */
export function runProviderLiveScenarios(options: ProviderLiveScenariosOptions): LiveSuiteRegistrationResult {
  const skipReason = determineSkipReason(options);
  const suiteTitle = options.title ?? "provider tier-1 live scenarios";

  if (skipReason) {
    try {
      describe.skip(`${suiteTitle} (skipped: ${skipReason})`, () => {
        it("suite skipped without credentials", () => {});
      });
    } catch {
      // Disallow nested describe inside an existing it() runner context
    }
    return { skipped: true, reason: skipReason };
  }

  describe(suiteTitle, () => {
    let provider: ModelProvider;
    const secrets = resolveSecrets(options.secretEnv, options.secrets);

    const routeEntries: [LiveRouteName, LiveRouteInput][] = [];
    if (options.routes.native) routeEntries.push(["native", options.routes.native]);
    if (options.routes.openai) routeEntries.push(["openai", options.routes.openai]);
    if (options.routes.anthropic) routeEntries.push(["anthropic", options.routes.anthropic]);
    if (options.routes.responses) routeEntries.push(["responses", options.routes.responses]);

    for (const [routeName, routeInput] of routeEntries) {
      describe(`${routeName} route`, () => {
        let model: ModelConfig;
        let routeConfig: LiveRouteConfig;

        async function init() {
          if (!provider) {
            provider = await resolveLiveProvider(options.provider, { fetch: options.fetch, secrets });
          }
          if (!model) {
            const resolved = await resolveModelConfig(provider, routeInput, routeName);
            model = resolved.model;
            routeConfig = resolved.config;
          }
        }

        (!options.scenarios || options.scenarios.includes("text") ? it : it.skip)(
          "live_text_generation_streams_and_leaks_no_secret",
          async () => {
            await init();
            await liveScenarioTextStream({
              provider,
              model,
              route: routeName,
              secrets,
              sessionId: routeConfig.sessionId,
            });
          },
        );

        (!options.scenarios || options.scenarios.includes("tool-loop") ? it : it.skip)(
          "live_two_turn_tool_loop_with_thinking_replay",
          async () => {
            await init();
            await liveScenarioToolLoop({
              provider,
              model,
              route: routeName,
              secrets,
              sessionId: routeConfig.sessionId,
            });
          },
        );

        (!options.scenarios || options.scenarios.includes("structured-output") ? it : it.skip)("live_structured_output", async () => {
          await init();
          await liveScenarioStructuredOutput({
            provider,
            model,
            route: routeName,
            secrets,
            sessionId: routeConfig.sessionId,
            structuredOutput: routeConfig.structuredOutput,
            prompt: routeConfig.structuredPrompt,
          });
        });

        (!options.scenarios || options.scenarios.includes("abort") ? it : it.skip)(
          "live_abort_signal_is_observed_before_first_request",
          async () => {
            await init();
            await liveScenarioAbort({
              provider,
              model,
              route: routeName,
              sessionId: routeConfig.sessionId,
            });
          },
        );

        (!options.scenarios || options.scenarios.includes("error") ? it : it.skip)("live_error_response_leaks_no_secret", async () => {
          await init();
          const errorModel = routeConfig.errorModel
            ? (await resolveModelConfig(provider, routeConfig.errorModel, routeName)).model
            : undefined;
          await liveScenarioErrorResponse({
            provider,
            model,
            route: routeName,
            secrets,
            sessionId: routeConfig.sessionId,
            errorModel,
          });
        });

        (!options.scenarios || options.scenarios.includes("cache") ? it : it.skip)("live_warm_prefix_cache_probe", async () => {
          await init();
          let cacheProbeModel = model;
          if (routeConfig.cacheModel) {
            const resolved = await resolveModelConfig(provider, routeConfig.cacheModel, routeName);
            cacheProbeModel = resolved.model;
          }
          await liveScenarioCacheProbe({
            provider,
            model: cacheProbeModel,
            route: routeName,
            secrets,
            sessionId: routeConfig.sessionId,
            cachePrefix: routeConfig.cachePrefix,
          });
        });
      });
    }
  });

  return { skipped: false };
}

/**
 * Runs tier-1 shared live scenarios for System One decision model provider packages.
 * Automatically skips cleanly when credentials, opt-in flags, or servers are absent.
 */
export async function runSystemOneLiveScenarios(options: SystemOneLiveScenariosOptions): Promise<LiveSuiteRegistrationResult> {
  let skipReason = determineSkipReason(options);

  if (!skipReason && options.reachabilityCheck) {
    const baseUrl = options.baseUrl ?? "http://127.0.0.1:8000";
    const checkFn = typeof options.reachabilityCheck === "function" ? options.reachabilityCheck : checkLayaServerReachable;
    const res = await checkFn(baseUrl);
    if (!res.reachable) {
      skipReason = res.reason ?? `server is not reachable at ${baseUrl}`;
    }
  }

  const suiteTitle = options.title ?? "system-one tier-1 live scenarios";

  if (skipReason) {
    try {
      describe.skip(`${suiteTitle} (skipped: ${skipReason})`, () => {
        it("suite skipped without server or credentials", () => {});
      });
    } catch {
      // Disallow nested describe inside an existing it() runner context
    }
    return { skipped: true, reason: skipReason };
  }

  describe(suiteTitle, () => {
    let provider: ModelProvider;
    let modelConfig: ModelConfig;
    const secrets = resolveSecrets(options.secretEnv, options.secrets);

    async function init() {
      if (!provider) {
        provider = await resolveLiveProvider(options.provider, { fetch: options.fetch, secrets });
      }
      if (!modelConfig) {
        modelConfig =
          typeof options.model === "string"
            ? { provider: provider.id, model: options.model, capabilities: { structuredOutput: "json_schema", decisions: true } }
            : options.model;
      }
    }

    it("live_decision_renders_schema_valid_json_and_leaks_no_secret", async () => {
      await init();
      await systemOneScenarioDecision({ provider, model: modelConfig, secrets });
    });

    it(options.decideTestName ?? "live_decide_returns_raw_answers_for_all_question_types", async () => {
      await init();
      await systemOneScenarioDecide({ provider, model: modelConfig, secrets });
    });

    it("live_tools_rejected_before_fetch", async () => {
      await init();
      await systemOneScenarioToolsRejected({ provider, model: modelConfig, secrets });
    });

    it("live_abort_signal_is_observed_before_first_request", async () => {
      await init();
      await systemOneScenarioAbort({ provider, model: modelConfig });
    });

    it("live_error_response_leaks_no_secret", async () => {
      await init();
      await systemOneScenarioErrorResponse({ provider, model: modelConfig, secrets });
    });
  });

  return { skipped: false };
}
