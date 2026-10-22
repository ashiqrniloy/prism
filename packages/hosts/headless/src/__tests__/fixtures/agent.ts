import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type HostUi,
  type JsonObject,
  type OwnershipScope,
  providerTextDelta,
  type SessionStore,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

export async function build(
  options: {
    store?: SessionStore;
    ui?: HostUi;
    ownership?: OwnershipScope;
    resumed?: boolean;
    elicitation?: boolean;
    schema?: JsonObject;
    multiple?: boolean;
  } = {},
) {
  let executed = 0;
  const first = [
    { type: "tool_call", call: { type: "tool_call", id: "call", name: "deploy", arguments: {} } },
    ...(options.multiple
      ? [{ type: "tool_call" as const, call: { type: "tool_call" as const, id: "second", name: "deploy", arguments: {} } }]
      : []),
    { type: "done" },
  ] as const;
  const last = [providerTextDelta("finished"), { type: "done" }] as const;
  const agent = await createAgent({
    id: "headless-test",
    model: { provider: "mock", model: "test" },
    slots: { store: options.store ?? createMemorySessionStore() },
    ownership: options.ownership,
    host: options.ui ? { ui: options.ui } : undefined,
    hooks: askEveryTool(),
    packages: [mockProvider(options.resumed ? [last] : [first, last])],
    tools: {
      add: [
        {
          name: "deploy",
          parameters: { type: "object", properties: {} },
          ...(options.elicitation
            ? {
                elicitation: () => ({
                  schema: options.schema ?? { type: "object", required: ["choice"], properties: { choice: { enum: ["a", "b"] } } },
                  reason: "Pick one",
                  validate: (value: Record<string, unknown>) => {
                    if (value.choice !== "a" && value.choice !== "b") throw new Error("unknown option");
                  },
                }),
              }
            : {}),
          execute(_args, ctx) {
            executed++;
            return { toolCallId: ctx.toolCallId, name: "deploy", value: "done" };
          },
        },
      ],
    },
  });
  return { agent, executed: () => executed };
}
