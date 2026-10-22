import { createAgent, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

const catalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";

/** Compile-checked A2UI painting demo for `@arnilo/prism-ag-ui`. */
export async function demo() {
  let turn = 0;
  const agent = await createAgent({
    model: { provider: "mock", model: "mock" },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            if (++turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("paint-1", "paint", {}) };
            } else {
              yield providerTextDelta("done");
            }
            yield providerDone();
          },
        },
      ]),
    ],
    tools: {
      add: [
        {
          name: "paint",
          parameters: { type: "object" },
          execute: () => ({
            toolCallId: "paint-1",
            name: "paint",
            value: {
              a2ui_operations: [
                { version: "v0.9", createSurface: { surfaceId: "demo" } },
                {
                  version: "v0.9",
                  updateComponents: {
                    surfaceId: "demo",
                    components: [{ id: "root", component: "Text", text: "Hello A2UI" }],
                  },
                },
              ],
            },
          }),
        },
      ],
    },
  });

  const handle = createAgUiHandler(agent, {
    authorize: () => ({ ownership: { userId: "demo" } }),
    a2ui: { catalogId, mode: "fixed-schema" },
  });

  const response = await handle(
    new Request("https://example.test/ag-ui", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [{ id: "message-1", role: "user", content: "paint" }],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    painted: text.includes("ACTIVITY_SNAPSHOT") && text.includes("a2ui-surface"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
