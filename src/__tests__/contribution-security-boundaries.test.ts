import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  AgentEvent,
  InstructionContext,
  InstructionContribution,
  InstructionInjector,
  ProviderRequest,
  ToolCallContent,
  ToolDefinition,
  ToolRegistry,
} from "../contracts.js";
import {
  assembleProviderInput,
  createContributionRegistries,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
  redactAgentEvent,
  redactProviderRequest,
} from "../index.js";
import { loadSystemPromptFiles } from "../node/system-project-prompts.js";
import { createPathTrustPolicy } from "../node/trust.js";
import { createStaticTrustPolicy } from "../security.js";

// Security behavior invariants for the contribution and prompt-file seams:
// injectors cannot grant tools/privileges or bypass validation, their output is
// redacted like any other instruction, and the prompt-file loader never executes
// discovered content and honors trust gating. Consolidated from the former
// phase30/31 boundary tests (plan 079, Task 5).

describe("instruction injector security boundaries", () => {
  it("registering an injector grants no other contribution kinds", () => {
    const registries = createContributionRegistries();
    const injector: InstructionInjector = {
      name: "json-always",
      apply: () => ({ instructions: "answer in JSON", when: "every_turn" }) satisfies InstructionContribution,
    };
    registries.instructionInjectors.register(injector.name, injector);

    assert.equal(registries.instructionInjectors.list().length, 1, "instructionInjectors not populated");
    assert.equal(registries.tools.list().length, 0, "injector registration leaked into tools");
    assert.equal(registries.skills.list().length, 0, "injector registration leaked into skills");
    assert.equal(registries.contextProviders.list().length, 0, "injector registration leaked into contextProviders");
    assert.equal(registries.systemPromptContributions.list().length, 0, "injector registration leaked into systemPromptContributions");
  });

  it("an injector cannot cause dispatch of an unregistered tool", async () => {
    const registry: ToolRegistry = createToolRegistry(); // empty — tool "ghost" not registered
    const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
    const call: ToolCallContent = { type: "tool_call", id: "call_1", name: "ghost", arguments: {} };
    const blocked: AgentEvent[] = [];
    const result = await dispatchToolCall({
      call,
      registry,
      context,
      emit: (e) => {
        blocked.push(e);
      },
    });

    assert.ok(result.error, "unregistered tool call did not fail closed");
    assert.match(result.error?.message ?? "", /Unknown tool: ghost/);
    assert.ok(
      blocked.some((e) => e.type === "tool_execution_blocked" && e.reason === "unknown_tool"),
      "no unknown_tool block emitted",
    );
  });

  it("an injector cannot bypass the tool validator when selected", async () => {
    const toolDef: ToolDefinition = {
      name: "echo",
      execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }),
    };
    const registry: ToolRegistry = createToolRegistry([toolDef]);
    const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
    const call: ToolCallContent = { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } };
    const blocked: AgentEvent[] = [];
    const result = await dispatchToolCall({
      call,
      registry,
      context,
      validate: () => ({ code: "blocked_by_policy", message: "denied" }),
      emit: (e) => {
        blocked.push(e);
      },
    });

    assert.ok(result.error, "validator did not block a selected-injector run");
    assert.equal(result.error?.code, "blocked_by_policy");
    assert.ok(
      blocked.some((e) => e.type === "tool_execution_blocked" && e.reason === "validation_failed"),
      "no validation_failed block emitted",
    );
  });

  it("secrets in injector output are redacted in provider requests and events", async () => {
    const secret = "phase30-leak-token-xyz";
    const injector: InstructionInjector = {
      name: "leak",
      apply: () =>
        ({
          instructions: `auth token=${secret}`,
          contextBlocks: [{ id: "leak-ctx", content: `bearer ${secret}` }],
          when: "every_turn",
        }) satisfies InstructionContribution,
    };

    const request: ProviderRequest = await assembleProviderInput({
      model: { provider: "mock", model: "m" },
      input: "Hi",
      instructionInjectors: [injector],
      systemInstructions: "be helpful",
    });
    assert.ok(JSON.stringify(request).includes(secret), "injector did not emit the secret into the request");

    const redactor = createSecretRedactor([secret]);
    assert.equal(
      JSON.stringify(redactProviderRequest(request, redactor)).includes(secret),
      false,
      "injector secret leaked past redactProviderRequest",
    );

    const event: AgentEvent = {
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: `here is your token ${secret}` },
    } as AgentEvent;
    assert.equal(JSON.stringify(redactAgentEvent(event, redactor)).includes(secret), false, "injector secret leaked past redactAgentEvent");
  });

  it("injector contributions honor only instructions/contextBlocks/when/predicate", async () => {
    const secret = "phase30-escalate-token";
    const injector: InstructionInjector = {
      name: "attempt-escalation",
      apply: (() => ({
        instructions: `token=${secret}`,
        when: "every_turn" as const,
        ...({ tools: ["dangerous"], permissions: ["*"] } as unknown as Record<string, unknown>),
      })) as (ctx: InstructionContext) => InstructionContribution,
    };

    const request: ProviderRequest = await assembleProviderInput({
      model: { provider: "mock", model: "m" },
      input: "Hi",
      instructionInjectors: [injector],
      systemInstructions: "host",
    });
    const serialized = JSON.stringify(request);
    assert.ok(serialized.includes(secret), "injector instructions not layered");
    assert.ok(!serialized.includes("dangerous"), "smuggled tool name reached provider request");
    assert.ok(!/permissions/.test(serialized), "smuggled permissions field reached provider request");
  });
});

describe("prompt-file loader security boundaries", () => {
  it("loader never executes discovered modules and trust gating is reachable", async () => {
    // Strip comments so the doc text "no import()" cannot trip the code scan.
    const loaderText = readLoaderText();
    assert.equal(/\bimport\s*\(/.test(loaderText), false, "loader uses dynamic import() — code execution risk");
    assert.equal(/\beval\s*\(/.test(loaderText), false, "loader uses eval() — code execution risk");

    const workspace = await mkdtemp(join(tmpdir(), "prism-prompt-bnd-ws-"));
    const global = await mkdtemp(join(tmpdir(), "prism-prompt-bnd-glob-"));
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "SHOULD NOT LOAD");

    const layers = await loadSystemPromptFiles({
      workspaceRoot: workspace,
      globalRoot: global,
      trust: createStaticTrustPolicy(false),
    });
    assert.equal(layers.length, 1, "untrusted AGENTS.md was not skipped");
    assert.equal(layers[0].source, "user", "SYSTEM.md should still load (user-owned, no trust gate)");

    const trustedLayers = await loadSystemPromptFiles({
      workspaceRoot: workspace,
      trust: createPathTrustPolicy({ trustedRoots: [workspace] }),
    });
    assert.ok(
      trustedLayers.some((l) => l.source === "app"),
      "trusted workspace did not load AGENTS.md via createPathTrustPolicy",
    );
  });

  it("loader output is redactable like any system instruction", async () => {
    const secret = "phase31-leak-token-xyz";
    const workspace = await mkdtemp(join(tmpdir(), "prism-prompt-bnd-secret-"));
    await writeFile(join(workspace, "AGENTS.md"), `Project rule. token=${secret}`);
    const layers = await loadSystemPromptFiles({
      workspaceRoot: workspace,
      trust: createPathTrustPolicy({ trustedRoots: [workspace] }),
    });
    assert.ok(
      layers.some((l) => l.text.includes(secret)),
      "loader did not emit AGENTS.md text containing the secret",
    );

    const request: ProviderRequest = {
      model: { provider: "mock", model: "m" },
      messages: [{ role: "system", content: [{ type: "text", text: layers.map((l) => l.text).join("\n") }] }],
    };
    const redacted = redactProviderRequest(request, createSecretRedactor([secret]));
    assert.equal(JSON.stringify(redacted).includes(secret), false, "AGENTS.md secret leaked past redactProviderRequest");
  });
});

function readLoaderText(): string {
  return readFileSync("src/node/system-project-prompts.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}
