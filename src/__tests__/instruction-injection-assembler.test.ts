import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleProviderInput,
  createSecretRedactor,
  redactProviderRequest,
  type ContextBlock,
  type InstructionInjector,
  type Message,
  type ProviderRequest,
} from "../index.js";

const MODEL = { provider: "mock", model: "demo" };
const text = (m: Message) => m.content.find((p) => p.type === "text")?.text ?? "";
const systemTexts = (r: ProviderRequest) =>
  r.messages.filter((m) => m.role === "system").map(text);
const blockIds = (blocks: readonly ContextBlock[] | undefined) => (blocks ?? []).map((b) => b.id).filter(Boolean);

function injectedRequest(opts: {
  input?: Message | string;
  turn?: number;
  injectors?: readonly InstructionInjector[];
  history?: Message[];
  systemInstructions?: string;
  contextProviders?: readonly { name: string; resolve: () => readonly ContextBlock[] }[];
}): Promise<ProviderRequest> {
  return assembleProviderInput({
    model: MODEL,
    input: opts.input ?? "hi",
    history: opts.history,
    turn: opts.turn,
    systemInstructions: opts.systemInstructions,
    instructionInjectors: opts.injectors,
    contextProviders: opts.contextProviders as never,
    sessionId: "s",
    runId: "r",
    signal: new AbortController().signal,
  });
}

describe("assembleProviderInput instruction injector integration (Phase 30 Task 6)", () => {
  it("every_turn instructions appear on turn 1 and turn 2", async () => {
    const json: InstructionInjector = { name: "json", apply: () => ({ instructions: "Always answer in JSON", when: "every_turn" }) };
    const r1 = await injectedRequest({ injectors: [json], turn: 1 });
    const r2 = await injectedRequest({ injectors: [json], turn: 2 });
    assert.ok(systemTexts(r1).some((t) => t.includes("Always answer in JSON")));
    assert.ok(systemTexts(r2).some((t) => t.includes("Always answer in JSON")));
  });

  it("first_turn contextBlocks contribute only when turn === 1", async () => {
    const schema: InstructionInjector = {
      name: "schema",
      apply: () => ({ contextBlocks: [{ id: "schema-block", title: "Schema", content: "type T = string" }], when: "first_turn" }),
    };
    const r1 = await injectedRequest({ injectors: [schema], turn: 1 });
    const r2 = await injectedRequest({ injectors: [schema], turn: 2 });
    assert.ok(blockIds(r1.context).includes("schema-block"));
    assert.ok(!blockIds(r2.context).includes("schema-block"), "first_turn block leaked into turn 2");
  });

  it("on_input with predicate contributes only when predicate matches", async () => {
    const schemaAware: InstructionInjector = {
      name: "schema-aware",
      apply: () => ({ instructions: "Use the schema", when: "on_input", predicate: (ctx) => ctx.input.some((m) => m.content.some((b) => b.type === "text" && b.text.includes("schema"))) }),
    };
    const matching = await injectedRequest({ injectors: [schemaAware], turn: 1, input: "define the schema" });
    const nonMatching = await injectedRequest({ injectors: [schemaAware], turn: 1, input: "hello" });
    assert.ok(systemTexts(matching).some((t) => t.includes("Use the schema")));
    assert.ok(!systemTexts(nonMatching).some((t) => t.includes("Use the schema")), "on_input predicate ignored");
  });

  it("on_input without predicate contributes every turn (default)", async () => {
    const noPred: InstructionInjector = { name: "always", apply: () => ({ instructions: "X", when: "on_input" }) };
    const r1 = await injectedRequest({ injectors: [noPred], turn: 1 });
    const r3 = await injectedRequest({ injectors: [noPred], turn: 3 });
    assert.ok(systemTexts(r1).some((t) => t.includes("X")));
    assert.ok(systemTexts(r3).some((t) => t.includes("X")));
  });

  it("injector instructions layer after host systemInstructions via composeSystemPrompt", async () => {
    const json: InstructionInjector = { name: "json", apply: () => ({ instructions: "INJECTOR", when: "every_turn" }) };
    const r = await injectedRequest({ injectors: [json], systemInstructions: "HOST", turn: 1 });
    const sys = systemTexts(r).join("\n");
    assert.ok(sys.includes("HOST") && sys.includes("INJECTOR"));
    assert.ok(sys.indexOf("HOST") < sys.indexOf("INJECTOR"), "host instructions should precede injector instructions");
  });

  it("injector contextBlocks merge after host+skill provider blocks", async () => {
    const host: { name: string; resolve: () => readonly ContextBlock[] } = {
      name: "host", resolve: () => [{ id: "host-block", content: "host" }],
    };
    const inj: InstructionInjector = {
      name: "extra", apply: () => ({ contextBlocks: [{ id: "inj-block", content: "inj" }], when: "every_turn" }),
    };
    const r = await injectedRequest({ injectors: [inj], contextProviders: [host], turn: 1 });
    const ids = blockIds(r.context);
    assert.deepEqual(ids, ["host-block", "inj-block"], "injector blocks should follow host provider blocks");
  });

  it("custom InputBuilder receives instructionInjectors and turn in its context", async () => {
    const json: InstructionInjector = { name: "json", apply: () => ({ instructions: "JSON", when: "every_turn" }) };
    let seenTurn: number | undefined;
    let seenCount: number | undefined;
    await assembleProviderInput({
      model: MODEL,
      input: "hi",
      turn: 2,
      instructionInjectors: [json],
      inputBuilder: {
        name: "custom",
        build: (_input, context) => {
          // ponytail: custom builder can read injector list + turn via DefaultInputBuildContext.
          const ctx = context as { instructionInjectors?: readonly InstructionInjector[]; turn?: number };
          seenCount = ctx.instructionInjectors?.length;
          seenTurn = ctx.turn;
          return [{ role: "user", content: [{ type: "text", text: "custom" }] }];
        },
      },
    });
    assert.equal(seenCount, 1);
    assert.equal(seenTurn, 2);
  });

  it("injector-produced text is passed through redactProviderRequest (secret redacted)", async () => {
    const secret = "SUPERSECRET-key";
    const leaky: InstructionInjector = {
      name: "leak", apply: () => ({ instructions: `token=${secret}`, when: "every_turn" }),
    };
    const r = await injectedRequest({ injectors: [leaky], turn: 1 });
    const redacted = redactProviderRequest(r, createSecretRedactor([secret]));
    assert.equal(JSON.stringify(redacted).includes(secret), false, "injector instructions secret leaked past redaction");
  });

  it("contribution fields beyond instructions/contextBlocks/when/predicate are ignored (no privilege)", async () => {
    // ponytail: an injector that returns extra fields grants nothing — only text/blocks honored.
    const rogue = { name: "rogue", apply: () => ({ instructions: "ok", when: "every_turn", tools: ["rm-rf"] } as never) } as InstructionInjector;
    const r = await injectedRequest({ injectors: [rogue], turn: 1 });
    assert.ok(systemTexts(r).some((t) => t.includes("ok")));
    assert.equal(r.tools, undefined, "injector must not grant tools");
    assert.equal((r.context ?? []).length, 0);
  });
});
