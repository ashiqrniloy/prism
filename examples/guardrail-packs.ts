/**
 * Guardrail packs end to end (plan 104 Task 7) — network-free: mock provider, in-memory stores.
 *
 * One file, four demonstrations, one printed line each:
 *   1. two built-in packs refuse a `shell` and a `write` call, and the refusal names the rule;
 *   2. the same trajectory graded by `createGuardrailPackScorer()` fails naming that rule;
 *   3. an inline `ask` rule suspends a durable run before dispatch and the approval dispatches it;
 *   4. a secret-shaped argument is refused without the refusal echoing the token.
 *
 * Pack rules are restrictive-only: `deny`, `tripwire`, and `ask` narrow what the agent may do on
 * seams it already has. A pack never grants a capability, never widens a tool allow-list, and never
 * approves its own `ask` gate — an approval applies to the suspension, not to the ruleset, so a
 * sibling `deny` rule matching the same call still blocks it at dispatch.
 *
 * Inline packs are the host-reachable form; their pattern rules ride the checkpoint, which is what
 * keeps an `ask` rule enforced after the suspend/resume in step 3 (`persistSessionState`).
 *
 * Run: npm run build:core && node examples/guardrail-packs.ts
 */
import assert from "node:assert/strict";
import {
  type AIProvider,
  type AgentSessionConfig,
  type ContentBlock,
  type JsonObject,
  type ProviderEvent,
  type ToolDefinition,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";
import { createGuardrailPackScorer, runScenario } from "@arnilo/prism-core/governance/evals";

const MODEL = { provider: "mock", model: "guardrail-packs-demo" } as const;
const FINISH: readonly ProviderEvent[] = [providerTextDelta("done"), providerDone()];

const call = (id: string, name: string, args: JsonObject): ProviderEvent => providerToolCall(toolCallContent(id, name, args));

/** One provider turn per `generate()`; the last script entry repeats, so every run terminates. */
function scriptedProvider(script: readonly (readonly ProviderEvent[])[]): AIProvider {
  let index = 0;
  return {
    id: "guardrail-packs-mock",
    async *generate() {
      // Advance before yielding: a consumer stops pulling at `providerDone()`, so anything after the loop may never run.
      const events = script[Math.min(index, script.length - 1)] ?? FINISH;
      index += 1;
      for (const event of events) yield event;
    },
  };
}

function recordingTool(name: string, executed: string[]): ToolDefinition {
  return {
    name,
    parameters: { type: "object" },
    execute: (args, context) => {
      executed.push(name);
      return { toolCallId: context.toolCallId, name, value: { args } };
    },
  };
}

type MemorySessionStore = ReturnType<typeof createMemorySessionStore>;

/** The `pack:<pack>/<rule>` identity out of any refusal line. */
const ruleIdOf = (text: string): string | undefined => /pack:[^\s:]+/.exec(text)?.[0];

/** Refusals the loop appended for blocked calls, read from the session store (tool results are not events). */
async function refusalsOf(store: MemorySessionStore, sessionId: string): Promise<readonly { tool: string; message: string }[]> {
  const refusals: { tool: string; message: string }[] = [];
  for (const entry of await store.list(sessionId)) {
    for (const part of entry.message?.content ?? []) {
      const block: Extract<ContentBlock, { type: "tool_result" }> | undefined = part.type === "tool_result" ? part : undefined;
      if (block?.error?.message) refusals.push({ tool: block.name, message: block.error.message });
    }
  }
  return refusals;
}

/** Step 1: two built-in packs on one session; the blocked calls name the rule that refused them. */
async function blockedCalls(executed: string[]): Promise<readonly { tool: string; message: string }[]> {
  const store = createMemorySessionStore();
  const agent = createAgent({
    id: "pack-demo-block",
    model: { ...MODEL },
    store,
    provider: scriptedProvider([
      [
        call("c1", "shell", { command: "git push origin main --force" }),
        call("c2", "write", { path: "/repo/src/app.test.ts", content: "// tidy" }),
        providerDone(),
      ],
      FINISH,
    ]),
    tools: [recordingTool("shell", executed), recordingTool("write", executed)],
  });
  const sessionConfig: AgentSessionConfig = {
    guardrailPacks: ["destructive-commands", { id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }],
  };
  const result = await agent.createSession({ id: "pack-block", ...sessionConfig }).run("redeploy and tidy the tests");
  const refusals = await refusalsOf(store, result.sessionId);
  for (const refusal of refusals) console.log(`step 1 built-in packs: ${refusal.tool} refused — ${refusal.message}`);
  assert.equal(result.status, "succeeded", "a blocked tool call does not fail the run");
  assert.deepEqual(executed, [], "neither refused call reached its tool");
  assert.equal(refusals.length, 2, "both calls were refused");
  assert.match(refusals[0]?.message ?? "", /pack:destructive-commands\/no-force-push/);
  assert.match(refusals[1]?.message ?? "", /pack:coding-standard\/no-test-rewrites/);
  return refusals;
}

/** Step 2: the same denial graded on the execution timeline, which is what release evidence reads. */
async function scoredScenario(executed: string[]): Promise<string> {
  const agent = createAgent({
    id: "pack-demo-eval",
    model: { ...MODEL },
    store: createMemorySessionStore(),
    provider: scriptedProvider([[call("c1", "shell", { command: "rm -rf ./build" }), providerDone()], FINISH]),
    tools: [recordingTool("shell", executed)],
  });
  const scenario = await runScenario({
    agent,
    turns: ["clean the build directory"],
    sessionConfig: { guardrailPacks: ["destructive-commands"] },
    timeline: "metadata",
    scorers: [createGuardrailPackScorer({ forbidTools: ["shell"] })],
  });
  const graded = scenario.evaluations.at(-1);
  console.log(`step 2 eval scenario: ${graded?.scorerId} scored ${graded?.score} — ${graded?.reason}`);
  assert.equal(scenario.status, "succeeded", "the scenario itself ran to completion");
  assert.equal(graded?.score, 0, "a pack denial is a scored violation, not a silent pass");
  assert.match(graded?.reason ?? "", /pack:destructive-commands\/no-recursive-force-delete/);
  assert.match(graded?.reason ?? "", /forbidden tool|denied the trajectory/);
  assert.deepEqual(executed, [], "the graded run executed no forbidden tool");
  return String(graded?.reason);
}

/** Step 3: an `ask` rule suspends selectively (no all-tools gate) and the approval dispatches once. */
async function durableAsk(executed: string[]): Promise<{ rule?: string; dispatched: readonly string[] }> {
  const checkpoints = createMemoryCheckpointStore();
  const askPack = {
    id: "deploy-guard",
    rules: [
      {
        id: "ask-prod-version",
        tool: "deploy",
        argPath: "version",
        pattern: "^prod-",
        action: "ask" as const,
        reason: "Production tags need approval",
      },
    ],
  };
  const agent = createAgent({
    id: "pack-demo-ask",
    model: { ...MODEL },
    store: createMemorySessionStore(),
    provider: scriptedProvider([
      [call("d1", "deploy", { version: "prod-7" }), providerDone()],
      [providerTextDelta("shipped"), providerDone()],
    ]),
    tools: [recordingTool("deploy", executed)],
  });
  const session = agent.createSession({ id: "pack-ask", guardrailPacks: [askPack] });
  // `persistSessionState` is what carries the inline pack's pattern rules to the resumed session.
  let result = await session.run("ship prod-7", {
    runState: { checkpoints, definitionRevision: "1", persistSessionState: true },
  });
  const pending = result.interruption?.pendingDecisions?.[0];
  if (pending === undefined) throw new Error(`expected a durable ask suspension, got ${result.status}`);
  console.log(`step 3 ask gate: suspended on ${pending.guardrail} — ${pending.reason}`);
  assert.deepEqual(executed, [], "the gated call did not dispatch before the decision");

  const expectedVersion = result.runState?.version;
  if (expectedVersion === undefined) throw new Error("suspension carries no checkpoint version");
  result = await resumeAgentRun(
    agent,
    { runId: result.runId, sessionId: result.sessionId },
    { decisions: [{ approvalId: pending.approvalId, outcome: "allow_once" }], expectedVersion },
    { checkpoints, definitionRevision: "1" },
  );
  console.log(`step 3 ask gate: approved → run ${result.status}, dispatched ${executed.join(", ")}`);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(executed, ["deploy"], "the approved call dispatched exactly once");
  return { rule: pending.guardrail, dispatched: executed };
}

/** Step 4: a secret-shaped argument is refused, and the refusal never echoes the token. */
async function secretRefusal(executed: string[]): Promise<string> {
  // Obviously fake and deliberately short of a real key shape: no credential is ever a literal here.
  const fakeToken = "sk-TESTONLYFAKEKEY1";
  const store = createMemorySessionStore();
  const agent = createAgent({
    id: "pack-demo-secret",
    model: { ...MODEL },
    store,
    provider: scriptedProvider([
      [call("s1", "write", { path: "/repo/.env.example", content: `TOKEN=${fakeToken}` }), providerDone()],
      FINISH,
    ]),
    tools: [recordingTool("write", executed)],
  });
  const result = await agent.createSession({ id: "pack-secret", guardrailPacks: ["secrets-hygiene"] }).run("write the example env file");
  const refusal = (await refusalsOf(store, result.sessionId))[0];
  console.log(`step 4 secrets hygiene: ${refusal?.tool} refused — ${refusal?.message}`);
  assert.match(refusal?.message ?? "", /pack:secrets-hygiene\/no-secret-material-in-arguments/);
  assert.equal(refusal?.message.includes(fakeToken), false, "the refusal never echoes the token");
  assert.deepEqual(executed, [], "the call carrying the token never executed");
  return String(refusal?.message);
}

export async function demo(): Promise<Record<string, unknown>> {
  const blocked: string[] = [];
  const refusals = await blockedCalls(blocked);
  const scenarioReason = await scoredScenario([]);
  const ask = await durableAsk([]);
  const secretReason = await secretRefusal([]);
  return {
    blockedRules: refusals.map((refusal) => ruleIdOf(refusal.message)),
    scenarioReason,
    askRule: ask.rule,
    askDispatched: ask.dispatched,
    secretRule: ruleIdOf(secretReason),
    // Step 1 refused both calls, so its tool list stayed empty — enforcement, not agent goodwill.
    toolsExecutedInStep1: blocked.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
