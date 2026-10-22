import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AuthMode,
  createPolicyGuard,
  createProfiles,
  type DriverDescriptor,
  defineDriver,
  type PolicyGuard,
} from "@arnilo/prism/driver-kit";
import { defineWorkflow, fanOut, functionNode, runWorkflow, WorkflowDefinitionError } from "../index.js";

const apiKey: AuthMode = { name: "key", kind: "api-key", deployments: ["local"], protected: { paths: [], env: [] } };
const descriptor: DriverDescriptor = {
  vendor: "example",
  usesModel: false,
  models: "passthrough",
  controls: {
    systemPrompt: ["append"],
    builtinTools: "partial",
    clientTools: "mcp",
    skills: true,
    subagents: false,
    permissionCallback: true,
    rewrite: false,
    continueOnStop: true,
    steer: "next-turn",
    resume: "store",
    isolation: "flags",
  },
  capture: {
    textDeltas: true,
    thinking: "final",
    skillActivation: "tool",
    toolCalls: true,
    fileDiffs: false,
    subagents: "none",
    usage: "tokens",
  },
  auth: { modes: [apiKey] },
};

async function profileGuards(cap: number, count = 1, principal?: string) {
  const driver = defineDriver({
    name: "@scope/example-driver",
    vendor: "example",
    revision: "1",
    descriptor,
    parseStatus: ({ exitCode }) => ({ signedIn: exitCode === 0, method: "key" }),
    start: { probe: async () => ({ path: "/bin/example", version: "1.0.0" }), run: async () => {} },
  });
  const profiles = createProfiles({ root: mkdtempSync(join(tmpdir(), "prism-fanout-")), driver });
  await profiles.create("me", { maxConcurrentRuns: cap, ...(principal === undefined ? {} : { principal }) });
  return Array.from({ length: count }, () => createPolicyGuard({ vendor: "example", modes: [apiKey], profiles }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An item that holds the profile like a vendor run would: acquire, work, release. */
function profileItem(guard: PolicyGuard, counter: { active: number; peak: number }, id: number) {
  return functionNode({
    execute: async () => {
      const lease = await guard.acquire({ profile: "me" });
      counter.active += 1;
      counter.peak = Math.max(counter.peak, counter.active);
      try {
        await sleep(15);
        return id;
      } finally {
        counter.active -= 1;
        lease.release();
      }
    },
  });
}

const single = (node: ReturnType<typeof fanOut>) =>
  defineWorkflow({ revision: "1", id: "fan", nodes: { fan: node }, limits: { maxConcurrency: 8, maxFanOut: 16 } });

describe("fanOut", () => {
  it("fan_out_never_exceeds_profile_cap", async () => {
    const [guard] = await profileGuards(2);
    const counter = { active: 0, peak: 0 };
    const result = await runWorkflow(
      single(fanOut({ items: () => [0, 1, 2, 3, 4, 5], route: (item) => profileItem(guard!, counter, Number(item)), maxConcurrency: 6 })),
      null,
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.outputs.fan, [0, 1, 2, 3, 4, 5]);
    assert.equal(counter.peak, 2);
  });

  it("fan_out_item_waits_instead_of_profile_busy", async () => {
    const [guard] = await profileGuards(1);
    const held = await (guard as PolicyGuard).acquire({ profile: "me" });
    setTimeout(() => held.release(), 150);
    const counter = { active: 0, peak: 0 };
    const result = await runWorkflow(
      single(fanOut({ items: () => [0, 1], route: (item) => profileItem(guard!, counter, Number(item)), maxProfileBackoffMs: 50 })),
      null,
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.outputs.fan, [0, 1]);
    assert.equal(counter.peak, 1);
  });

  it("two_agents_share_the_cap_inside_one_fan_out", async () => {
    const guards = await profileGuards(2, 2);
    const counter = { active: 0, peak: 0 };
    const result = await runWorkflow(
      single(fanOut({ items: () => [0, 1, 2, 3], route: (item, index) => profileItem(guards[index % 2]!, counter, Number(item)) })),
      null,
    );
    assert.deepEqual(result.outputs.fan, [0, 1, 2, 3]);
    assert.equal(counter.peak, 2);
  });

  it("fan_out_respects_max_concurrency", async () => {
    const counter = { active: 0, peak: 0 };
    const result = await runWorkflow(
      single(
        fanOut({
          items: () => [0, 1, 2, 3, 4],
          maxConcurrency: 2,
          route: (item) =>
            functionNode({
              execute: async () => {
                counter.active += 1;
                counter.peak = Math.max(counter.peak, counter.active);
                await sleep(10);
                counter.active -= 1;
                return Number(item) * 2;
              },
            }),
        }),
      ),
      null,
    );
    assert.deepEqual(result.outputs.fan, [0, 2, 4, 6, 8]);
    assert.equal(counter.peak, 2);
  });

  it("fan_out_routes_per_item", async () => {
    const result = await runWorkflow(
      single(
        fanOut({
          items: () => [{ ui: true }, { ui: false }, { ui: true }],
          route: (item) => functionNode({ execute: () => ((item as { ui: boolean }).ui ? "ui-engineer" : "host") }),
        }),
      ),
      null,
    );
    assert.deepEqual(result.outputs.fan, ["ui-engineer", "host", "ui-engineer"]);
  });

  it("profile_principal_mismatch_not_retried", async () => {
    const [guard] = await profileGuards(2, 1, "owner");
    let attempts = 0;
    const result = await runWorkflow(
      single(
        fanOut({
          items: () => [0],
          route: () =>
            functionNode({
              execute: async () => {
                attempts += 1;
                await (guard as PolicyGuard).acquire({ profile: "me" });
              },
            }),
        }),
      ),
      null,
    ).catch((error: unknown) => error);
    assert.equal(attempts, 1);
    assert.match(String((result as { message?: string }).message ?? JSON.stringify(result)), /profile_principal_mismatch/);
  });

  it("fan_out_validates_route_and_bounds", async () => {
    assert.throws(() => fanOut({ items: () => [], route: undefined as never }), WorkflowDefinitionError);
    await assert.rejects(
      runWorkflow(single(fanOut({ items: () => [1], route: () => ({ kind: "gate" }) as never })), null),
      /route\(\) must return/,
    );
  });
});
