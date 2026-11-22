/** Plan 229 Task 3: `createAgent`, `run`/`stream`/`resume`, and `agent.session()` reject a malformed config. */
import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { type AgentConfig, createAgent, definePackage, providerDone, providerTextDelta, type ToolDefinition } from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const model = { provider: "mock", model: "demo" };
const tool: ToolDefinition = {
  name: "probe",
  description: "probe",
  parameters: { type: "object" },
  execute: () => ({ toolCallId: "c", name: "probe" }),
};
const provider = providerPackage("test-provider", [
  {
    id: "mock",
    async *generate() {
      yield providerTextDelta("done");
      yield providerDone();
    },
  },
]);

async function rejectsWith(config: unknown, pattern: RegExp): Promise<TypeError> {
  let caught: unknown;
  try {
    await createAgent(config as AgentConfig);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TypeError, `expected a TypeError for ${pattern}`);
  assert.match(caught.message, pattern);
  return caught;
}

describe("AgentConfig shape (plan 229 Task 3)", () => {
  test("tools_array_is_rejected_with_the_expected_shape", async () => {
    await rejectsWith(
      { model, tools: [tool] },
      /^AgentConfig\.tools must be an object \(\{ add\?: ToolDefinition\[\].*\); received an array$/,
    );
  });

  test("unknown_key_names_the_nearest_known_key", async () => {
    await rejectsWith({ model, tool: { add: [tool] } }, /AgentConfig has unknown key "tool"; did you mean "tools"\?/);
    await rejectsWith({ model, validate: () => undefined }, /did you mean "validator"\?/);
    await rejectsWith({ model, completelyUnrelatedKey: 1 }, /AgentConfig has unknown key "completelyUnrelatedKey"$/);
  });

  test("wrong_typed_known_keys_are_rejected", async () => {
    const cases: readonly [string, unknown, RegExp][] = [
      ["tools", { add: tool }, /AgentConfig\.tools\.add must be an array of ToolDefinition/],
      ["tools", { only: ["x"] }, /AgentConfig\.tools has unknown key "only"/],
      ["tools", { concurrency: 0 }, /AgentConfig\.tools\.concurrency must be a positive integer/],
      ["tools", { validation: "loose" }, /AgentConfig\.tools\.validation must be "schema" or "off"/],
      ["tools", { add: [{ name: "x" }] }, /AgentConfig\.tools\.add\[0\]\.execute must be a function/],
      ["tools", { add: [{ execute: () => undefined }] }, /AgentConfig\.tools\.add\[0\]\.name must be a non-empty string/],
      ["skills", [], /AgentConfig\.skills must be an object/],
      ["skills", { add: [{ description: "x" }] }, /AgentConfig\.skills\.add\[0\]\.name must be a non-empty string/],
      ["skills", { dirs: "skills" }, /AgentConfig\.skills\.dirs must be an array of strings/],
      ["packages", provider, /AgentConfig\.packages must be an array/],
      ["packageConfig", { coding: "on" }, /AgentConfig\.packageConfig\["coding"\] must be an object/],
      ["limits", { maxTurns: 0 }, /AgentConfig\.limits: maxTurns must be a positive safe integer/],
      ["limits", { maxTurn: 4 }, /AgentConfig\.limits has unknown key "maxTurn"; did you mean "maxTurns"\?/],
      ["retry", { maxAttempts: -1 }, /AgentConfig\.retry\.maxAttempts must be a non-negative safe integer/],
      ["retry", true, /AgentConfig\.retry must be false or an object/],
      ["compaction", true, /AgentConfig\.compaction must be false or an object/],
      ["compaction", { trigger: { type: "input_ratio", ratio: 2 } }, /AgentConfig\.compaction\.trigger: .*input_ratio\.ratio/],
      ["slots", "loop", /AgentConfig\.slots must be an object/],
      ["disable", { tools: "bash" }, /AgentConfig\.disable\.tools must be an array of strings/],
      ["hooks", {}, /AgentConfig\.hooks must be a function/],
      ["host", () => undefined, /AgentConfig\.host must be an object/],
      ["instructions", ["be brief"], /AgentConfig\.instructions must be a string/],
      ["model", 42, /AgentConfig\.model must be a "provider\/model" string or a model object/],
      ["usageEstimation", "sometimes", /AgentConfig\.usageEstimation must be "fallback" or "off" or "strict"/],
    ];
    for (const [key, value, pattern] of cases) await rejectsWith({ model, [key]: value }, pattern);
  });

  test("removed_fields_keep_their_messages", async () => {
    await rejectsWith({ model, store: {} }, /AgentConfig\.store was removed/);
    await rejectsWith({ model, provider: {} }, /AgentConfig\.provider was removed/);
    await rejectsWith({ model, providerSource: {} }, /AgentConfig\.providerSource was removed/);
  });

  test("undefined_values_are_ignored", async () => {
    const agent = await createAgent({ model, packages: [provider], tools: undefined, typo: undefined } as AgentConfig);
    await agent.dispose();
  });

  test("bad_config_loads_no_package", async () => {
    let setups = 0;
    const spy = definePackage({
      name: "setup-spy",
      version: "1.0.0",
      setup() {
        setups++;
      },
    });
    await rejectsWith({ model, packages: [spy], tools: [tool] }, /AgentConfig\.tools/);
    await rejectsWith({ model, packages: [spy], limits: { maxTurns: -1 } }, /AgentConfig\.limits/);
    assert.equal(setups, 0);
  });

  test("error_message_contains_no_config_value", async () => {
    const secret = "sk-SECRET-VALUE-123";
    const messages = [
      (await rejectsWith({ model, instructions: [secret] }, /instructions/)).message,
      (await rejectsWith({ model, [secret]: secret }, /unknown key/)).message,
      (await rejectsWith({ model, tools: { add: [{ name: secret }] } }, /execute/)).message,
      (await rejectsWith({ model, hooks: secret }, /hooks/)).message,
    ];
    // An unknown key is itself named (it is a key, not a value); the value never appears.
    assert.ok(messages[1]?.includes(`"${secret}"`));
    for (const [index, message] of messages.entries()) if (index !== 1) assert.equal(message.includes(secret), false, message);
  });
});

describe("RunOptions and SessionOptions shape (plan 229 Task 3)", () => {
  test("unknown_run_option_is_rejected", async () => {
    const agent = await createAgent({ model, packages: [provider] });
    const session = await agent.session();
    await assert.rejects(
      session.run("hi", { validator: () => undefined } as never),
      /RunOptions has unknown key "validator"; did you mean "validate"\?/,
    );
    await assert.rejects(session.run("hi", { tools: { add: [tool] } } as never), /RunOptions\.tools has unknown key "add"/);
    await assert.rejects(session.run("hi", { acrossRuns: true } as never), /RunOptions has unknown key "acrossRuns"/);
    // `stream()` accepts the `SubscribeOptions` keys.
    const events = [];
    for await (const event of session.stream("hi", { acrossRuns: true, maxQueuedEvents: 64, overflow: "close" })) events.push(event);
    assert.ok(events.some((event) => event.type === "run.completed"));
    await assert.rejects(
      (async () => {
        for await (const _ of session.stream("hi", { maxQueuedEvent: 64 } as never));
      })(),
      /RunOptions has unknown key "maxQueuedEvent"; did you mean "maxQueuedEvents"\?/,
    );
    await assert.rejects(
      (async () => {
        for await (const _ of session.resume([], { limit: {} } as never));
      })(),
      /RunOptions has unknown key "limit"; did you mean "limits"\?/,
    );
    await agent.dispose();
  });

  test("unknown_session_option_is_rejected", async () => {
    const agent = await createAgent({ model, packages: [provider] });
    await assert.rejects(agent.session({ leaf: "x" } as never), /SessionOptions has unknown key "leaf"; did you mean "leafId"\?/);
    await assert.rejects(agent.session({ create: "yes" } as never), /SessionOptions\.create must be a boolean/);
    await assert.rejects(agent.session({ store: {} } as never), /Session options no longer accept "store"/);
    await agent.dispose();
  });
});
