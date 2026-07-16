import {
  createAgent,
  createMockProvider,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { createPrismHandler } from "@arnilo/prism-server";

const agent = createAgent({
  model: { provider: "mock", model: "offline" },
  provider: createMockProvider([providerTextDelta("served"), providerDone()]),
});

const handler = createPrismHandler({
  agents: { support: agent },
  authorize: async ({ request }) => request.headers.get("authorization") === "Bearer demo-placeholder"
    ? { ownership: { tenantId: "demo-tenant", userId: "demo-user" } }
    : false,
});

const response = await handler(new Request("https://example.test/prism/agents/support/runs", {
  method: "POST",
  headers: {
    authorization: "Bearer demo-placeholder",
    "content-type": "application/json",
  },
  body: JSON.stringify({ input: "Hello" }),
}));

console.log(JSON.stringify({ status: response.status, result: await response.json() }));
