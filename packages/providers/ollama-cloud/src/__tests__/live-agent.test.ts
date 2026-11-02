import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type Message } from "@arnilo/prism";
import { ollamaCloud, ollamaCloudModels } from "../index.js";

const modelId = process.env.PRISM_LIVE_OLLAMA_CLOUD_MODEL ?? "gemma4:31b";
const skip =
  process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || !process.env.OLLAMA_API_KEY
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and OLLAMA_API_KEY to run the Ollama Cloud kernel smoke"
    : false;

// 64x64 red PNG: the wires reject a 1x1 placeholder, so the image leg uses a real raster.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

describe("Ollama Cloud kernel smoke", () => {
  it.skipIf(skip !== false)(
    "live_agent_two_turn_tool_session_and_vision_turn",
    async () => {
      const executed: string[] = [];
      const agent = await createAgent({
        id: "ollama-cloud-smoke",
        model: ollamaCloudModels.find((entry) => entry.model === modelId)!,
        packages: [ollamaCloud({ apiKey: "env:OLLAMA_API_KEY" })],
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
      assert.equal(first.status, "completed", `first turn: ${first.text}`);
      assert.ok(executed.length >= 1, "did not call echo_value");
      assert.ok(
        first.messages.some((message) => message.content.some((block) => block.type === "tool_result")),
        "first turn kept no tool result",
      );

      const second = await session.run("What number did the tool echo? Answer with the number only.");
      assert.equal(second.status, "completed", `second turn: ${second.text}`);
      assert.match(second.text, /7/, "second turn lost the tool result");

      const image: Message = {
        role: "user",
        content: [
          { type: "image", mimeType: "image/png", data: PNG },
          { type: "text", text: "What color is this square? One word." },
        ],
      };
      const third = await session.run([image]);
      assert.equal(third.status, "completed", `image turn: ${third.text}`);
      assert.match(third.text.toLowerCase(), /red/, "image turn did not see the square");

      assert.equal(JSON.stringify([first, second, third]).includes(process.env.OLLAMA_API_KEY!), false, "result leaked the API key");
      await agent.dispose();
    },
    180_000,
  );
});
