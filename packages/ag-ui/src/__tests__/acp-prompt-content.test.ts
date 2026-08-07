/**
 * Phase 10 Task 6 — rich prompt content, diffs, locations.
 * Prompt: text + resource_link baseline; image/audio/embedded gated on the
 * advertised promptCapabilities + live host policy; media bounded by frozen
 * part/byte caps; malformed MIME/base64 fail closed. The host session receives
 * a prism user Message with text + media content blocks.
 * Mapper: tool_call_update gains locations and diff content only from the
 * projection allow-list, capped at acpLocationsPerUpdate/acpDiffBytes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createSecretRedactor, toolCallContent } from "@arnilo/prism";
import type { AgentSession } from "@arnilo/prism";
import { createAcpEventMapper, createPrismAcpAgent, type CreatePrismAcpAgentOptions } from "../acp/index.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB").toString("base64");
const WAV = Buffer.from("RIFFxxxxWAVEfmt").toString("base64");

const authorization = { ownership: { userId: "user-1" } };

function recordingSession(id: string): { session: AgentSession; inputs: unknown[] } {
  const inputs: unknown[] = [];
  const session = {
    id,
    async *stream(input: unknown) {
      inputs.push(input);
    },
  } as unknown as AgentSession;
  return { session, inputs };
}

async function runPrompt(
  agent: ReturnType<typeof createPrismAcpAgent>,
  prompt: readonly Record<string, unknown>[],
): Promise<{ stopReason: string }> {
  let result: { stopReason: string } | undefined;
  const acpClient = client();
  await acpClient.connectWith(agent, async (connection) => {
    await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
    const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
    result = await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: prompt as never });
  });
  return result!;
}

function makeAgent(overrides: Partial<CreatePrismAcpAgentOptions> = {}): {
  app: ReturnType<typeof createPrismAcpAgent>;
  inputs: unknown[][];
} {
  const inputs: unknown[][] = [];
  let created = 0;
  const app = createPrismAcpAgent({
    authorize: () => authorization,
    sessionFactory: () => {
      const { session, inputs: captured } = recordingSession(`host-${++created}`);
      inputs.push(captured);
      return { session };
    },
    lifecycle: {} as never,
    capabilities: { prompt: { media: () => true, embedded: () => true } },
    ...overrides,
  });
  return { app, inputs };
}

function rejectsWith(promise: Promise<unknown>, text: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code: number }).code, -32603);
    assert.ok(String((error as { data?: { details?: unknown } }).data?.details).includes(text));
    return true;
  });
}

describe("ACP rich prompt content (Task 6)", () => {
  it("forwards text plus image and audio blocks to the host as a prism Message", async () => {
    const { app, inputs } = makeAgent();
    await runPrompt(app, [
      { type: "text", text: "see " },
      { type: "image", mimeType: "image/png", data: PNG },
      { type: "audio", mimeType: "audio/wav", data: WAV },
    ]);
    const message = inputs[0]![0] as { role: string; content: unknown[] };
    assert.equal(message.role, "user");
    assert.deepEqual(
      (message.content as Array<{ type: string }>).map((block) => block.type),
      ["text", "image", "audio"],
    );
    const image = (message.content as Array<{ type: string; mimeType?: string; data?: string }>)[1]!;
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.data, PNG);
    const text = (message.content as Array<{ type: string; text?: string }>)[0]!;
    assert.equal(text.text, "see ");
  });

  it("accepts resource_link and embedded text/blobs per baseline and embeddedContext", async () => {
    const { app, inputs } = makeAgent();
    await runPrompt(app, [
      { type: "resource_link", name: "docs", uri: "file:///docs" },
      { type: "resource", resource: { uri: "file:///r.txt", text: "hello" } },
      { type: "resource", resource: { uri: "file:///r.bin", blob: PNG, mimeType: "image/png" } },
    ]);
    const message = inputs[0]![0] as { content: Array<{ type: string; text?: string; mediaType?: string; data?: string }> };
    assert.equal(message.content[0].type, "text");
    assert.match(message.content[0].text!, /\[resource_link: docs \(file:\/\/\/docs\)\]/);
    assert.match(message.content[0].text!, /\[resource: file:\/\/\/r.txt\]\nhello/);
    assert.equal(message.content[1].type, "file");
    assert.equal(message.content[1].mediaType, "image/png");
    assert.equal(message.content[1].data, PNG);
  });

  it("rejects image/audio without the agent advertisement (CAPABILITY)", async () => {
    const { app } = makeAgent({ capabilities: undefined });
    await rejectsWith(
      runPrompt(app, [{ type: "image", mimeType: "image/png", data: PNG }]),
      "without advertising promptCapabilities.image",
    );
    await rejectsWith(
      runPrompt(app, [{ type: "audio", mimeType: "audio/wav", data: WAV }]),
      "without advertising promptCapabilities.audio",
    );
    await rejectsWith(
      runPrompt(app, [{ type: "resource", resource: { uri: "file:///r", text: "x" } }]),
      "without advertising promptCapabilities.embeddedContext",
    );
  });

  it("rejects media when the live host policy denies (POLICY)", async () => {
    const { app } = makeAgent({ capabilities: { prompt: { media: () => false, embedded: () => true } } });
    await rejectsWith(runPrompt(app, [{ type: "image", mimeType: "image/png", data: PNG }]), "host media policy denied");
    const { app: app2 } = makeAgent({ capabilities: { prompt: { media: () => true, embedded: () => false } } });
    await rejectsWith(runPrompt(app2, [{ type: "resource", resource: { uri: "file:///r", text: "x" } }]), "host embedded policy denied");
  });

  it("bounds media parts and bytes before any provider call", async () => {
    const { app, inputs } = makeAgent();
    const parts = Array.from({ length: 17 }, () => ({ type: "image" as const, mimeType: "image/png", data: PNG }));
    await rejectsWith(runPrompt(app, parts), "media parts exceed");
    assert.equal(inputs[0]!.length, 0);

    const big = Buffer.alloc(70 * 1024, 1).toString("base64");
    await rejectsWith(runPrompt(app, [{ type: "image", mimeType: "image/png", data: big }]), "byte limit");
    assert.equal(inputs[0]!.length, 0);
  });

  it("rejects malformed MIME and base64 payloads (INPUT)", async () => {
    const { app } = makeAgent();
    await rejectsWith(runPrompt(app, [{ type: "image", mimeType: "text/plain", data: PNG }]), "invalid mimeType");
    await rejectsWith(runPrompt(app, [{ type: "image", mimeType: "image/png", data: "not-base64!" }]), "not valid base64");
  });

  it("bounds text bytes and block counts", async () => {
    const { app, inputs } = makeAgent();
    const huge = "x".repeat(70 * 1024);
    await rejectsWith(runPrompt(app, [{ type: "text", text: huge }]), "text exceeds");
    assert.equal(inputs[0]!.length, 0);
  });

  it("omits media when the prompt has none and still streams plain text", async () => {
    const { app, inputs } = makeAgent();
    await runPrompt(app, [{ type: "text", text: "go" }]);
    const message = inputs[0]![0] as { content: unknown[] };
    assert.equal(message.content.length, 1);
  });
});

describe("ACP mapper diff and locations (Task 6)", () => {
  const finished = (result: unknown) => ({
    type: "tool_execution_finished" as const,
    sessionId: "session-1",
    runId: "run-1",
    result: result as never,
    metadata: { durationMs: 1, status: "finished" as const },
  });

  it("attaches locations from the projection allow-list, capped at acpLocationsPerUpdate", async () => {
    const mapper = createAcpEventMapper({
      limits: { acpLocationsPerUpdate: 2 },
      projection: {
        toolLocations: () => [{ path: "/a.ts", line: 1 }, { path: "/b.ts" }, { path: "/c.ts" }],
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    const update = output[0] as { sessionUpdate: string; locations: Array<{ path: string; line?: number }> };
    assert.equal(update.sessionUpdate, "tool_call_update");
    assert.deepEqual(update.locations, [{ path: "/a.ts", line: 1 }, { path: "/b.ts" }]);
  });

  it("drops invalid location entries and keeps no locations when the hook is absent", async () => {
    const mapper = createAcpEventMapper({
      projection: {
        toolLocations: () => [{ path: "" }, { path: "/ok.ts", line: -1 }, { path: "/ok2.ts", line: 3 }],
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    assert.deepEqual((output[0] as { locations?: unknown }).locations, [{ path: "/ok2.ts", line: 3 }]);

    const plain = createAcpEventMapper();
    const without = await plain.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    assert.equal((without[0] as { locations?: unknown }).locations, undefined);
    assert.equal((without[0] as { content?: unknown }).content, undefined);
  });

  it("attaches one projected diff, redacted and capped at acpDiffBytes", async () => {
    const mapper = createAcpEventMapper({
      redactor: createSecretRedactor(["TOKEN"]),
      limits: { acpDiffBytes: 1024 },
      projection: {
        toolResult: () => "done",
        toolDiff: () => ({ path: "/a.ts", oldText: "old TOKEN", newText: "new TOKEN" }),
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    const update = output[0] as {
      content: Array<{ type: string; path?: string; oldText?: string; newText?: string; content?: { text?: string } }>;
    };
    assert.equal(update.content[0].type, "content");
    assert.equal(update.content[0].content?.text, "done");
    assert.deepEqual(update.content[1], { type: "diff", path: "/a.ts", oldText: "old [REDACTED]", newText: "new [REDACTED]" });
  });

  it("drops an oversized diff and malformed projections fail closed", async () => {
    const mapper = createAcpEventMapper({
      limits: { acpDiffBytes: 1024 },
      projection: {
        toolDiff: () => ({ path: "/a.ts", newText: "y".repeat(5000) }),
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    const update = output[0] as { content?: unknown };
    assert.equal(update.content, undefined);

    const throwing = createAcpEventMapper({
      projection: {
        toolLocations: () => {
          throw new Error("boom");
        },
        toolDiff: () => ({ path: "", newText: "" }),
      },
    });
    const safe = await throwing.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    assert.equal((safe[0] as { locations?: unknown }).locations, undefined);
    assert.equal((safe[0] as { content?: unknown }).content, undefined);
  });

  it("combines locations with the existing stable text update flow", async () => {
    const mapper = createAcpEventMapper({
      projection: {
        toolResult: (result) => String((result as { value?: number }).value),
        toolLocations: () => [{ path: "/x.ts" }],
      },
    });
    const call = toolCallContent("tool-1", "write", { path: "/x.ts" });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "write", value: 7 }));
    const update = output[0] as { sessionUpdate: string; locations?: unknown; content?: Array<{ content?: { text?: string } }> };
    assert.equal(update.sessionUpdate, "tool_call_update");
    assert.deepEqual(update.locations, [{ path: "/x.ts" }]);
    assert.equal(update.content![0]!.content!.text, "7");
  });
});
