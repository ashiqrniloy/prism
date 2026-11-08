import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type Message, type ProviderRequest } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { createKiloProvider, type KiloRoute, kilo, kiloModels } from "../index.js";

const chatModel = process.env.PRISM_LIVE_KILO_CHAT_MODEL ?? "google/gemma-4-26b-a4b-it";
const responsesModel = process.env.PRISM_LIVE_KILO_RESPONSES_MODEL ?? "openai/gpt-6-luna";
const messagesModel = process.env.PRISM_LIVE_KILO_MESSAGES_MODEL ?? "anthropic/claude-haiku-5.5";

const skip =
  process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || !process.env.KILO_API_KEY
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and KILO_API_KEY to run the Kilo kernel smoke"
    : false;

// 64x64 red PNG: the wires reject a 1x1 placeholder, so the image leg uses a real raster.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

const wires: readonly { readonly name: string; readonly route: KiloRoute; readonly model: string }[] = [
  { name: "chat", route: "chat", model: chatModel },
  { name: "responses", route: "responses", model: responsesModel },
  { name: "messages", route: "messages", model: messagesModel },
];

function modelFor(route: KiloRoute, id: string) {
  const entry = kiloModels.find((model) => model.model === id) ?? kiloModels.find((model) => model.model === chatModel)!;
  // The free fixture row is Chat-stamped; the route is forced so the kernel run proves the wire rule.
  return { ...entry, model: id, compat: { ...entry.compat, route } };
}

/** One multi-turn kernel run per wire with a tool and an image turn, proving the route rule end to end. */
for (const wire of wires) {
  describe(`Kilo ${wire.name} kernel smoke`, () => {
    it.skipIf(skip !== false)(
      "live_agent_two_turn_tool_session",
      async () => {
        const executed: string[] = [];
        const agent = await createAgent({
          id: `kilo-${wire.name}-smoke`,
          model: modelFor(wire.route, wire.model),
          packages: [kilo({ apiKey: "env:KILO_API_KEY" })],
          tools: {
            add: [
              {
                name: "echo_value",
                description: "Echo a number back to the caller.",
                parameters: {
                  type: "object",
                  properties: { value: { type: "number" } },
                  required: ["value"],
                },
                execute: (args, context) => {
                  executed.push(String(args.value));
                  return { toolCallId: context.toolCallId, name: "echo_value", value: { echoed: args.value } };
                },
              },
            ],
          },
        });
        const session = await agent.session();

        const first = await session.run("Call echo_value with value 7, then say done.");
        assert.equal(first.status, "completed", `${wire.name} first turn: ${first.text}`);
        assert.ok(executed.length >= 1, `${wire.name} did not call echo_value`);
        assert.ok(
          first.messages.some((message) => message.content.some((block) => block.type === "tool_result")),
          `${wire.name} first turn kept no tool result`,
        );

        const second = await session.run("What number did the tool echo? Answer with the number only.");
        assert.equal(second.status, "completed", `${wire.name} second turn: ${second.text}`);
        assert.match(second.text, /7/, `${wire.name} second turn lost the tool result`);

        const image: Message = {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: PNG },
            { type: "text", text: "What color is this square? One word." },
          ],
        };
        const third = await session.run([image]);
        assert.equal(third.status, "completed", `${wire.name} image turn: ${third.text}`);
        assert.match(third.text.toLowerCase(), /red/, `${wire.name} image turn did not see the square`);

        if (process.env.KILO_API_KEY) {
          assert.equal(
            JSON.stringify([first, second, third]).includes(process.env.KILO_API_KEY),
            false,
            `${wire.name} result leaked the API key`,
          );
        }
        await agent.dispose();
      },
      180_000,
    );
  });
}

describe("Kilo credentialless and data-collection live checks", () => {
  const free = kiloModels.find((model) => model.model.endsWith(":free"))!;
  const request = (model = free): ProviderRequest => ({
    model,
    messages: [{ role: "user", content: [{ type: "text", text: "Reply pong." }] }],
    options: { sessionId: "kilo-live-anonymous" },
  });

  it.skipIf(skip !== false)(
    "live_anonymous_free_request_succeeds_without_credential",
    async () => {
      const seen: (string | null)[] = [];
      const provider = createKiloProvider({
        fetch: (async (input, init) => {
          seen.push(new Headers(init?.headers).get("authorization"));
          return fetch(input, init);
        }) as typeof fetch,
      });
      const events = await collectProviderEvents(provider, request());
      assert.equal(events.at(-1)?.type, "done", "anonymous free request did not finish");
      assert.ok(seen.length > 0, "anonymous request never reached the gateway");
      assert.ok(
        seen.every((value) => value === null),
        "anonymous free request sent an authorization header",
      );
    },
    120_000,
  );

  it.skipIf(skip !== false)(
    "live_data_collection_deny_succeeds_or_maps_policy_error",
    async () => {
      const bodies: unknown[] = [];
      const provider = createKiloProvider({
        apiKey: async () => process.env.KILO_API_KEY,
        dataCollection: "deny",
        fetch: (async (input, init) => {
          bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
          return fetch(input, init);
        }) as typeof fetch,
      });
      const events = await collectProviderEvents(provider, request());
      const last = events.at(-1);
      assert.ok(last, "data-collection request produced no events");
      if (last.type === "error") {
        assert.match(last.error.message, /policy|403|data collection/i, "the policy error was not mapped");
      } else {
        assert.equal(last.type, "done", "data-collection request did not finish");
      }
      assert.equal(
        bodies.some((body) => (body as { provider?: { data_collection?: string } })?.provider?.data_collection === "deny"),
        true,
        "the request body lost provider.data_collection=deny",
      );
    },
    120_000,
  );
});
