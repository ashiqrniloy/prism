import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type AgentEvent, type Message } from "@arnilo/prism";
import { litellm } from "../index.js";

const baseUrl = process.env.PRISM_LIVE_LITELLM_BASE_URL ?? "http://127.0.0.1:4000";
const modelId = process.env.PRISM_LIVE_LITELLM_MODEL ?? "prism-free/gpt-oss-20b@groq";
const imageModelId = process.env.PRISM_LIVE_LITELLM_IMAGE_MODEL;

async function unreachableReason(): Promise<string | false> {
  if (process.env.PRISM_LIVE_PROVIDER_TESTS !== "1") return "PRISM_LIVE_PROVIDER_TESTS is not 1";
  if (!process.env.LITELLM_API_KEY) return "LITELLM_API_KEY is not set";
  try {
    const response = await fetch(`${baseUrl}/health/liveliness`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? false : `proxy at ${baseUrl} answered ${response.status}`;
  } catch {
    return `no LiteLLM proxy at ${baseUrl}`;
  }
}

const skip = await unreachableReason();

// 64x64 red PNG: standard raster fixture.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

describe("@arnilo/prism-provider-litellm live agent kernel smoke", () => {
  it.skipIf(skip !== false)(
    "live_agent_multi_turn_tool_session_and_telemetry",
    async () => {
      const executed: string[] = [];
      const collectedEvents: AgentEvent[] = [];

      const agentModel = modelId.startsWith("litellm/") ? modelId : `litellm/${modelId}`;

      const agent = await createAgent({
        id: "litellm-live-agent-smoke",
        model: agentModel,
        packages: [
          litellm({
            baseUrl,
            apiKey: "env:LITELLM_API_KEY",
          }),
        ],
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
      const subscription = session.subscribe();
      const pump = (async () => {
        for await (const event of subscription) collectedEvents.push(event);
      })();

      // Turn 1: tool call
      const first = await session.run("Call echo_value with value 7, then say done.");
      assert.equal(first.status, "completed", `first turn status: ${first.text}`);
      assert.ok(executed.length >= 1, "did not call echo_value tool");
      assert.ok(
        first.messages.some((message) => message.content.some((block) => block.type === "tool_result")),
        "first turn kept no tool result",
      );

      // Turn 2: answer from tool result
      const second = await session.run("What number did the tool echo? Answer with the number only.");
      assert.equal(second.status, "completed", `second turn status: ${second.text}`);
      assert.match(second.text, /7/, "second turn lost the tool result");

      await session.close();
      await pump;

      // Filter turn.completed events that carry usage
      const turnCompletedEvents = collectedEvents.filter(
        (event) => event.type === "turn.completed" && event.usage !== undefined,
      );
      assert.ok(turnCompletedEvents.length >= 2, `expected at least 2 turn.completed events, got ${turnCompletedEvents.length}`);

      for (const event of turnCompletedEvents) {
        if (event.type !== "turn.completed") continue;
        const litellmMeta = event.usage?.metadata?.litellm as { callId?: string; modelId?: string } | undefined;
        assert.ok(litellmMeta, "turn.completed usage missing metadata.litellm");
        assert.ok(typeof litellmMeta.callId === "string" && litellmMeta.callId.length > 0, "usage missing litellm.callId");
        assert.ok(typeof litellmMeta.modelId === "string" && litellmMeta.modelId.length > 0, "usage missing litellm.modelId");
      }

      // Optional image turn if image model configured
      if (imageModelId) {
        const imageMessage: Message = {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: PNG },
            { type: "text", text: "What color is this square? One word." },
          ],
        };
        const imageAgent = await createAgent({
          id: "litellm-live-image-smoke",
          model: imageModelId,
          packages: [litellm({ baseUrl, apiKey: "env:LITELLM_API_KEY" })],
        });
        const imageSession = await imageAgent.session();
        const third = await imageSession.run([imageMessage]);
        assert.equal(third.status, "completed", `image turn: ${third.text}`);
        assert.match(third.text.toLowerCase(), /red/, "image turn did not identify red");
        await imageAgent.dispose();
      }

      // Assert no secret leak in outputs
      const key = process.env.LITELLM_API_KEY;
      if (key) {
        const dumped = JSON.stringify([first, second, collectedEvents]);
        assert.equal(dumped.includes(key), false, "telemetry or turn output leaked LITELLM_API_KEY");
      }

      await agent.dispose();
    },
    180_000,
  );
});
