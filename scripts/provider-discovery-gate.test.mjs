// scripts/provider-discovery-gate.test.mjs — plan 152 Tasks 4/8.
//
// Cross-vendor discovery gate: a provider package registers at `setup` without
// touching the network, and `models()` runs only when `agent.models.list()` asks
// for it. Each vendor's own `package.test.ts` asserts the same thing for its
// endpoint; this one walks every vendor so a new package cannot quietly fetch
// during setup. It used to live in the retired provider-family workspace, deleted
// in plan 152 Task 8, so it moved here (the scripts gate stage runs it).
//
// Network-free: every transport is a fake fetch.
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent } from "@arnilo/prism";
import { hyper } from "@arnilo/prism-provider-hyper";
import { laya } from "@arnilo/prism-provider-laya";
import { opencodeGo } from "@arnilo/prism-provider-opencode-go";
import { typesafe } from "@arnilo/prism-provider-typesafe";

/** `endpoint: undefined` marks a vendor with no live discovery: `models()` must never fetch. */
const CASES = [
  {
    id: "hyper",
    model: "deepseek-v4-flash",
    endpoint: "https://hyper.charm.land/v1/models",
    instance: (fetchImpl) => hyper({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "opencode-go",
    model: "grok-4.5",
    endpoint: "https://opencode.ai/zen/go/v1/models",
    instance: (fetchImpl) => opencodeGo({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "typesafe",
    model: "jev-latest",
    endpoint: undefined,
    instance: (fetchImpl) => typesafe({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "laya",
    model: "laya",
    endpoint: undefined,
    instance: (fetchImpl) => laya({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
];

const KEY = "prism-discovery-gate-key";

describe("provider discovery is caller-gated", () => {
  it("discovery_runs_only_on_models_list", async () => {
    const previous = process.env.PRISM_TEST_DISCOVERY_KEY;
    process.env.PRISM_TEST_DISCOVERY_KEY = KEY;
    try {
      for (const entry of CASES) {
        const urls = [];
        const fetchImpl = async (input) => {
          urls.push(String(input));
          return new Response(JSON.stringify({ object: "list", data: [{ id: `${entry.id}-discovered`, object: "model", created: 1 }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        };
        const agent = await createAgent({
          model: { provider: entry.id, model: entry.model },
          packages: [entry.instance(fetchImpl)],
        });
        try {
          assert.deepEqual(urls, [], `${entry.id}: setup must not fetch`);
          const listed = await agent.models.list();
          assert.ok(listed.length > 0, `${entry.id}: models.list() must not be empty`);
          if (entry.endpoint === undefined) {
            assert.deepEqual(urls, [], `${entry.id}: a static catalog never fetches`);
          } else {
            assert.deepEqual(urls, [entry.endpoint], `${entry.id}: discovery runs exactly once, on models.list()`);
          }
        } finally {
          await agent.dispose();
        }
      }
    } finally {
      if (previous === undefined) delete process.env.PRISM_TEST_DISCOVERY_KEY;
      else process.env.PRISM_TEST_DISCOVERY_KEY = previous;
    }
  });
});
