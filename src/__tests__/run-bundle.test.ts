import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { agentFingerprint, createAgent, createMemoryCheckpointStore, type SessionStore, snapshotRunBundle } from "../index.js";

const model = { provider: "mock", model: "mock" };

function agentWith(overrides: Record<string, unknown> = {}) {
  return createAgent({
    model,
    instructions: "Be terse.",
    systemPrompt: [{ id: "house-style", text: "Answer in the host's voice." }],
    tools: [
      {
        name: "search",
        description: "Search secrets users pasted",
        parameters: { type: "object", properties: { q: { type: "string" } } },
        execute: () => ({}),
      },
      { name: "read", exclusive: true, parameters: { type: "object", required: ["b", "a"] }, execute: () => ({}) },
    ],
    skills: [{ name: "research", instructions: "Plan first.", toolNames: ["search"] }],
    guardrails: { output: [{ name: "no-secrets", stage: "output", revision: "3", evaluate: () => ({ action: "allow" }) }] },
    limits: { maxTurns: 8 },
    thinkingLevel: "medium",
    ...overrides,
  } as unknown as Parameters<typeof createAgent>[0]);
}

describe("snapshotRunBundle", () => {
  it("is byte-stable for identical configuration and moves for every listed contribution", () => {
    const baseline = snapshotRunBundle({ agent: agentWith() });
    assert.equal(baseline.schemaVersion, 1);
    assert.deepEqual(snapshotRunBundle({ agent: agentWith() }), baseline, "two identical agents produce one snapshot");
    assert.match(baseline.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(baseline.fingerprint, agentFingerprint(agentWith(), ""), "the resume fingerprint rides along");
    assert.equal(baseline.limits.maxTurns, 8);
    assert.deepEqual(
      baseline.tools.map((tool) => [tool.name, tool.exclusive]),
      [
        ["search", false],
        ["read", true],
      ],
    );
    assert.equal(baseline.skills[0]?.name, "research");
    assert.deepEqual(baseline.guardrails, [{ name: "no-secrets", stage: "output", revision: "3" }]);
    assert.deepEqual(baseline.loop, { strategy: "single-shot", revision: "1" });
    assert.equal(baseline.thinkingLevel, "medium");
    assert.equal(baseline.systemPrompt.contributions[0]?.id, "house-style");
    assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.tools) && Object.isFrozen(baseline.limits));

    const drifted: [string, ReturnType<typeof agentWith> | undefined, Parameters<typeof snapshotRunBundle>[0]["run"]][] = [
      ["added tool", agentWith({ tools: [...tools(), { name: "extra", parameters: { type: "object" }, execute: () => ({}) }] }), undefined],
      [
        "changed tool schema",
        agentWith({ tools: [...tools(), { name: "extra", parameters: { type: "object", required: ["a", "b"] }, execute: () => ({}) }] }),
        undefined,
      ],
      ["thinking level", agentWith({ thinkingLevel: "high" }), undefined],
      ["raised limit", agentWith({ limits: { maxTurns: 12 } }), undefined],
      ["skill instructions", agentWith({ skills: [{ name: "research", instructions: "Plan last.", toolNames: ["search"] }] }), undefined],
      [
        "guardrail revision",
        agentWith({
          guardrails: { output: [{ name: "no-secrets", stage: "output", revision: "4", evaluate: () => ({ action: "allow" }) }] },
        }),
        undefined,
      ],
      ["system prompt", agentWith({ systemPrompt: [{ id: "house-style", text: "Answer in your own voice." }] }), undefined],
      ["loop", undefined, { loop: { name: "custom-loop", revision: "9", run: async () => undefined } }],
      ["run tool narrowing", undefined, { toolNames: ["search"] }],
      ["run limits", undefined, { limits: { maxTurns: 2 } }],
      ["attention compiler", undefined, { attentionCompiler: { triggerRatio: 0.7 } }],
    ];
    for (const [label, agent, run] of drifted) {
      const next = snapshotRunBundle({ agent: agent ?? agentWith(), ...(run ? { run } : {}) });
      assert.notEqual(next.digest, baseline.digest, `${label} must change the digest`);
    }
  });

  it("never inspects store contents, leaks no secret, and reaches no network primitive", () => {
    const secret = "sk-live-run-bundle";
    const poisoned = {
      kind: "postgres://user:hunter2@db.internal:5432/prism",
      append: () => {
        throw new Error("snapshot must not read a store");
      },
      list: () => {
        throw new Error("snapshot must not read a store");
      },
    } as unknown as SessionStore;
    const bundle = snapshotRunBundle({
      agent: agentWith({ thinkingLevel: `secret ${secret}` }),
      config: { id: "session-1", store: poisoned },
      memory: { kind: "pgvector", durable: true },
      run: {
        attentionCompiler: { compactRatio: 0.9, excludeTools: [`carries ${secret}`] },
        redactor: {
          redact: <T>(value: T): T => (typeof value === "string" ? (value.split(secret).join("[REDACTED]") as T) : value),
        },
        runState: { checkpoints: createMemoryCheckpointStore(), definitionRevision: "rev-1" },
      },
    });
    const json = JSON.stringify(bundle);
    assert.ok(!json.includes(secret), "no secret survives into a pinned snapshot");
    assert.equal(bundle.thinkingLevel, "secret [REDACTED]");
    assert.deepEqual(bundle.attentionCompiler, { compactRatio: 0.9, excludeTools: ["carries [REDACTED]"] });
    assert.equal(bundle.agent.definitionRevision, "rev-1");
    assert.equal(bundle.systemPrompt.instructionsDigest?.startsWith("sha256:"), true);
    assert.ok(!json.includes("hunter2"), "a connection string cannot reach a storage kind");
    assert.deepEqual(bundle.storage.memory, { kind: "pgvector", durable: true });
    assert.equal(bundle.storage.checkpoints.durable, false);
    assert.deepEqual(
      bundle.storage.sessionStore,
      { kind: "custom", durable: true },
      "a URL is not a kind, but postgres still reads as durable",
    );

    // A synchronous function whose module imports no network primitive cannot open a socket.
    const source = readFileSync(new URL("../run-bundle.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /"node:(?:dns|http|https|net|tls)"|\bfetch\(/);
    assert.ok(!(snapshotRunBundle({ agent: agentWith() }) instanceof Promise), "snapshotRunBundle is synchronous");
  });

  it("snapshots 100 tools inside the 5 ms budget", () => {
    const many = createAgent({
      model,
      tools: Array.from({ length: 100 }, (_, index) => ({
        name: `tool-${index}`,
        description: `Tool ${index}`,
        parameters: { type: "object", properties: { b: { type: "string" }, a: { type: "number" } }, required: ["b", "a"] },
        execute: () => ({}),
      })),
    } as unknown as Parameters<typeof createAgent>[0]);
    snapshotRunBundle({ agent: many });
    const samples: number[] = [];
    for (let index = 0; index < 15; index += 1) {
      const started = performance.now();
      snapshotRunBundle({ agent: many });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
    assert.ok(median < 5, `median snapshot of 100 tools was ${median.toFixed(2)}ms`);
    assert.equal(snapshotRunBundle({ agent: many }).tools.length, 100);
  });

  it("keeps a pinned golden digest for a fixed 32-tool agent", () => {
    const golden = createAgent({
      id: "golden-agent",
      model,
      instructions: "Golden instructions.",
      tools: Array.from({ length: 32 }, (_, index) => ({
        name: `golden-${index}`,
        parameters: {
          type: "object",
          properties: { index: { type: "number", enum: [index] }, label: { type: "string" } },
          required: ["label", "index"],
        },
        execute: () => ({}),
      })),
    } as unknown as Parameters<typeof createAgent>[0]);
    // Pinned on purpose: any change to snapshot inputs or digest algorithm must be a deliberate re-pin.
    assert.equal(snapshotRunBundle({ agent: golden }).digest, "sha256:1ddd9b535600a76706fe3ee01f5fd8afb70053f2ffcc6596732c98de4c066c2b");
    assert.equal(snapshotRunBundle({ agent: golden }).tools.length, 32);
  });
});

function tools() {
  return [
    {
      name: "search",
      description: "Search secrets users pasted",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      execute: () => ({}),
    },
    { name: "read", exclusive: true, parameters: { type: "object", required: ["b", "a"] }, execute: () => ({}) },
  ];
}
