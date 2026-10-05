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
import { alibaba } from "@arnilo/prism-provider-alibaba";
import { clinepass } from "@arnilo/prism-provider-clinepass";
import { deepseek } from "@arnilo/prism-provider-deepseek";
import { kimi } from "@arnilo/prism-provider-kimi";
import { neuralwatt } from "@arnilo/prism-provider-neuralwatt";
import { ollama } from "@arnilo/prism-provider-ollama";
import { opencodeGo } from "@arnilo/prism-provider-opencode-go";
import { openrouter } from "@arnilo/prism-provider-openrouter";
import { xai } from "@arnilo/prism-provider-xai";
import { zai } from "@arnilo/prism-provider-zai";

/** `endpoint: undefined` marks a vendor with no live discovery: `models()` must never fetch. */
const CASES = [
  {
    id: "deepseek",
    model: "deepseek-v4-flash",
    endpoint: "https://api.deepseek.com/models",
    instance: (fetchImpl) => deepseek({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "xai",
    model: "grok-4.6",
    endpoint: "https://api.x.ai/v1/models",
    instance: (fetchImpl) => xai({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "zai",
    model: "glm-5.2",
    endpoint: "https://api.z.ai/api/paas/v4/models",
    instance: (fetchImpl) => zai({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "alibaba",
    model: "qwen-plus",
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    instance: (fetchImpl) => alibaba({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "kimi-coding",
    model: "k3",
    endpoint: undefined,
    instance: (fetchImpl) => kimi({ kimiApiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "openrouter",
    model: "openrouter/auto",
    endpoint: "https://openrouter.ai/api/v1/models",
    instance: (fetchImpl) => openrouter({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "ollama",
    model: "gpt-oss:20b",
    endpoint: "https://ollama.com/v1/models",
    instance: (fetchImpl) => ollama({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "opencode-go",
    model: "grok-4.5",
    endpoint: "https://opencode.ai/zen/go/v1/models",
    instance: (fetchImpl) => opencodeGo({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "neuralwatt",
    model: "glm-5.2",
    endpoint: "https://api.neuralwatt.com/v1/models",
    instance: (fetchImpl) => neuralwatt({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
  },
  {
    id: "clinepass",
    model: "cline-pass/glm-5.2",
    endpoint: undefined,
    instance: (fetchImpl) => clinepass({ apiKey: "env:PRISM_TEST_DISCOVERY_KEY", fetch: fetchImpl }),
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
