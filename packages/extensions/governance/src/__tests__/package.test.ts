import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  type HostUi,
  type HostUiRequest,
  type HostUiResponse,
  type JsonObject,
  type LoopStrategy,
  type ModelProvider,
  runGuardrailList,
  type ToolCapabilityKind,
  type ToolDefinition,
  type ToolResult,
} from "@arnilo/prism";
import { type AgentIdentity, IdentityError, type IdentityVerifier } from "../identity/index.js";
import { packageConformance, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import governance, {
  createClaimGroundingGuardrail,
  createFieldEvidenceGuardrail,
  createOpaPolicyEvaluator,
  type PolicyDecisionStore,
  type PolicyEvaluateRequest,
  toolCallDecision,
} from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-governance-"));
  dirs.push(dir);
  return dir;
}

function recordingTool(name: string, executed: string[], effects?: readonly ToolCapabilityKind[]): ToolDefinition {
  return {
    name,
    ...(effects ? { effects } : {}),
    parameters: { type: "object" },
    execute: (args, ctx) => {
      executed.push(name);
      return { toolCallId: ctx.toolCallId, name, value: { args } };
    },
  };
}

/** One tool call per listed step, then a text turn to end the run. */
function scriptedProvider(calls: readonly { tool: string; args: JsonObject }[]): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      const step = calls[turn];
      turn += 1;
      if (step) {
        yield providerToolCall(toolCallContent(`c${turn}`, step.tool, step.args));
      } else {
        yield providerTextDelta("done");
      }
      yield providerDone();
    },
  };
}

function providerPackageFor(provider: ModelProvider) {
  return definePackage({
    name: "@test/governance-provider",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.providers.register(provider);
    },
  });
}

let capturedAudit: { store: PolicyDecisionStore } | undefined;

/** Loads after governance and captures the `governance.audit` service the package provided. */
function captureAuditPackage() {
  capturedAudit = undefined;
  return definePackage({
    name: "@test/capture-governance-audit",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      capturedAudit = prism.services.consume<{ store: PolicyDecisionStore }>("governance.audit");
    },
  });
}

/** Installs the host `IdentityVerifier` governance consumes (plan 159 Task 8). Load before governance. */
function identityVerifierPackage(verifier: IdentityVerifier, name = "identity.verifier") {
  return definePackage({
    name: "@test/governance-identity-verifier",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide(name, verifier);
    },
  });
}

function verifiedIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    principal: { kind: "user", id: "user-1" },
    scopes: ["read"],
    issuedAt: new Date().toISOString(),
    verified: true,
    ...overrides,
  };
}

/** Collects every event the agent emits, for leak assertions. */
function eventCollectorPackage(events: unknown[]) {
  return definePackage({
    name: "@test/governance-event-collector",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      const record = (event: unknown): void => {
        events.push(event);
      };
      prism.hooks.on("package.event", record);
      prism.hooks.on("tool.completed", record);
      prism.hooks.on("run.completed", record);
      prism.hooks.on("run.failed", record);
    },
  });
}

async function refusalsOf(store: ReturnType<typeof createMemorySessionStore>, sessionId: string) {
  const refusals: { tool: string; message: string; code?: string | number }[] = [];
  for (const entry of await store.list(sessionId)) {
    for (const part of entry.message?.content ?? []) {
      const block = part.type === "tool_result" ? part : undefined;
      if (block?.error?.message) refusals.push({ tool: block.name, message: block.error.message, code: block.error.code });
    }
  }
  return refusals;
}

function scriptedUi(steps: readonly HostUiResponse[]): HostUi & { kinds: string[] } {
  const kinds: string[] = [];
  let index = 0;
  return {
    kinds,
    request: (async (request: HostUiRequest) => {
      kinds.push(request.kind);
      return steps[index++] ?? { status: "dismissed" };
    }) as HostUi["request"],
  };
}

function identity(): AgentIdentity {
  return {
    tenantId: "t",
    userId: "u",
    principal: { kind: "user", id: "u" },
    scopes: ["s"],
    issuedAt: new Date().toISOString(),
    verified: true,
  };
}

describe("governance package", () => {
  it("governance_package_conformance", async () => {
    const result = await packageConformance(governance);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("governance_default_deny_blocks_unlisted_tool", async () => {
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const agent = await createAgent({
      id: "deny-default",
      model: { provider: "mock", model: "m" },
      slots: { store },
      packages: [
        providerPackageFor(
          scriptedProvider([
            { tool: "read_file", args: { path: "a.txt" } },
            { tool: "write_file", args: { path: "a.txt" } },
          ]),
        ),
        governance({ default: "deny", rules: [{ tools: ["read_file"], outcome: "allow" }], audit: { store: "memory" } }),
        captureAuditPackage(),
      ],
      tools: { add: [recordingTool("read_file", executed, ["read"]), recordingTool("write_file", executed, ["write"])] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.equal(result.status, "completed", "a blocked call does not fail the run");
    assert.deepEqual(executed, ["read_file"], "the allow-listed tool ran, the unlisted one did not");
    const refusal = (await refusalsOf(store, result.sessionId)).find((entry) => entry.tool === "write_file");
    assert.equal(refusal?.code, "hook_denied");
    assert.match(refusal?.message ?? "", /denied by policy/);

    const records = await capturedAudit?.store.query({ tenantId: "local", userId: "s" });
    assert.equal(records?.items.length, 2, "both decisions are recorded");
    assert.deepEqual(records?.items.map((record) => record.outcome).sort(), ["allow", "deny"]);
    await agent.dispose();
  });

  it("governance_approval_becomes_ask", async () => {
    const executed: string[] = [];
    const config = {
      default: "allow" as const,
      rules: [{ tools: ["deploy"], outcome: "approval" as const, reason: "production deploy needs a human" }],
    };
    const suspended = await createAgent({
      id: "approval-suspend",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackageFor(scriptedProvider([{ tool: "deploy", args: { version: "prod-7" } }])), governance(config)],
      tools: { add: [recordingTool("deploy", executed, ["external"])] },
    });
    const session = await suspended.session({ id: "s", create: true });
    const first = await session.run("ship");
    assert.equal(first.status, "suspended", "no UI means the ask suspends");
    assert.match(first.pending?.[0]?.reason ?? "", /production deploy needs a human/);
    assert.deepEqual(executed, []);
    for await (const _event of session.resume(
      (first.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      // drain
    }
    assert.deepEqual(executed, ["deploy"], "the resumed approval dispatches");
    await suspended.dispose();

    const inlineExecuted: string[] = [];
    const ui = scriptedUi([{ status: "answered", value: true }]);
    const inline = await createAgent({
      id: "approval-inline",
      model: { provider: "mock", model: "m" },
      host: { ui },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackageFor(scriptedProvider([{ tool: "deploy", args: { version: "prod-8" } }])), governance(config)],
      tools: { add: [recordingTool("deploy", inlineExecuted, ["external"])] },
    });
    const inlineResult = await (await inline.session({ id: "s", create: true })).run("ship");
    assert.equal(inlineResult.status, "completed");
    assert.deepEqual(inlineExecuted, ["deploy"]);
    assert.deepEqual(ui.kinds, ["confirm"]);
    await inline.dispose();
  });

  it("governance_opa_unreachable_denies", async () => {
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const agent = await createAgent({
      id: "opa-unreachable",
      model: { provider: "mock", model: "m" },
      slots: { store },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "write_file", args: { path: "a.txt" } }])),
        governance({ opa: { url: "https://opa-does-not-exist.invalid/v1/data/prism/allow", timeoutMs: 200 } }),
      ],
      tools: { add: [recordingTool("write_file", executed, ["write"])] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.deepEqual(executed, [], "an unreachable OPA endpoint never allows");
    const refusal = (await refusalsOf(store, result.sessionId))[0];
    assert.equal(refusal?.code, "hook_denied");
    assert.match(refusal?.message ?? "", /ERR_PRISM_OPA_TRANSPORT|unavailable/);
    await agent.dispose();
  });

  it("governance_opa_decision_maps_outcomes", async () => {
    // The package's default OPA fetch is DNS-pinned and refuses plaintext loopback by design, so the
    // outcome mapping is exercised over the same adapter the package builds, with an injected fetch.
    const cases: readonly { readonly result: unknown; readonly decision: string }[] = [
      { result: true, decision: "allow" },
      { result: { outcome: "deny", reason: "blocked by policy" }, decision: "deny" },
      { result: { outcome: "approval", reason: "needs human" }, decision: "ask" },
      { result: { outcome: "modify" }, decision: "deny" },
    ];
    for (const testCase of cases) {
      const evaluator = createOpaPolicyEvaluator({
        url: "https://opa.example.internal/v1/data/prism/allow",
        policyId: "p",
        policyVersion: "1",
        fetch: async () => new Response(JSON.stringify({ result: testCase.result }), { status: 200 }),
      });
      const request: PolicyEvaluateRequest = { identity: identity(), action: "write_file", resource: { kind: "tool", id: "write_file" } };
      const decision = toolCallDecision(await evaluator.evaluate(request), "write_file");
      assert.equal(typeof decision === "string" ? decision : "ask" in decision ? "ask" : "deny", testCase.decision);
    }
  });

  it("governance_audit_records_redacted_args", async () => {
    const fakeToken = "sk-TESTONLYFAKEKEY1";
    const agent = await createAgent({
      id: "audit-redact",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "read_file", args: { path: "a.txt", token: fakeToken } }])),
        governance({ default: "allow", audit: { store: "memory" } }),
        captureAuditPackage(),
      ],
      tools: { add: [recordingTool("read_file", [], ["read"])] },
    });
    await (await agent.session({ id: "s", create: true })).run("go");
    const records = await capturedAudit?.store.query({ tenantId: "local", userId: "s" });
    assert.equal(records?.items.length, 1, "the decision is recorded");
    assert.equal(JSON.stringify(records?.items).includes(fakeToken), false, "the secret never enters the audit record");
    await agent.dispose();
  });

  it("governance_audit_failure_denies_when_required", async () => {
    const dir = await tempDir();
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "not a directory", "utf8");
    const executed: string[] = [];
    const agent = await createAgent({
      id: "audit-required",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "read_file", args: { path: "a.txt" } }])),
        governance({ default: "allow", audit: { store: "file", path: join(blocker, "audit.jsonl") } }),
      ],
      tools: { add: [recordingTool("read_file", executed, ["read"])] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.deepEqual(executed, [], "a required audit failure denies the call");
    assert.equal(result.status, "completed");
    await agent.dispose();
  });

  it("governance_run_input_opt_in_rejects", async () => {
    const provider = scriptedProvider([{ tool: "read_file", args: { path: "a.txt" } }]);
    const gatedExecuted: string[] = [];
    const gated = await createAgent({
      id: "run-input-gated",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(provider),
        governance({ default: "deny", rules: [{ tools: ["read_file"], outcome: "allow" }], hooks: { runInput: true } }),
      ],
      tools: { add: [recordingTool("read_file", gatedExecuted, ["read"])] },
    });
    let rejected = false;
    try {
      const result = await (await gated.session({ id: "s", create: true })).run("go");
      rejected = result.status === "failed";
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, "an opted-in run.input denial rejects the run");
    assert.deepEqual(gatedExecuted, []);
    await gated.dispose();

    const openExecuted: string[] = [];
    const open = await createAgent({
      id: "run-input-open",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "read_file", args: { path: "a.txt" } }])),
        governance({ default: "deny", rules: [{ tools: ["read_file"], outcome: "allow" }] }),
      ],
      tools: { add: [recordingTool("read_file", openExecuted, ["read"])] },
    });
    const openResult = await (await open.session({ id: "s", create: true })).run("go");
    assert.equal(openResult.status, "completed", "without the opt-in the input passes");
    assert.deepEqual(openExecuted, ["read_file"]);
    await open.dispose();
  });

  it("governance_from_custom_loop", async () => {
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const customLoop: LoopStrategy = {
      name: "custom-governance-loop",
      async run(run) {
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    };
    const agent = await createAgent({
      id: "custom-loop",
      model: { provider: "mock", model: "m" },
      slots: { store, loop: customLoop },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "write_file", args: { path: "a.txt" } }])),
        governance({ default: "deny", rules: [{ tools: ["read_file"], outcome: "allow" }] }),
      ],
      tools: { add: [recordingTool("write_file", executed, ["write"])] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.deepEqual(executed, [], "the deny holds under a custom loop");
    const refusal = (await refusalsOf(store, result.sessionId))[0];
    assert.equal(refusal?.code, "hook_denied");
    await agent.dispose();
  });

  it("governance_require_principal_fails_closed", async () => {
    // Plan 159 Task 7: `require` replaces `createSecureAgent`'s principal guarantee. A package cannot
    // read `AgentConfig`, so the check runs at the run boundary and fails the run closed.
    const gated = await createAgent({
      id: "require-principal",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackageFor(scriptedProvider([])), governance({ default: "allow", require: { principal: true } })],
    });
    const failed = await (await gated.session({ id: "s", create: true })).run("go");
    assert.equal(failed.status, "failed", "a session without a principal never runs");
    assert.match(failed.error?.message ?? failed.abortReason ?? "", /ERR_PRISM_GOVERNANCE_REQUIREMENT/);
    await gated.dispose();

    const open = await createAgent({
      id: "require-principal-ok",
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "u" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackageFor(scriptedProvider([])), governance({ default: "allow", require: { principal: true } })],
    });
    const completed = await (await open.session({ id: "s", create: true })).run("go");
    assert.equal(completed.status, "completed", "a session with a principal runs");
    await open.dispose();
  });

  it("governance_field_evidence_denies_unproven_field", async () => {
    // The moved `createFieldEvidenceGuardrail` (a library export) wired through `tool.call`: an
    // invented amount never reaches the tool, and the refusal names the field and violation.
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const proposal = "synapta:proposal";
    const claim = { value: 999, source: "tool:invoice_fetch", path: "invoice.total", revision: 7 };
    const guardrail = createFieldEvidenceGuardrail({
      toolName: proposal,
      required: ["amount"],
      evidence: () => [{ source: "tool:invoice_fetch", path: "invoice.total", value: 1250, revision: 7 }],
    });
    const agent = await createAgent({
      id: "field-evidence",
      model: { provider: "mock", model: "m" },
      slots: { store },
      packages: [providerPackageFor(scriptedProvider([{ tool: proposal, args: { amount: claim } }])), governance({ default: "allow" })],
      tools: { add: [recordingTool(proposal, executed)] },
      hooks: (hooks) =>
        hooks.on("tool.call", async (payload, context) => {
          const result = await runGuardrailList({
            stage: "tool_input",
            guards: [guardrail],
            value: { type: "tool_call", id: payload.callId, name: payload.name, arguments: payload.args },
            context: {
              sessionId: payload.sessionId,
              runId: payload.runId,
              toolCallId: payload.callId,
              toolName: payload.name,
              metadata: {},
              signal: context.signal,
            },
            emit: (event) => {
              if (event.type === "package.event") context.emit(event.name, event.data ?? null);
            },
            package: "@arnilo/prism-extensions/governance",
          });
          const terminal = result.terminal;
          if (!terminal) return undefined;
          const field = typeof terminal.metadata?.field === "string" ? terminal.metadata.field : undefined;
          const violation = typeof terminal.metadata?.violation === "string" ? terminal.metadata.violation : "rejected";
          return { deny: `field evidence ${violation}${field ? ` at ${field}` : ""} for ${payload.name}` };
        }),
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.equal(result.status, "completed");
    assert.deepEqual(executed, [], "an unproven field never reaches the tool");
    const refusal = (await refusalsOf(store, result.sessionId))[0];
    assert.equal(refusal?.code, "hook_denied");
    assert.match(refusal?.message ?? "", /value_mismatch at amount/);
    await agent.dispose();
  });

  it("governance_claim_grounding_rejects_ungrounded_answer", async () => {
    // The moved `createClaimGroundingGuardrail` wired through `model.response`: a numeric claim with
    // no same-run evidence fails the run.
    const toolResults: ToolResult[] = [];
    const provider = (): ModelProvider => {
      let turns = 0;
      return {
        id: "mock",
        async *generate() {
          if (turns++ === 0) {
            yield providerToolCall(toolCallContent("sum", "sum", {}));
            yield providerDone();
            return;
          }
          yield providerTextDelta("Total is 4,320.50.");
          yield providerDone();
        },
      };
    };
    const grounding = createClaimGroundingGuardrail({ requireEvidenceForNumbers: true, toolResults: () => toolResults });
    const sumTool: ToolDefinition = {
      name: "sum",
      parameters: { type: "object" },
      execute: (_args, ctx) => {
        toolResults.push({ toolCallId: ctx.toolCallId, name: "sum", value: 4320.5 });
        return { toolCallId: ctx.toolCallId, name: "sum", value: 4320.5 };
      },
    };

    const grounded = await createAgent({
      id: "grounded",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackageFor(provider()), governance({ default: "allow" })],
      tools: { add: [sumTool] },
      hooks: (hooks) => hooks.on("model.response", grounding),
    });
    assert.equal((await (await grounded.session({ id: "s", create: true })).run("go")).text, "Total is 4,320.50.");
    await grounded.dispose();

    const textOnly: ModelProvider = {
      id: "mock",
      async *generate() {
        yield providerTextDelta("Total is 4,320.50.");
        yield providerDone();
      },
    };
    const ungrounded = await createAgent({
      id: "ungrounded",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackageFor(textOnly), governance({ default: "allow" })],
      hooks: (hooks) => hooks.on("model.response", createClaimGroundingGuardrail({ requireEvidenceForNumbers: true })),
    });
    const failed = await (await ungrounded.session({ id: "s", create: true })).run("go");
    assert.equal(failed.status, "failed", "an ungrounded numeric claim fails the run");
    assert.match(failed.error?.message ?? failed.abortReason ?? "", /claim_ungrounded/);
    await ungrounded.dispose();
  });

  it("governance_identity_verifies_before_run", async () => {
    // Plan 159 Task 8: verification is a `run.input` transform, so a rejected principal never reaches
    // the provider, and the failure text carries the frozen reason code — never the error message.
    let providerTurns = 0;
    const agent = await createAgent({
      id: "identity-reject",
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "user-1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor({
          id: "mock",
          async *generate() {
            providerTurns += 1;
            yield providerTextDelta("done");
            yield providerDone();
          },
        }),
        identityVerifierPackage(
          {
            verify() {
              throw new IdentityError("bad signature for token sk-live-leaked-value", "ERR_PRISM_OIDC_SIGNATURE");
            },
          },
          "identity.verifier.oidc",
        ),
        governance({ default: "allow", identity: { verifier: "oidc" } }),
      ],
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.equal(result.status, "failed", "an unverifiable principal never runs");
    const failure = result.error?.message ?? result.abortReason ?? "";
    assert.match(failure, /ERR_PRISM_OIDC_SIGNATURE/);
    assert.doesNotMatch(failure, /sk-live-leaked-value/, "the verifier's message is never echoed");
    assert.equal(providerTurns, 0, "verification runs before the provider round");
    await agent.dispose();
  });

  it("governance_identity_expiry_denies_tool_call", async () => {
    // The identity is valid when verified but expires while the provider turn is in flight.
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const agent = await createAgent({
      id: "identity-expiry",
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "user-1" },
      slots: { store },
      packages: [
        providerPackageFor({
          id: "mock",
          async *generate() {
            await new Promise((resolve) => setTimeout(resolve, 150));
            yield providerToolCall(toolCallContent("c1", "read_file", {}));
            yield providerDone();
          },
        }),
        identityVerifierPackage({
          verify: () => verifiedIdentity({ expiresAt: new Date(Date.now() + 60).toISOString() }),
        }),
        governance({ default: "allow", identity: { verifier: "service" } }),
      ],
      tools: { add: [recordingTool("read_file", executed, ["read"])] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.deepEqual(executed, [], "an identity that expired since verification never dispatches");
    const refusal = (await refusalsOf(store, result.sessionId)).find((entry) => entry.tool === "read_file");
    assert.equal(refusal?.code, "hook_denied");
    assert.match(refusal?.message ?? "", /identity expired/);
    await agent.dispose();
  });

  it("governance_identity_scope_rule", async () => {
    const config = {
      default: "allow" as const,
      rules: [{ tools: ["write_invoice"], scopes: ["invoices:write"], outcome: "allow" as const }],
      identity: { verifier: "service" as const },
    };
    const denied: string[] = [];
    const store = createMemorySessionStore();
    const deniedAgent = await createAgent({
      id: "identity-scope-denied",
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "user-1" },
      slots: { store },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "write_invoice", args: { total: 1 } }])),
        identityVerifierPackage({ verify: () => verifiedIdentity({ scopes: ["invoices:read"] }) }),
        governance(config),
      ],
      tools: { add: [recordingTool("write_invoice", denied, ["write"])] },
    });
    const deniedResult = await (await deniedAgent.session({ id: "s", create: true })).run("go");
    assert.deepEqual(denied, [], "a principal without the rule's scope is denied");
    const refusal = (await refusalsOf(store, deniedResult.sessionId)).find((entry) => entry.tool === "write_invoice");
    assert.match(refusal?.message ?? "", /lacks scope invoices:write/);
    await deniedAgent.dispose();

    const allowed: string[] = [];
    const allowedAgent = await createAgent({
      id: "identity-scope-allowed",
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "user-1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "write_invoice", args: { total: 1 } }])),
        identityVerifierPackage({ verify: () => verifiedIdentity({ scopes: ["invoices:read", "invoices:write"] }) }),
        governance(config),
      ],
      tools: { add: [recordingTool("write_invoice", allowed, ["write"])] },
    });
    const allowedResult = await (await allowedAgent.session({ id: "s", create: true })).run("go");
    assert.equal(allowedResult.status, "completed");
    assert.deepEqual(allowed, ["write_invoice"], "a principal holding the scope dispatches");
    await allowedAgent.dispose();
  });

  it("governance_identity_missing_service_fails_closed", async () => {
    await assert.rejects(
      async () =>
        createAgent({
          id: "identity-missing",
          model: { provider: "mock", model: "m" },
          slots: { store: createMemorySessionStore() },
          packages: [providerPackageFor(scriptedProvider([])), governance({ identity: { verifier: "oidc" } })],
        }),
      (error: unknown) => {
        assert.match(String(error), /identity\.verifier\.oidc|missing_service/);
        assert.equal((error as { readonly code?: string }).code, "missing_service");
        return true;
      },
    );
  });

  it("governance_identity_metadata_redacted", async () => {
    // Identity metadata and credential refs stay out of events and audit records; only redacted actor
    // refs reach the ledger.
    const events: unknown[] = [];
    const executed: string[] = [];
    const agent = await createAgent({
      id: "identity-redacted",
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "user-1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(scriptedProvider([{ tool: "read_file", args: {} }])),
        identityVerifierPackage({
          verify: () =>
            verifiedIdentity({
              metadata: { bearer: "sk-live-identity-metadata" },
              credentialRefs: ["keyring:opaque-identity-ref"],
            }),
        }),
        governance({ default: "allow", audit: { store: "memory" }, identity: { verifier: "service" } }),
        captureAuditPackage(),
        eventCollectorPackage(events),
      ],
      tools: { add: [recordingTool("read_file", executed, ["read"])] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("go");
    assert.equal(result.status, "completed");
    assert.deepEqual(executed, ["read_file"]);
    const records = await capturedAudit?.store.query({ tenantId: "tenant-1", userId: "user-1" });
    assert.ok((records?.items.length ?? 0) > 0, "the verified identity is the audit actor");
    const ledger = JSON.stringify(records?.items ?? []);
    assert.doesNotMatch(ledger, /sk-live-identity-metadata/);
    assert.doesNotMatch(ledger, /opaque-identity-ref/);
    const emitted = JSON.stringify(events);
    assert.ok(events.length > 0, "the run emitted events");
    assert.doesNotMatch(emitted, /sk-live-identity-metadata/);
    assert.doesNotMatch(emitted, /opaque-identity-ref/);
    await agent.dispose();
  });

  it("governance_literal_opa_header_rejected", async () => {
    const config = {
      opa: {
        url: "https://opa.example.internal/v1/data/prism/allow",
        headers: { authorization: "Bearer literal-secret" },
      },
    };
    await assert.rejects(
      async () =>
        createAgent({
          id: "literal-header",
          model: { provider: "mock", model: "m" },
          slots: { store: createMemorySessionStore() },
          packages: [
            providerPackageFor(scriptedProvider([])),
            // @ts-expect-error a literal header value is not a ref; the config schema rejects it.
            governance(config),
          ],
        }),
      /config is invalid|config_invalid|ref/,
    );
  });
});
