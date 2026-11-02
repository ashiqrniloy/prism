/**
 * Plan 202 Task 16 (F9): an opt-in live OM worker smoke. It runs only when the owner sets
 * PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1, so the ordinary suite stays hermetic.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { createOpenCodeGoProvider, openCodeGoModels } from "@arnilo/prism-provider-opencode-go";

import { runObserver } from "../../packages/memory/observational/src/workers/observer.ts";
import { runReflector } from "../../packages/memory/observational/src/workers/reflector.ts";

const enabled = process.env.PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS === "1";
const modelId = process.env.PRISM_LIVE_OPENCODE_GO_CHAT_MODEL ?? "mimo-v2.5";
const apiKey = process.env.OPENCODE_GO_API_KEY;

function liveClient() {
  assert.ok(apiKey, "OPENCODE_GO_API_KEY is required");
  const catalog = openCodeGoModels.find((entry) => entry.model === modelId) ?? {
    provider: "opencode-go",
    model: modelId,
    limits: { contextWindow: 128_000, maxOutputTokens: 1024 },
  };
  const provider = createOpenCodeGoProvider({ apiKey: () => apiKey });
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      model: catalog,
      async *generate(request) {
        calls += 1;
        yield* provider.generate({ ...request, model: catalog });
      },
    },
  };
}

const source = {
  id: "live-source-1",
  sessionId: "live-om",
  timestamp: "2026-11-02T00:00:00.000Z",
  kind: "message",
  message: {
    role: "user",
    content: [{ type: "text", text: "Remember: the staging deploy always runs on Friday at 09:00 UTC." }],
  },
};

test.skipIf(!enabled)(
  "observational_live_observer_and_reflector_complete",
  async () => {
    const observer = liveClient();
    const observations = await runObserver({
      entries: [source],
      client: observer.client,
      maxTurns: 4,
      sessionId: "live-om",
    });
    assert.ok(observer.calls() > 0, "the observer reached the live provider");
    assert.ok(observations.length > 0, "the observer recorded a source-backed observation");
    assert.ok(observations[0]?.sourceEntryIds.includes(source.id), "the observation cites its source");

    const reflector = liveClient();
    await runReflector({
      observations,
      client: reflector.client,
      maxTurns: 4,
      sessionId: "live-om",
    });
    assert.ok(reflector.calls() > 0, "the reflector reached the live provider");
  },
  180_000,
);
