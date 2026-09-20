// ponytail: dependency-free conformance runner for prompt-cache prefix stability.
// The runner owns the fixture provider (network-free, deterministic) and fixture
// skills; everything else in `host` is the caller's production assembly — system
// prompt, context providers, prompt builder, middleware, disclosure settings.
// Throws plain Error; no test runner, no network, no credentials.

import assert from "node:assert/strict";
import { createAgent } from "../agent-session/create-agent.js";
import type { AgentConfig, AgentSession, AIProvider, Message, ProviderRequest, Skill, ToolDefinition } from "../contracts.js";
import { providerDone, providerThinkingDelta, toolCallContent } from "../provider-events.js";
import { createLoadSkillTool } from "../skill-load.js";
import { createSkillRegistry } from "../skills.js";

export interface PrefixStabilityConformanceOptions {
  /**
   * The host's own agent config, minus `provider`, `providerSource`, and `skills`:
   * the runner installs its fixture provider and fixture skill registry so the
   * scenario is deterministic and comparable across hosts.
   */
  readonly host: Omit<AgentConfig, "provider" | "providerSource" | "skills">;
  /** Two distinct skills: the fixture loads `[0]` on the first turn and `[1]` on the second. */
  readonly skills: readonly [Skill, Skill];
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
   * `1` for an assembly that folds or evicts exactly one boundary — an attention-compiler fold,
   * a compaction, a budget eviction. More resets than declared fail, and fewer fail too: the
   * fixture was supposed to invalidate the prefix, so a run that never did cannot pass vacuously.
   */
  readonly allowedResets?: number;
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
}

/**
 * Drive a real session through two staggered skill loads and assert that each
 * provider request keeps a byte-identical leading prefix (messages **and** tool
 * schemas) with its predecessor. Progressive disclosure appends a loaded body
 * after the stable prefix, so the shared prefix stays intact; a host that
 * rewrites the context block, the skill catalog, or any leading message per
 * request fails with the offending request pair and the measured fraction.
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
  const registry = createSkillRegistry([...skills]);
  const hostTools: readonly ToolDefinition[] = host.tools && "list" in host.tools ? host.tools.list() : (host.tools ?? []);
  const agent = createAgent({
    ...host,
    skills: registry,
    tools: [...hostTools, createLoadSkillTool({ registry })],
    provider: fixtureProvider(
      requests,
      [first.name, second.name],
      host.attentionCompiler === true || typeof host.attentionCompiler === "object",
    ),
  });
  const session = agent.createSession() as AgentSession & { readonly tailSegments: ReadonlyMap<string, Message> };
  const [firstInput, secondInput] = options.inputs ?? ["Prefix stability turn one", "Prefix stability turn two"];
  const runOptions = { activeSkills: [first.name, second.name], limits: { maxToolRounds: 1 } } as const;
  await session.run(firstInput, runOptions);
  await session.run(secondInput, runOptions);

  assert.equal(
    requests.length,
    4,
    `prefix stability conformance expected 4 provider requests (2 per staggered turn), captured ${requests.length}`,
  );
  // The session's own map holds the exact `Message` objects `appendTailSegment` allocated, so the
  // classification is exact rather than a heuristic over host-authored content. (`tailSegments` is
  // runtime-session state, not part of the public `AgentSession` contract, hence the narrow above.)
  const isTail = tailClassifier(session.tailSegments);
  const captured = requests.map((request) => measureRequest(request, isTail));
  // Guard against a vacuous pass: both bodies must have been disclosed by the end.
  const last = captured.at(-1)?.providerPrefix ?? "";
  for (const [index, skill] of skills.entries()) {
    assert.ok(
      last.includes(bodies[index] ?? ""),
      `prefix stability conformance: skill ${skill.name} body never reached the provider request — progressive disclosure did not expand it`,
    );
  }

  const assertOn = options.assertOn ?? "providerPrefix";
  const allowedResets = options.allowedResets ?? 0;
  assert.ok(
    Number.isSafeInteger(allowedResets) && allowedResets >= 0,
    "prefix stability conformance allowedResets must be a non-negative safe integer",
  );
  let observed = 1;
  let cacheableObserved = 1;
  let previous = captured.at(0) ?? { providerPrefix: "", cacheablePrefix: "" };
  // Collect every gap first: an allowed reset must not be hidden by a later assert, and the
  // vacuity check needs the whole list to prove the fixture folded exactly as declared.
  const gaps: Array<{ readonly request: number; readonly fraction: number; readonly cacheableFraction: number }> = [];
  for (let index = 1; index < captured.length; index += 1) {
    const next = captured[index] ?? previous;
    const fraction = sharedPrefixFraction(previous.providerPrefix, next.providerPrefix);
    const cacheableFraction = sharedPrefixFraction(previous.cacheablePrefix, next.cacheablePrefix);
    observed = Math.min(observed, fraction);
    cacheableObserved = Math.min(cacheableObserved, cacheableFraction);
    const measured = assertOn === "cacheablePrefix" ? cacheableFraction : fraction;
    if (measured < minContinuity) gaps.push({ request: index + 1, fraction, cacheableFraction });
    previous = next;
  }

  const resets = gaps.map((gap) => gap.request);
  const measuredLabel = assertOn === "cacheablePrefix" ? "previous cacheable prefix (tail segments excluded)" : "previous provider prefix";
  const minimum = (minContinuity * 100).toFixed(1);
  const observedResets = `resets ${formatResets(resets)} of ${captured.length - 1} request pairs`;
  const firstGap = gaps[0];
  if (firstGap !== undefined && gaps.length > allowedResets) {
    const measured = assertOn === "cacheablePrefix" ? firstGap.cacheableFraction : firstGap.fraction;
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
  return { requests: captured.length, minContinuity: observed, cacheableContinuity: cacheableObserved, resets };
}

/**
 * Deterministic reasoning block the fixture provider emits before each skill load when the host
 * runs an attention compiler. Sized to be a real fraction of the request so the compiler's
 * thinking stage (`thinkingKeepTurns`) has something to strip and the resulting fold is visible
 * in the measured prefix.
 */
const FIXTURE_THINKING =
  "Prefix-stability fixture reasoning: the harness measures a byte-shared provider prefix, so this block exists only to give the attention-compiler thinking stage deterministic content to strip. ".repeat(
    17,
  );

/**
 * Fixture provider: turn 1 loads `skillNames[0]`, turn 2 loads `skillNames[1]`, everything else
 * completes. With `reasoning` (the host runs an attention compiler) each skill-load round also
 * carries a thinking block, so the compiler's thinking stage has real content to fold.
 */
function fixtureProvider(requests: ProviderRequest[], skillNames: readonly string[], reasoning: boolean): AIProvider {
  let call = 0;
  return {
    id: "prefix-stability-fixture",
    async *generate(request) {
      requests.push(request);
      const index = call;
      call += 1;
      const skillName = skillNames[index >> 1];
      if (index % 2 === 0 && skillName !== undefined) {
        if (reasoning) yield providerThinkingDelta(FIXTURE_THINKING);
        yield { type: "tool_call" as const, call: toolCallContent(`prefix-stability-${index}`, "load_skill", { name: skillName }) };
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
