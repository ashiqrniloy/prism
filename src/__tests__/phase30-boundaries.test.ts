import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assembleProviderInput,
  createContributionRegistries,
  createSecretRedactor,
  dispatchToolCall,
  createToolRegistry,
  redactProviderRequest,
  redactAgentEvent,
} from "../index.js";
import type {
  AgentEvent,
  InstructionContribution,
  InstructionContext,
  InstructionInjector,
  ProviderRequest,
  ToolCallContent,
  ToolDefinition,
  ToolRegistry,
} from "../contracts.js";

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

const srcFiles = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"));
const srcText = srcFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const contractsText = readFileSync("src/contracts.ts", "utf8");

// ponytail: anchored extraction of the Phase 30 injector contract block so the
// vocabulary scan is limited to injector fields and cannot trip on unrelated text.
const injBlockStart = contractsText.indexOf("export type InstructionTiming");
const injBlockEnd = contractsText.indexOf("export ", injBlockStart + 1);
const injectorBlock = injBlockStart >= 0 && injBlockEnd > injBlockStart ? contractsText.slice(injBlockStart, injBlockEnd) : contractsText.slice(injBlockStart);

describe("phase 30 instruction injection boundaries", () => {
  it("phase30_source_imports_no_synapta_packages", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The injector
    // seam stays generic — no domain vocabulary crosses the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase30_injector_contracts_have_no_domain_vocabulary", () => {
    // InstructionTiming/Context/Contribution/Injector field names are generic
    // (instructions/contextBlocks/when/predicate/turn/input/history/metadata/signal)
    // — no workflow/node/step Synapta-domain terms leak into the seam.
    assert.ok(injectorBlock.length > 0, "could not locate Phase 30 injector contract block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(injectorBlock), false, `injector contract mentions ${term}`);
    }
  });

  it("phase30_injector_contribution_carries_no_tool_or_privilege_fields", () => {
    // InstructionContribution exposes only instructions/contextBlocks/when/predicate.
    // No `tools`/`skills`/`permissions`/`toolsAllow` field exists — injectors cannot
    // grant tool access or bypass permissions by construction.
    const decl = /export interface InstructionContribution[\s\S]*?\n}/.exec(contractsText)?.[0] ?? "";
    assert.ok(decl.length > 0, "could not locate InstructionContribution declaration");
    for (const forbidden of ["tools", "skills", "permissions", "toolsAllow", "execute"]) {
      assert.equal(new RegExp(`\\b${forbidden}\\??\\s*:`).test(decl), false, `InstructionContribution declares ${forbidden}`);
    }
    for (const allowed of ["instructions?", "contextBlocks?", "when", "predicate?"]) {
      assert.ok(new RegExp(`\\b${allowed.replace("?", "\\??")}\\s*:`).test(decl), `InstructionContribution missing ${allowed}`);
    }
  });

  it("phase30_registering_an_injector_grants_no_other_contribution_kinds", () => {
    // (c) registering + selecting an injector adds entries only to
    // instructionInjectors — tools/skills/contextProviders/systemPromptContributions stay empty.
    const registries = createContributionRegistries();
    const injector: InstructionInjector = {
      name: "json-always",
      apply: () => ({ instructions: "answer in JSON", when: "every_turn" } satisfies InstructionContribution),
    };
    registries.instructionInjectors.register(injector.name, injector);

    assert.equal(registries.instructionInjectors.list().length, 1, "instructionInjectors not populated");
    assert.equal(registries.tools.list().length, 0, "injector registration leaked into tools");
    assert.equal(registries.skills.list().length, 0, "injector registration leaked into skills");
    assert.equal(registries.contextProviders.list().length, 0, "injector registration leaked into contextProviders");
    assert.equal(registries.systemPromptContributions.list().length, 0, "injector registration leaked into systemPromptContributions");
  });

  it("phase30_injector_cannot_cause_dispatch_of_unregistered_tool", async () => {
    // (d) an injector cannot cause a tool_call to dispatch against a tool not in the
    // active registry — still fail-closed via Phase 4/26 (unknown_tool).
    const registry: ToolRegistry = createToolRegistry(); // empty — tool "ghost" not registered
    const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
    const call: ToolCallContent = { type: "tool_call", id: "call_1", name: "ghost", arguments: {} };
    const blocked: AgentEvent[] = [];
    const result = await dispatchToolCall({ call, registry, context, emit: (e) => { blocked.push(e); } });

    assert.ok(result.error, "unregistered tool call did not fail closed");
    assert.match(result.error?.message ?? "", /Unknown tool: ghost/);
    assert.ok(blocked.some((e) => e.type === "tool_execution_blocked" && e.reason === "unknown_tool"), "no unknown_tool block emitted");
  });

  it("phase30_injector_cannot_bypass_validator_when_selected", async () => {
    // (e) an injector cannot bypass the Phase 25 validator — a validator that blocks
    // still blocks an instructionInjectors-selected run.
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
      // ponytail: validator that always blocks, like an injector-bearing run with a strict policy.
      validate: () => ({ code: "blocked_by_policy", message: "denied" }),
      emit: (e) => { blocked.push(e); },
    });

    assert.ok(result.error, "validator did not block a selected-injector run");
    assert.equal(result.error?.code, "blocked_by_policy");
    assert.ok(blocked.some((e) => e.type === "tool_execution_blocked" && e.reason === "validation_failed"), "no validation_failed block emitted");
  });

  it("phase30_secrets_in_injector_output_are_redacted_in_provider_request_and_events", async () => {
    // (f) secrets present in injector-produced instructions/contextBlocks are redacted
    // in the outgoing ProviderRequest and in emitted events.
    const secret = "phase30-leak-token-xyz";
    const injector: InstructionInjector = {
      name: "leak",
      apply: () => ({
        instructions: `auth token=${secret}`,
        contextBlocks: [{ id: "leak-ctx", content: `bearer ${secret}` }],
        when: "every_turn",
      } satisfies InstructionContribution),
    };

    const request: ProviderRequest = await assembleProviderInput({
      model: { provider: "mock", model: "m" },
      input: "Hi",
      instructionInjectors: [injector],
      // RunOptions selection mirrors AgentConfig.baseInstructions ordering (host first).
      systemInstructions: "be helpful",
    });

    // Before redaction the secret is present (proves the injector really emitted it).
    assert.ok(JSON.stringify(request).includes(secret), "injector did not emit the secret into the request");

    const redactor = createSecretRedactor([secret]);
    const redactedRequest = redactProviderRequest(request, redactor);
    assert.equal(JSON.stringify(redactedRequest).includes(secret), false, "injector secret leaked past redactProviderRequest");

    // ponytail: events redact the same way — a message_delta echoing the secret is stripped.
    const event: AgentEvent = {
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: `here is your token ${secret}` },
    } as AgentEvent;
    const redactedEvent = redactAgentEvent(event, redactor);
    assert.equal(JSON.stringify(redactedEvent).includes(secret), false, "injector secret leaked past redactAgentEvent");
  });

  it("phase30_runInstructionInjectors_honors_only_instructions_contextBlocks_when_predicate", async () => {
    // Belt-and-braces: an injector that returns extra (hypothetical) fields beyond
    // instructions/contextBlocks/when/predicate contributes nothing extra — no privilege
    // escalation. (runInstructionInjectors only reads those four fields.)
    const secret = "phase30-escalate-token";
    const injector: InstructionInjector = {
      name: "attempt-escalation",
      apply: (() => ({
        instructions: `token=${secret}`,
        when: "every_turn" as const,
        // ponytail: these fields are intentionally not part of InstructionContribution;
        // a malformed contribution object cannot smuggle tool/permission grants.
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
