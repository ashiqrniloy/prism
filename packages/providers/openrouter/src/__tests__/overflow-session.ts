import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import { providerPackage, replayFetch, type RecordedExchange } from "@arnilo/prism/provider-kit";
import { createOpenRouterProvider } from "../index.js";

export async function openAIOverflowSession(recording: RecordedExchange): Promise<void> {
  const ok = {
    path: recording.path,
    status: 200,
    contentType: "text/event-stream",
    responseBody:
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
  };
  let calls = 0;
  const replay = replayFetch([recording, ok]);
  const provider = createOpenRouterProvider({
    apiKey: "test-key",
    fetch: (async (url, init) => {
      calls++;
      return replay(url, init);
    }) as typeof fetch,
  });
  const agent = await createAgent({
    model: { provider: "openrouter", model: "test", limits: { contextWindow: 2000, maxOutputTokens: 100 } },
    packages: [providerPackage("test-openrouter", [provider])],
    compaction: { keepRecentEntries: 1 },
  });
  try {
    const session = await agent.session();
    const result = await session.run("a long request");
    assert.equal(result.status, "completed");
    assert.equal(calls, 2);
    const entries = await session.entries();
    assert.equal(entries.filter((entry) => entry.kind === "compaction").length, 1);
  } finally {
    await agent.dispose();
  }
}
