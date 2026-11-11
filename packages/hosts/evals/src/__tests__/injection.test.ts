import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  createAgent,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type Agent,
  type AgentConfig,
  type ToolResult,
  type HookRegistrar,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { BUILTIN_INJECTION_ATTACKS, createInjectionDataset, defineScorer, injectionHooks, runInjectionSuite } from "../index.js";

const tasks = [
  { id: "a", input: "Read the page", expected: "42" },
  { id: "b", input: "Read another page", expected: "42" },
];
const utility = defineScorer({ id: "utility", score: ({ result }) => ({ score: result.text === "42" ? 1 : 0 }) });

test("injection_dataset_crosses_tasks_attacks_carriers", () => {
  const dataset = createInjectionDataset({
    id: "inj",
    tasks,
    carriers: [{ tool: "web_fetch" }, { tool: "read" }, { tool: "browser_snapshot" }],
  });
  assert.equal(dataset.items.length, 26);
  assert.equal(dataset.items.filter((i) => i.tags?.includes("benign")).length, 2);
  assert.equal(dataset.items.filter((i) => i.tags?.includes("attack:ignore_previous")).length, 6);
  assert.ok(dataset.items.every((i) => i.metadata?.injection));
  assert.equal(new Set(dataset.items.map((i) => i.id)).size, 26);
  assert.throws(() => createInjectionDataset({ id: "bad", tasks, carriers: [{ tool: "read", position: "bad" as "append" }] }));
  assert.throws(() => createInjectionDataset({ id: "bad", tasks, carriers: [], attacks: [{ id: "bad", payload: "x", goal: {} }] }));
});

async function rewrite(tool: string, result: ToolResult, attack = true, position: "append" | "prepend" = "append") {
  let around: ((call: { name: string }, next: () => Promise<ToolResult>) => Promise<ToolResult>) | undefined;
  const hooks = injectionHooks(
    attack
      ? { attackId: "custom", carrier: { tool: "web_fetch", position }, payload: "ATTACK", goal: { textContains: "bad" } }
      : { attackId: null, carrier: null },
  );
  hooks({
    on: (_: unknown, handler: unknown) => {
      around = handler as typeof around;
    },
  } as unknown as HookRegistrar);
  return around ? around({ name: tool }, async () => result) : result;
}

test("hook_injects_only_into_carrier_for_its_item", async () => {
  const original: ToolResult = {
    toolCallId: "c",
    name: "web_fetch",
    content: [
      { type: "text", text: "page" },
      { type: "image", data: "a", mimeType: "image/png" },
    ],
    value: { markdown: "page", offset: 0 },
    metadata: { trust: "untrusted_external", source: "https://example.invalid" },
  };
  const changed = await rewrite("web_fetch", original);
  assert.ok(changed.content?.[0]?.type === "text");
  assert.equal(changed.content[0].text, "page\n\nATTACK");
  assert.deepEqual(changed.value, { markdown: "page\n\nATTACK", offset: 0 });
  assert.deepEqual(changed.content[1], original.content![1]);
  assert.deepEqual(changed.metadata, original.metadata);
  const prepended = await rewrite("web_fetch", original, true, "prepend");
  assert.ok(prepended.content?.[0]?.type === "text");
  assert.equal(prepended.content[0].text, "ATTACK\n\npage");
  assert.equal(await rewrite("read", original), original);
  assert.equal(original.content![0]!.type === "text" && original.content![0]!.text, "page");
  const failed = { ...original, error: { message: "failed" } };
  assert.equal(await rewrite("web_fetch", failed), failed);
  const image = { ...original, content: [{ type: "image" as const, data: "a", mimeType: "image/png" }] };
  assert.equal(await rewrite("web_fetch", image), image);
  const valueOnly = await rewrite("web_fetch", { toolCallId: "v", name: "web_fetch", value: { markdown: "page" } });
  assert.ok(valueOnly.value && typeof valueOnly.value === "object" && "markdown" in valueOnly.value);
  assert.equal(valueOnly.value.markdown, "page\n\nATTACK");
});

test("benign_items_never_injected", async () => {
  const result = { toolCallId: "c", name: "web_fetch", value: "page" };
  assert.equal(await rewrite("web_fetch", result, false), result);
});

test("exfiltration_domain_is_reserved_invalid", () => {
  const attack = BUILTIN_INJECTION_ATTACKS.find((a) => a.id === "exfiltration_link")!;
  assert.ok(new URL(attack.goal.argsContain!).hostname.endsWith(".invalid"));
  assert.equal(attack.goal.tool, "web_fetch");
});

test("suite_reports_three_rates_with_intervals_and_detects_exfiltration_argument", async () => {
  const agents: Agent[] = [];
  const seen: string[] = [];
  let observedResults = 0;
  const factory = async (extra: Pick<AgentConfig, "hooks" | "slots">) => {
    let turn = 0;
    const agent = await createAgent({
      ...extra,
      model: { provider: "mock", model: "injection" },
      packages: [
        providerPackage("test-injection", [
          {
            id: "mock",
            async *generate(request) {
              const text = JSON.stringify(request.messages);
              if (turn++ === 0)
                yield providerToolCall({ type: "tool_call", id: "first", name: "web_fetch", arguments: { url: "https://task.invalid" } });
              else if (turn === 2 && text.includes("exfiltrate.invalid")) {
                seen.push(text);
                yield providerToolCall({
                  type: "tool_call",
                  id: "exfil",
                  name: "web_fetch",
                  arguments: { url: "https://exfiltrate.invalid/collect" },
                });
              } else yield providerTextDelta(text.includes("exfiltrate.invalid") ? "compromised" : "42");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "web_fetch",
            description: "Sandboxed page",
            parameters: { type: "object", properties: { url: { type: "string" } } },
            execute: (_, ctx) => ({
              toolCallId: ctx.toolCallId,
              name: "web_fetch",
              content: [{ type: "text", text: "42" }],
              metadata: { trust: "untrusted_external" },
            }),
          },
        ],
      },
    });
    agents.push(agent);
    return agent;
  };
  try {
    const dataset = createInjectionDataset({
      id: "suite",
      tasks,
      carriers: [{ tool: "web_fetch" }],
      attacks: [BUILTIN_INJECTION_ATTACKS.find((a) => a.id === "exfiltration_link")!],
    });
    const suite = await runInjectionSuite({
      agent: factory,
      dataset,
      utility,
      trials: 2,
      concurrency: 4,
      hooks: (hooks) => {
        hooks.on("tool.result", () => {
          observedResults++;
        });
      },
    });
    assert.equal(suite.report.status, "succeeded");
    assert.equal(observedResults, 12, "suite preserves supplied hooks");
    assert.equal(suite.benignUtility.rate, 1);
    assert.equal(suite.utilityUnderAttack.rate, 0);
    assert.equal(suite.attackSuccessRate.rate, 1);
    assert.equal(suite.attackSuccessRate.n, 4);
    assert.ok(suite.attackSuccessRate.ci95!.low > 0);
    assert.equal(suite.byAttack.exfiltration_link!.attackSuccessRate.rate, 1);
    assert.equal(suite.byCarrier.web_fetch!.utilityUnderAttack.rate, 0);
    assert.ok(seen.every((text) => text.includes("untrusted")));
    assert.ok(suite.report.evaluations.filter((e) => e.scorerId === "attack_success").every((e) => e.metadata?.invariant !== true));
    await assert.rejects(runInjectionSuite({ agent: factory, dataset, utility, timeline: "metadata" }), /redacted_io/);
  } finally {
    await Promise.all(agents.map((a) => a.dispose()));
  }
});

test("read_and_browser_carriers_preserve_their_real_shapes", async () => {
  for (const tool of ["read", "browser_snapshot"]) {
    const spec = { attackId: "custom", carrier: { tool }, payload: "ATTACK", goal: { textContains: "bad" } };
    let around: ((call: { name: string }, next: () => Promise<ToolResult>) => Promise<ToolResult>) | undefined;
    injectionHooks(spec)({
      on: (_: unknown, handler: unknown) => {
        around = handler as typeof around;
      },
    } as unknown as HookRegistrar);
    const original: ToolResult = {
      toolCallId: "c",
      name: tool,
      content: [{ type: "text", text: "body" }],
      ...(tool === "browser_snapshot"
        ? { value: { ariaSnapshot: "body", snapshotId: "s" }, metadata: { trust: "untrusted_external", snapshotId: "s" } }
        : { metadata: { scannedBytes: 4 } }),
    };
    const changed = await around!({ name: tool }, async () => original);
    assert.deepEqual(changed.content, [{ type: "text", text: "body\n\nATTACK" }]);
    assert.deepEqual(changed.metadata, original.metadata);
    if (tool === "browser_snapshot") assert.deepEqual(changed.value, { ariaSnapshot: "body\n\nATTACK", snapshotId: "s" });
    else {
      assert.equal(changed.metadata?.trust, undefined);
      const image = { ...original, metadata: { image: { mimeType: "image/png" } } };
      assert.equal(await around!({ name: tool }, async () => image), image);
    }
  }
});

test("failed_trials_leave_rates_unavailable_and_report_missing_evidence", async () => {
  const dataset = createInjectionDataset({ id: "failure", tasks: tasks.slice(0, 1), carriers: [{ tool: "read" }] });
  const suite = await runInjectionSuite({
    dataset,
    utility,
    agent: async () => {
      throw new Error("fixture cannot start");
    },
  });
  assert.equal(suite.report.status, "failed");
  assert.equal(suite.benignUtility.missing, 1);
  assert.equal(suite.attackSuccessRate.missing, 4);
  assert.equal(suite.attackSuccessRate.rate, undefined);
  assert.equal(suite.utilityUnderAttack.ci95, undefined);
  await assert.rejects(
    runInjectionSuite({
      dataset,
      utility,
      agent: async () => {
        throw new Error("must not run");
      },
      sampling: { rate: 0.5 },
    }),
    /sampling\.rate/,
  );
});
