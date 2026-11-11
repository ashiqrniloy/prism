// ponytail: dependency-free conformance runner for prompt-cache prefix stability.
// The runner owns the fixture provider (network-free, deterministic) and fixture
// skills; everything else in `host` is the caller's production assembly — system
// prompt, context.build handlers, tool gating, and disclosure settings.
// Throws plain Error; no test runner, no network, no credentials.

import assert from "node:assert/strict";
import { createAgent } from "../agent-session/create-agent.js";
import type {
  AgentConfig,
  JsonObject,
  Message,
  ModelProvider,
  ModelRef,
  ProviderRequest,
  RunResult,
  Session,
  Skill,
  ToolDefinition,
} from "../contracts.js";
import { providerDone, providerThinkingDelta, toolCallContent } from "../models/events.js";
import { parseModelRef } from "../models/ref.js";
import { providerPackage } from "../provider-kit/package.js";
import { createSkillRegistry } from "../skills.js";

export interface PrefixStabilityConformanceOptions {
  /**
   * The host's own agent config, minus `skills`; `model` keeps its model id but is pointed at the fixture provider:
   * the runner installs its fixture provider and fixture skill registry so the
   * scenario is deterministic and comparable across hosts.
   */
  readonly host: Omit<AgentConfig, "skills">;
  /** Two distinct skills: the fixture loads `[0]` on the first turn and `[1]` on the second. */
  readonly skills: readonly [Skill, Skill];
  /** Progressive (default) or eager disclosure for the fixture agent. */
  readonly skillsDisclosure?: "progressive" | "eager";
  /** Minimum shared byte-prefix fraction between consecutive requests. Default `0.95`. */
  readonly minContinuity?: number;
  /**
   * Which fraction gates the run: `"providerPrefix"` (default, today's behavior) asserts the
   * provider-visible prefix; `"cacheablePrefix"` asserts the same measurement with tail segments
   * removed, so a body-heavy or eager host is not failed for the tail it deliberately re-sends.
   */
  readonly assertOn?: "providerPrefix" | "cacheablePrefix";
  /** Turn inputs; defaults are fixed strings so runs are comparable across hosts. */
  readonly inputs?: readonly [string, string];
  /**
   * How many request pairs may break below `minContinuity` (default `0`, today's behavior). Use
   * `1` for an assembly that folds or evicts exactly one boundary — a host fold, a compaction,
   * a budget eviction. More resets than declared fail, and fewer fail too: the
   * fixture was supposed to invalidate the prefix, so a run that never did cannot pass vacuously.
   */
  readonly allowedResets?: number;
  /**
   * Install a runner-owned fixture tool (name constant) that returns exactly this many bytes of
   * generated text, and add a second tool call for it alongside `load_skill` in the same round, so
   * a host's own tool-result stage has one row worth folding. The payload is `"x".repeat(bytes)`,
   * never host content. Unset: the capture is byte-identical to today.
   */
  readonly foldableToolResultBytes?: number;
  /**
   * Fixture knob: each skill-load round also carries a deterministic reasoning block, so a host's
   * own stage that strips aged reasoning has real content to strip. Off by default; the block is
   * generated text, never host content.
   */
  readonly reasoningFixture?: boolean;
  /**
   * Wire mode. Serialize every captured request with the provider's own encoder (for a routed
   * provider, its `encode` method; the request's `model` is the fixture's, so the callback must
   * swap in the real `ModelConfig`) and assert that consecutive bodies keep their cacheable
   * segments: `tools` and `system` equal, and every message below the earlier request's last index
   * byte-equal. Only `cache_control` markers may move. Unset: no wire check.
   */
  readonly encode?: (request: ProviderRequest) => Promise<JsonObject>;
  /** Splits an encoded body into `tools` / `system` / `messages`. Default: `defaultWireSegments` (Anthropic-shaped when the body has a top-level `system`, otherwise OpenAI Chat). */
  readonly segments?: (body: JsonObject) => WireSegments;
  /**
   * User turns the fixture runs (default `2`, two provider requests each). Turns beyond the two
   * skill loads call a runner-owned no-op tool, so `turns: 5` is a ten-request tool loop.
   */
  readonly turns?: number;
}

/** The three segments an upstream prompt cache keys on. */
export interface WireSegments {
  readonly tools?: unknown;
  readonly system?: unknown;
  readonly messages: readonly unknown[];
}

export interface PrefixStabilityConformanceResult {
  /** Provider requests captured by the fixture (two per turn: skill load, then completion). */
  readonly requests: number;
  /** Lowest shared-prefix fraction observed across consecutive captured requests. */
  readonly minContinuity: number;
  /**
   * The same lowest fraction with the session's tail segments removed from both requests of each
   * pair — the provider-visible prefix the cache can actually keep paying for. Equals
   * `minContinuity` when no captured request carried a tail segment.
   */
  readonly cacheableContinuity: number;
  /**
   * 1-based indexes of the captured requests whose asserted prefix broke below `minContinuity`
   * (the later request of each pair), in ascending order — where the assembly invalidated the
   * prefix instead of appending. Empty when every gap stayed above the minimum.
   */
  readonly resets: readonly number[];
  /**
   * One row per `resets` entry, same order. `fraction` is the metric `assertOn` selected;
   * `cacheableFraction` is the tail-excluded fraction for that pair. Empty when `resets` is.
   */
  readonly resetDetails: readonly PrefixStabilityResetDetail[];
  /** Consecutive encoded pairs that passed the wire check; `0` when `encode` was not given. */
  readonly wirePairs: number;
}

export interface ScorePrefixStabilityOptions {
  /** Session tail map. Omitted or unmatched: both fractions stay equal — never a fabricated `1`. */
  readonly tailSegments?: ReadonlyMap<string, Message>;
  /** Minimum shared byte-prefix fraction. Default `0.95`. Selects which pairs land in `resets`. */
  readonly minContinuity?: number;
  /**
   * Which fraction `resets` follows. Default `"providerPrefix"` (the wire prefix). The runner
   * passes its own `assertOn` so fixture resets stay on the selected metric without a second pass.
   */
  readonly assertOn?: "providerPrefix" | "cacheablePrefix";
}

/** One reset: index plus both fractions. Numbers only — no message text. */
export interface PrefixStabilityResetDetail {
  /** 1-based index of the later request in the pair. */
  readonly request: number;
  /** Fraction of the metric `assertOn` selected for the pair. Default: provider-visible. */
  readonly fraction: number;
  /** The same pair with tail segments removed. */
  readonly cacheableFraction: number;
}

export interface PrefixStabilitySample {
  readonly minContinuity: number;
  readonly cacheableContinuity: number;
  readonly resets: readonly number[];
  readonly resetDetails: readonly PrefixStabilityResetDetail[];
}

/**
 * Score an already-captured request list. One pass, no session, no provider call.
 * A wrong `tailSegments` map yields a wrong number, not a throw.
 */
export function scorePrefixStability(requests: readonly ProviderRequest[], options?: ScorePrefixStabilityOptions): PrefixStabilitySample {
  const first = requests[0];
  if (requests.length < 2 || first === undefined) {
    throw new Error(`scorePrefixStability needs at least 2 captured requests, got ${requests.length}`);
  }
  const minContinuity = options?.minContinuity ?? 0.95;
  const assertOn = options?.assertOn ?? "providerPrefix";
  const isTail = tailClassifier(options?.tailSegments ?? new Map());
  let observed = 1;
  let cacheableObserved = 1;
  const resetDetails: PrefixStabilityResetDetail[] = [];
  let previous = measureRequest(first, isTail);
  for (let index = 1; index < requests.length; index += 1) {
    const current = requests[index];
    if (current === undefined) continue;
    const next = measureRequest(current, isTail);
    const fraction = sharedPrefixFraction(previous.providerPrefix, next.providerPrefix);
    const cacheableFraction = sharedPrefixFraction(previous.cacheablePrefix, next.cacheablePrefix);
    observed = Math.min(observed, fraction);
    cacheableObserved = Math.min(cacheableObserved, cacheableFraction);
    const measured = assertOn === "cacheablePrefix" ? cacheableFraction : fraction;
    if (measured < minContinuity) resetDetails.push(projectResetDetail(index + 1, fraction, cacheableFraction, assertOn));
    previous = next;
  }
  return {
    minContinuity: observed,
    cacheableContinuity: cacheableObserved,
    resets: resetDetails.map((gap) => gap.request),
    resetDetails,
  };
}

/**
 * Drive a real session through two staggered skill loads and assert that each
 * provider request keeps a byte-identical leading prefix (messages **and** tool
 * schemas) with its predecessor. Progressive disclosure returns each loaded body
 * in its tool result, so the shared prefix stays intact; a host that rewrites the
 * context block, the skill catalog, or any leading message per request fails with
 * the offending request pair and the measured fraction.
 * Reports both the provider-visible fraction and the same fraction with the
 * session's tail segments removed; `assertOn` picks which one gates the run.
 * A gap below the minimum is collected as a reset instead of failing in the
 * loop, so `allowedResets` can permit the one boundary an assembly folds at.
 */
export async function runPrefixStabilityConformance(options: PrefixStabilityConformanceOptions): Promise<PrefixStabilityConformanceResult> {
  const { host, skills } = options;
  const minContinuity = options.minContinuity ?? 0.95;
  const [first, second] = skills;
  assert.notEqual(first.name, second.name, "prefix stability conformance needs two distinct skills");
  const bodies: string[] = [];
  for (const skill of skills) {
    const instructions = skill.instructions;
    assert.ok(
      typeof instructions === "string" && instructions.length > 0,
      `prefix stability conformance skill ${skill.name} needs non-empty instructions`,
    );
    bodies.push(instructions);
  }

  const requests: ProviderRequest[] = [];
  const foldableBytes = options.foldableToolResultBytes;
  assert.ok(
    foldableBytes === undefined || (Number.isSafeInteger(foldableBytes) && foldableBytes > 0),
    "prefix stability conformance foldableToolResultBytes must be a positive safe integer",
  );
  const turns = options.turns ?? 2;
  assert.ok(Number.isSafeInteger(turns) && turns >= 2, "prefix stability conformance turns must be a safe integer of at least 2");
  const registry = createSkillRegistry([...skills]);
  const hostTools: readonly ToolDefinition[] = host.tools?.add ?? [];
  const fixture = fixtureProvider(requests, [first.name, second.name], options.reasoningFixture === true, foldableBytes !== undefined);
  const agent = await createAgent({
    ...host,
    skills: { add: registry.list(), disclosure: options.skillsDisclosure },
    tools: {
      add: [
        ...hostTools,
        ...(foldableBytes === undefined ? [] : [createFoldableToolResultTool(foldableBytes)]),
        ...(turns > 2 ? [createPingTool()] : []),
      ],
    },
    model: { ...parseModelRef(host.model as ModelRef), provider: fixture.id },
    packages: [...(host.packages ?? []), providerPackage("prefix-stability-fixture", [fixture])],
  });
  const session = (await agent.session()) as Session & { readonly tailSegments: ReadonlyMap<string, Message> };
  const [firstInput, secondInput] = options.inputs ?? ["Prefix stability turn one", "Prefix stability turn two"];
  const runOptions = { limits: { maxToolRounds: 1 } } as const;
  // A failed run resolves (it does not throw) and captures nothing, so an unchecked run would surface
  // as a confusing "0 provider requests". Name the run's own error instead.
  assertRunSucceeded(await session.run(firstInput, runOptions), "first");
  assertRunSucceeded(await session.run(secondInput, runOptions), "second");
  for (let turn = 3; turn <= turns; turn += 1) {
    assertRunSucceeded(await session.run(`Prefix stability turn ${turn}`, runOptions), String(turn));
  }

  assert.equal(
    requests.length,
    turns * 2,
    `prefix stability conformance expected ${turns * 2} provider requests (2 per turn), captured ${requests.length}`,
  );
  // The session's own map holds the exact `Message` objects `appendTailSegment` allocated, so the
  // classification is exact rather than a heuristic over host-authored content. (`tailSegments` is
  // runtime-session state, not part of the public `Session` contract, hence the narrow above.)
  const assertOn = options.assertOn ?? "providerPrefix";
  // One measurement. The assertion below reads the sample; it does not serialize again.
  const sample = scorePrefixStability(requests, { tailSegments: session.tailSegments, minContinuity, assertOn });
  // Guard against a vacuous pass: both bodies must have been disclosed by the end.
  const last = (requests.at(-1)?.messages ?? []).map((message) => JSON.stringify(message)).join("\n");
  for (const [index, skill] of skills.entries()) {
    const body = bodies[index] ?? "";
    assert.ok(
      last.includes(body),
      `prefix stability conformance: skill ${skill.name} body never reached the provider request — progressive disclosure did not expand it`,
    );
    if ((options.skillsDisclosure ?? "progressive") === "progressive") {
      const hasLoadCall = requests.some((request) =>
        request.messages.some((message) => message.content.some((block) => block.type === "tool_call" && block.name === "load_skill")),
      );
      if (hasLoadCall) {
        assert.ok(
          requests.some((request) => request.messages.some((message) => message.role === "tool" && JSON.stringify(message).includes(body))),
          `prefix stability conformance: skill ${skill.name} body did not ride in its tool result`,
        );
      }
    }
  }
  if ((options.skillsDisclosure ?? "progressive") === "progressive") {
    assert.deepEqual(
      [...session.tailSegments.keys()].filter((key) => key.startsWith("skill:")),
      [],
      "prefix stability conformance: a progressive loaded body was re-appended as a tail segment",
    );
  }

  const allowedResets = options.allowedResets ?? 0;
  assert.ok(
    Number.isSafeInteger(allowedResets) && allowedResets >= 0,
    "prefix stability conformance allowedResets must be a non-negative safe integer",
  );
  const observed = sample.minContinuity;
  const cacheableObserved = sample.cacheableContinuity;
  const gaps = sample.resetDetails;
  const resets = sample.resets;
  const measuredLabel = assertOn === "cacheablePrefix" ? "previous cacheable prefix (tail segments excluded)" : "previous provider prefix";
  const minimum = (minContinuity * 100).toFixed(1);
  const observedResets = `resets ${formatResets(resets)} of ${requests.length - 1} request pairs`;
  const firstGap = gaps[0];
  if (firstGap !== undefined && gaps.length > allowedResets) {
    const measured = firstGap.fraction;
    assert.fail(
      `prefix stability conformance: request ${firstGap.request - 1} → ${firstGap.request} kept ${(measured * 100).toFixed(1)}% of the ${measuredLabel} ` +
        `(minimum ${minimum}%), and ${gaps.length} pair(s) broke below it (${observedResets}, allowedResets ${allowedResets}). ` +
        "Late skill bodies must append after the stable prefix; recomposed context, an in-place skill-catalog rewrite, or any leading-message mutation invalidates it. " +
        "Pass allowedResets for the fold, compaction, or eviction the assembly performs per run, or fix the assembly so every other gap stays byte-stable.",
    );
  }
  if (gaps.length < allowedResets) {
    assert.fail(
      `prefix stability conformance: allowedResets is ${allowedResets} but only ${gaps.length} pair(s) broke below the minimum (${minimum}% of the ${measuredLabel}); ${observedResets}. ` +
        "The fixture was supposed to invalidate the prefix at those boundaries — drop allowedResets for an append-only assembly, or check the fold trigger or eviction condition actually fired.",
    );
  }
  const wirePairs = options.encode === undefined ? 0 : await assertWirePrefixStable(requests, options.encode, options.segments);
  return {
    requests: requests.length,
    minContinuity: observed,
    cacheableContinuity: cacheableObserved,
    resets,
    resetDetails: sample.resetDetails,
    wirePairs,
  };
}

/** Anthropic Messages body: `tools`, top-level `system`, `messages`. */
export function anthropicSegments(body: JsonObject): WireSegments {
  return { tools: body.tools, system: body.system, messages: Array.isArray(body.messages) ? body.messages : [] };
}

/** OpenAI Chat body: `tools`; the leading `system` / `developer` messages are the system segment. */
export function openAIChatSegments(body: JsonObject): WireSegments {
  const all = Array.isArray(body.messages) ? body.messages : [];
  let lead = 0;
  while (lead < all.length && isSystemRole((all[lead] as JsonObject | undefined)?.role)) lead += 1;
  return { tools: body.tools, system: all.slice(0, lead), messages: all.slice(lead) };
}

/** A body with a top-level `system` is Anthropic-shaped; everything else is read as OpenAI Chat. */
export function defaultWireSegments(body: JsonObject): WireSegments {
  return "system" in body ? anthropicSegments(body) : openAIChatSegments(body);
}

function isSystemRole(role: unknown): boolean {
  return role === "system" || role === "developer";
}

/**
 * Assert that `next` keeps the cacheable segments of `previous`: `tools` and `system` equal, and every
 * message below the earlier request's last index byte-equal once `cache_control` markers are removed
 * (a marker may move; nothing else may). Throws naming the segment, the index and the first
 * differing byte offset of the two serialized values.
 */
export function assertWireSegmentsStable(previous: WireSegments, next: WireSegments, label = "wire prefix"): void {
  assertSegmentEqual("tools", undefined, previous.tools, next.tools, label);
  assertSegmentEqual("system", undefined, previous.system, next.system, label);
  const lastIndex = previous.messages.length - 1;
  if (next.messages.length < lastIndex) {
    assert.fail(
      `${label}: messages shrank from ${previous.messages.length} to ${next.messages.length}; earlier messages cannot stay byte-equal`,
    );
  }
  for (let index = 0; index < lastIndex; index += 1) {
    assertSegmentEqual("messages", index, stripCacheMarkers(previous.messages[index]), stripCacheMarkers(next.messages[index]), label);
  }
}

function assertSegmentEqual(segment: string, index: number | undefined, before: unknown, after: unknown, label: string): void {
  const left = JSON.stringify(before) ?? "undefined";
  const right = JSON.stringify(after) ?? "undefined";
  if (left === right) return;
  const offset = firstDifferingByte(left, right);
  assert.fail(
    `${label}: segment '${segment}'${index === undefined ? "" : ` index ${index}`} changed between consecutive requests ` +
      `(first differing byte ${offset} of ${Buffer.byteLength(left)} → ${Buffer.byteLength(right)}). ` +
      "The upstream prefix cache keys on these bytes; keep earlier segments byte-stable and append.",
  );
}

function firstDifferingByte(left: string, right: string): number {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a[at] === b[at]) at += 1;
  return at;
}

/** Deep copy without `cache_control` keys, so a moved marker is not a difference. */
function stripCacheMarkers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCacheMarkers);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) if (key !== "cache_control") out[key] = stripCacheMarkers(entry);
    return out;
  }
  return value;
}

/** Encode every captured request with the provider's encoder and check each consecutive pair. Returns the pair count. */
async function assertWirePrefixStable(
  requests: readonly ProviderRequest[],
  encode: (request: ProviderRequest) => Promise<JsonObject>,
  segments: ((body: JsonObject) => WireSegments) | undefined,
): Promise<number> {
  const split = segments ?? defaultWireSegments;
  const bodies: WireSegments[] = [];
  for (const request of requests) bodies.push(split(await encode(request)));
  for (let index = 1; index < bodies.length; index += 1) {
    assertWireSegmentsStable(bodies[index - 1]!, bodies[index]!, `prefix stability conformance (wire): request ${index} → ${index + 1}`);
  }
  return bodies.length - 1;
}

/** One gap row. `fraction` is the metric the caller selected; `cacheableFraction` stays the tail-excluded pair. */
function projectResetDetail(
  request: number,
  providerFraction: number,
  cacheableFraction: number,
  assertOn: "providerPrefix" | "cacheablePrefix",
): PrefixStabilityResetDetail {
  return {
    request,
    fraction: assertOn === "cacheablePrefix" ? cacheableFraction : providerFraction,
    cacheableFraction,
  };
}

/** A fixture run must succeed; otherwise the capture is empty and the measurement below is vacuous. */
function assertRunSucceeded(result: RunResult, which: string): void {
  assert.equal(
    result.status,
    "completed",
    `prefix stability conformance: the ${which} fixture run did not succeed (${result.status})` +
      (result.error === undefined ? "" : `: ${result.error.message}`),
  );
}

/**
 * Deterministic reasoning block the fixture provider emits before each skill load when
 * `reasoningFixture` is set. Sized to be a real fraction of the request so a host stage that
 * strips aged reasoning has something to strip and the resulting fold is visible in the measured
 * prefix.
 */
const FIXTURE_THINKING =
  "Prefix-stability fixture reasoning: the harness measures a byte-shared provider prefix, so this block exists only to give the attention-compiler thinking stage deterministic content to strip. ".repeat(
    17,
  );

/** Runner-owned fixture tool (plan 110 Task 4): the tool-result stage needs a row worth stubbing. */
const PREFIX_STABILITY_BULK_TOOL_NAME = "prefix_stability_bulk" as const;

function createFoldableToolResultTool(bytes: number): ToolDefinition {
  return {
    name: PREFIX_STABILITY_BULK_TOOL_NAME,
    description: "Deterministic bulk payload for the tool-result fold fixture.",
    parameters: { type: "object", properties: {} } as JsonObject,
    execute(_args, context) {
      const text = "x".repeat(bytes);
      return { toolCallId: context.toolCallId, name: PREFIX_STABILITY_BULK_TOOL_NAME, value: text, content: [{ type: "text", text }] };
    },
  };
}

/** Runner-owned no-op tool for the turns beyond the two skill loads. */
const PREFIX_STABILITY_PING_TOOL_NAME = "prefix_stability_ping" as const;

function createPingTool(): ToolDefinition {
  return {
    name: PREFIX_STABILITY_PING_TOOL_NAME,
    description: "Deterministic no-op for the extra fixture turns.",
    parameters: { type: "object", properties: {} } as JsonObject,
    execute(_args, context) {
      return {
        toolCallId: context.toolCallId,
        name: PREFIX_STABILITY_PING_TOOL_NAME,
        value: "pong",
        content: [{ type: "text", text: "pong" }],
      };
    },
  };
}

/**
 * Fixture provider: turn 1 loads `skillNames[0]`, turn 2 loads `skillNames[1]`, everything else
 * completes. With `reasoning` each skill-load round also carries a thinking block, so a host stage
 * that strips aged reasoning has real content to fold. With `bulk` the same round also calls the
 * runner-owned bulk tool, so a tool-result stage has a foldable row.
 */
function fixtureProvider(requests: ProviderRequest[], skillNames: readonly string[], reasoning: boolean, bulk: boolean): ModelProvider {
  let call = 0;
  return {
    id: "prefix-stability-fixture",
    async *generate(request) {
      requests.push(request);
      const index = call;
      call += 1;
      const skillName = skillNames[index >> 1];
      if (index % 2 === 0 && skillName === undefined) {
        if (reasoning) yield providerThinkingDelta(FIXTURE_THINKING);
        yield { type: "tool_call" as const, call: toolCallContent(`prefix-stability-${index}`, PREFIX_STABILITY_PING_TOOL_NAME, {}) };
        return;
      }
      if (index % 2 === 0 && skillName !== undefined) {
        if (reasoning) yield providerThinkingDelta(FIXTURE_THINKING);
        yield { type: "tool_call" as const, call: toolCallContent(`prefix-stability-${index}`, "load_skill", { name: skillName }) };
        if (bulk) {
          yield {
            type: "tool_call" as const,
            call: toolCallContent(`prefix-stability-bulk-${index}`, PREFIX_STABILITY_BULK_TOOL_NAME, {}),
          };
        }
        return;
      }
      yield providerDone();
    },
  };
}

/** Both metrics for one captured request: the provider-visible bytes and those bytes minus tail segments. */
interface MeasuredRequest {
  /** Tool schemas plus every message sent on the wire. */
  readonly providerPrefix: string;
  /** The same payload with tail segments removed; equals `providerPrefix` when none matched. */
  readonly cacheablePrefix: string;
}

/**
 * Classifies a captured message as a tail segment: by object identity first (the default builder
 * passes the session's own `Message` objects through), then by serialized equality for builders
 * that clone messages. Takes the pre-serialized fragment so each message is serialized once.
 */
function tailClassifier(tailSegments: ReadonlyMap<string, Message>): (message: Message, fragment: string) => boolean {
  const identities = new Set(tailSegments.values());
  const values = new Set([...identities].map((message) => JSON.stringify(message)));
  return (message, fragment) => identities.has(message) || values.has(fragment);
}

/**
 * Provider-visible payload only — messages plus the tool schema fields sent on the wire — measured
 * twice: whole, and with tail segments dropped. One JSON fragment per message/tool so a structural
 * array boundary never reads as a byte divergence: an appended message list stays an exact prefix
 * of the next request.
 */
function measureRequest(request: ProviderRequest, isTail: (message: Message, fragment: string) => boolean): MeasuredRequest {
  const toolParts = (request.tools ?? []).map((tool) =>
    JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }),
  );
  const providerParts: string[] = [...toolParts];
  const cacheableParts: string[] = [...toolParts];
  for (const message of request.messages) {
    const fragment = JSON.stringify(message);
    providerParts.push(fragment);
    if (!isTail(message, fragment)) cacheableParts.push(fragment);
  }
  return { providerPrefix: providerParts.join("\n"), cacheablePrefix: cacheableParts.join("\n") };
}

/** Bracket form for reset lists, e.g. `[3]` or `[3, 4]`. */
function formatResets(resets: readonly number[]): string {
  return `[${resets.join(", ")}]`;
}

/** Byte-shared prefix as a fraction of the previous request, so a shrink is a cache miss. */
function sharedPrefixFraction(previous: string, next: string): number {
  const before = Buffer.from(previous, "utf8");
  const after = Buffer.from(next, "utf8");
  if (before.length === 0) return 1;
  const limit = Math.min(before.length, after.length);
  let shared = 0;
  while (shared < limit && before[shared] === after[shared]) shared += 1;
  return shared / before.length;
}
