import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createContributionRegistry, createMockProvider, providerDone, providerTextDelta } from "../index.js";
import { runRpcServer } from "../rpc.js";
import type { InstructionInjector, ProviderRequest } from "../contracts.js";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  lines(): unknown[] { return this.chunks.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
}

const jsonInjector: InstructionInjector = {
  name: "json-always",
  apply: () => ({ instructions: "Always answer in JSON", when: "every_turn" }),
};

function capturingFactory(captured: ProviderRequest[]) {
  return {
    createSession(id?: string) {
      const provider = createMockProvider([{ type: "done" }], { onRequest: (req) => { captured.push(req); } });
      return createAgent({ model: { provider: "mock", model: "demo" }, provider }).createSession({ id });
    },
  };
}

function textOf(request: ProviderRequest): string {
  return request.messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content]))
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

async function runRpc(input: string, factory: { createSession(id?: string): any }): Promise<unknown[]> {
  const stdout = new MemoryWritable();
  await runRpcServer({ stdin: Readable.from(input), stdout, createSession: factory.createSession });
  return stdout.lines();
}

describe("rpc instructionInjectors (Phase 30 Task 8)", () => {
  it("prompt with instructionInjectors names resolves them against the registry", async () => {
    const captured: ProviderRequest[] = [];
    const registry = createContributionRegistry<InstructionInjector>({ label: "instruction injector" });
    registry.register("json-always", jsonInjector);
    const factory = capturingFactory(captured);

    const stdout = new MemoryWritable();
    await runRpcServer({
      stdin: Readable.from(JSON.stringify({ id: "1", command: "prompt", params: { input: "Hi", instructionInjectors: ["json-always"] } }) + "\n"),
      stdout,
      createSession: factory.createSession,
      instructionInjectors: registry,
    });
    const lines = stdout.lines();

    assert.ok(lines.some((l: any) => l.id === "1" && l.ok === true), "expected success response");
    assert.ok(captured.length >= 1, "provider was called");
    assert.match(textOf(captured[0]), /Always answer in JSON/);
  });

  it("prompt with instructionInjectors: ['missing'] fails closed (error correlation)", async () => {
    const captured: ProviderRequest[] = [];
    const registry = createContributionRegistry<InstructionInjector>({ label: "instruction injector" });
    const factory = capturingFactory(captured);

    const stdout = new MemoryWritable();
    await runRpcServer({
      stdin: Readable.from(JSON.stringify({ id: "2", command: "prompt", params: { input: "Hi", instructionInjectors: ["missing"] } }) + "\n"),
      stdout,
      createSession: factory.createSession,
      instructionInjectors: registry,
    });
    const lines = stdout.lines();

    const err = lines.find((l: any) => l.id === "2" && l.ok === false);
    assert.ok(err, "expected an error response correlated to id 2");
    assert.match((err as any).error.message, /Unknown instruction injector: missing/);
    assert.equal(captured.length, 0, "provider must not be called on a fail-closed resolution");
  });

  it("prompt without instructionInjectors behaves as today (no injectors)", async () => {
    const captured: ProviderRequest[] = [];
    const registry = createContributionRegistry<InstructionInjector>({ label: "instruction injector" });
    registry.register("json-always", jsonInjector);
    const factory = capturingFactory(captured);

    const stdout = new MemoryWritable();
    await runRpcServer({
      stdin: Readable.from(JSON.stringify({ id: "3", command: "prompt", params: { input: "Hi" } }) + "\n"),
      stdout,
      createSession: factory.createSession,
      instructionInjectors: registry,
    });
    const lines = stdout.lines();

    assert.ok(lines.some((l: any) => l.id === "3" && l.ok === true));
    assert.ok(captured.length >= 1);
    assert.doesNotMatch(textOf(captured[0]), /Always answer in JSON/);
  });
});
