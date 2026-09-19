// ponytail: dependency-free conformance runner for prompt-cache prefix stability.
// The runner owns the fixture provider (network-free, deterministic) and fixture
// skills; everything else in `host` is the caller's production assembly — system
// prompt, context providers, prompt builder, middleware, disclosure settings.
// Throws plain Error; no test runner, no network, no credentials.

import assert from "node:assert/strict";
import type { AgentConfig, AIProvider, ProviderRequest, Skill, ToolDefinition } from "../contracts.js";
import { createAgent } from "../agent-session/create-agent.js";
import { providerDone, toolCallContent } from "../provider-events.js";
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
  /** Turn inputs; defaults are fixed strings so runs are comparable across hosts. */
  readonly inputs?: readonly [string, string];
}

export interface PrefixStabilityConformanceResult {
  /** Provider requests captured by the fixture (two per turn: skill load, then completion). */
  readonly requests: number;
  /** Lowest shared-prefix fraction observed across consecutive captured requests. */
  readonly minContinuity: number;
}

/**
 * Drive a real session through two staggered skill loads and assert that each
 * provider request keeps a byte-identical leading prefix (messages **and** tool
 * schemas) with its predecessor. Progressive disclosure appends a loaded body
 * after the stable prefix, so the shared prefix stays intact; a host that
 * rewrites the context block, the skill catalog, or any leading message per
 * request fails with the offending request pair and the measured fraction.
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
    provider: fixtureProvider(requests, [first.name, second.name]),
  });
  const session = agent.createSession();
  const [firstInput, secondInput] = options.inputs ?? ["Prefix stability turn one", "Prefix stability turn two"];
  const runOptions = { activeSkills: [first.name, second.name], limits: { maxToolRounds: 1 } } as const;
  await session.run(firstInput, runOptions);
  await session.run(secondInput, runOptions);

  assert.equal(
    requests.length,
    4,
    `prefix stability conformance expected 4 provider requests (2 per staggered turn), captured ${requests.length}`,
  );
  const serialized = requests.map(serializeRequest);
  // Guard against a vacuous pass: both bodies must have been disclosed by the end.
  const last = serialized.at(-1) ?? "";
  for (const [index, skill] of skills.entries()) {
    assert.ok(
      last.includes(bodies[index] ?? ""),
      `prefix stability conformance: skill ${skill.name} body never reached the provider request — progressive disclosure did not expand it`,
    );
  }

  let observed = 1;
  let previous = serialized.at(0) ?? "";
  for (let index = 1; index < serialized.length; index += 1) {
    const next = serialized[index] ?? "";
    const fraction = sharedPrefixFraction(previous, next);
    observed = Math.min(observed, fraction);
    assert.ok(
      fraction >= minContinuity,
      `prefix stability conformance: request ${index} → ${index + 1} kept ${(fraction * 100).toFixed(1)}% of the previous provider prefix ` +
        `(minimum ${(minContinuity * 100).toFixed(1)}%). Late skill bodies must append after the stable prefix; ` +
        "recomposed context, an in-place skill-catalog rewrite, or any leading-message mutation invalidates it.",
    );
    previous = next;
  }
  return { requests: serialized.length, minContinuity: observed };
}

/** Fixture provider: turn 1 loads `skillNames[0]`, turn 2 loads `skillNames[1]`, everything else completes. */
function fixtureProvider(requests: ProviderRequest[], skillNames: readonly string[]): AIProvider {
  let call = 0;
  return {
    id: "prefix-stability-fixture",
    async *generate(request) {
      requests.push(request);
      const index = call;
      call += 1;
      const skillName = skillNames[index >> 1];
      if (index % 2 === 0 && skillName !== undefined) {
        yield { type: "tool_call" as const, call: toolCallContent(`prefix-stability-${index}`, "load_skill", { name: skillName }) };
        return;
      }
      yield providerDone();
    },
  };
}

/** Provider-visible payload only: messages plus the tool schema fields sent on the wire. */
function serializeRequest(request: ProviderRequest): string {
  // One JSON fragment per message/tool so a structural array boundary never reads as a byte
  // divergence: an appended message list stays an exact prefix of the next request.
  const parts = [
    ...(request.tools ?? []).map((tool) => JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    ...request.messages.map((message) => JSON.stringify(message)),
  ];
  return parts.join("\n");
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
