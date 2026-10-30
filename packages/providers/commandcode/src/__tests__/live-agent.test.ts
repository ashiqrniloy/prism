import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type Message, type ProviderRequest } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { commandCodeModels, commandcode, createCommandCodeProvider } from "../index.js";

const chatModel = process.env.PRISM_LIVE_COMMANDCODE_CHAT_MODEL ?? "minimax/minimax-m3.1-flash";
const responsesModel = process.env.PRISM_LIVE_COMMANDCODE_RESPONSES_MODEL ?? "gpt-5.6-luna";
const messagesModel = process.env.PRISM_LIVE_COMMANDCODE_MESSAGES_MODEL ?? "claude-haiku-5-5";

const skip =
  process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || !process.env.COMMAND_CODE_API_KEY
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and COMMAND_CODE_API_KEY to run the Command Code kernel smoke"
    : false;

// 64x64 red PNG: the wires reject a 1x1 placeholder, so the image leg uses a real raster.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

const wires = [
  { name: "chat", model: chatModel },
  { name: "responses", model: responsesModel },
  { name: "messages", model: messagesModel },
] as const;

/** One multi-turn kernel run per wire with a tool and a thinking level, proving the route rule end to end. */
for (const wire of wires) {
  describe(`Command Code ${wire.name} kernel smoke`, () => {
    it.skipIf(skip !== false)(
      "live_agent_two_turn_tool_session",
      async () => {
        const executed: string[] = [];
        const agent = await createAgent({
          id: `commandcode-${wire.name}-smoke`,
          // Pass the catalog entry, not a bare ref: the image gate reads `capabilities.input` from the
          // request's model, and only the curated catalog carries modalities.
          model: commandCodeModels.find((entry) => entry.model === wire.model)!,
          thinkingLevel: "high",
          packages: [commandcode({ apiKey: "env:COMMAND_CODE_API_KEY" })],
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

        if (process.env.COMMAND_CODE_API_KEY) {
          assert.equal(
            JSON.stringify([first, second, third]).includes(process.env.COMMAND_CODE_API_KEY),
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

describe("Command Code ZDR mapping", () => {
  const chat = commandCodeModels.find((entry) => entry.model === chatModel);
  const model = (id: string) => commandCodeModels.find((entry) => entry.model === id) ?? { ...chat!, model: id };
  const request = (entry: ReturnType<typeof model>): ProviderRequest => ({
    model: entry,
    messages: [{ role: "user", content: [{ type: "text", text: "Reply OK." }] }],
    options: {},
  });
  // Direct provider: the package's credentials slot is not in play, so the ref would stay literal.
  const provider = () => createCommandCodeProvider({ apiKey: process.env.COMMAND_CODE_API_KEY, zdr: true });

  it.skipIf(skip !== false)(
    "live_zdr_capable_model_succeeds",
    async () => {
      const events = await collectProviderEvents(provider(), request(model(chatModel)));
      assert.equal(events.at(-1)?.type, "done", "the zdr request did not finish");
    },
    120_000,
  );

  it.skipIf(skip !== false)(
    "live_zdr_unsupported_model_maps_422",
    async () => {
      // Laguna free answers Chat Completions but has no zero-data-retention upstream (measured Task 1b).
      const events = await collectProviderEvents(provider(), request(model("poolside/laguna-s-2.1-free")));
      const last = events.at(-1);
      assert.equal(last?.type, "error", "the non-ZDR model answered instead of failing");
      const message = last?.type === "error" ? last.error.message : "";
      assert.match(message, /422/, "the mapped error lost the status");
      assert.match(message, /zdr/i, "the mapped error lost the zdr hint");
    },
    120_000,
  );
});
