/**
 * Governance deny-by-default (plan 159 Task 6; Done criterion 2) — network-free: mock provider,
 * in-memory audit store.
 *
 * One `tool.call` gate over `@arnilo/prism-extensions/governance`: the allow-listed `read_file` runs, the
 * unlisted `write_file` is blocked with a `hook_denied` result naming the policy, and the run still
 * completes. Every decision is appended to the configured `PolicyDecisionStore`, so the audit holds
 * both the allow and the deny.
 *
 * Run: npm run build:core && node examples/governance-deny.ts
 */
import {
  type ContentBlock,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolCapabilityKind,
  type ToolDefinition,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import governance, { type PolicyDecisionStore } from "@arnilo/prism-extensions/governance";

const MODEL = { provider: "mock", model: "governance-deny-demo" } as const;
const FINISH: readonly ProviderEvent[] = [providerTextDelta("done"), providerDone()];

function scriptedProvider(script: readonly (readonly ProviderEvent[])[]): ModelProvider {
  let index = 0;
  return {
    id: "mock",
    async *generate() {
      const events = script[Math.min(index, script.length - 1)] ?? FINISH;
      index += 1;
      for (const event of events) yield event;
    },
  };
}

function recordingTool(name: string, executed: string[], effects: readonly ToolCapabilityKind[]): ToolDefinition {
  return {
    name,
    effects,
    parameters: { type: "object" },
    execute: (args, context) => {
      executed.push(name);
      return { toolCallId: context.toolCallId, name, value: { args } };
    },
  };
}

/** Loads after governance and captures the `governance.audit` service so the demo can read the ledger. */
let audit: { store: PolicyDecisionStore } | undefined;
const auditCapture = definePackage({
  name: "@prism-example/governance-audit-capture",
  version: "0.0.0",
  requires: { api: 1 },
  setup(prism) {
    audit = prism.services.consume<{ store: PolicyDecisionStore }>("governance.audit");
  },
});

type MemorySessionStore = ReturnType<typeof createMemorySessionStore>;

/** Refusals the loop appended for blocked calls, read from the session store (tool results are not events). */
async function refusalsOf(
  store: MemorySessionStore,
  sessionId: string,
): Promise<readonly { tool: string; message: string; code?: string | number }[]> {
  const refusals: { tool: string; message: string; code?: string | number }[] = [];
  for (const entry of await store.list(sessionId)) {
    for (const part of entry.message?.content ?? []) {
      const block = (part as ContentBlock).type === "tool_result" ? (part as Extract<ContentBlock, { type: "tool_result" }>) : undefined;
      if (block?.error?.message) refusals.push({ tool: block.name, message: block.error.message, code: block.error.code });
    }
  }
  return refusals;
}

export async function demo(): Promise<Record<string, unknown>> {
  const store = createMemorySessionStore();
  const executed: string[] = [];
  const agent = await createAgent({
    id: "governance-deny",
    model: MODEL,
    slots: { store },
    packages: [
      providerPackage("governance-deny-provider", [
        scriptedProvider([
          [providerToolCall(toolCallContent("r1", "read_file", { path: "notes.txt" })), providerDone()],
          [providerToolCall(toolCallContent("w1", "write_file", { path: "notes.txt" })), providerDone()],
          FINISH,
        ]),
      ]),
      governance({ default: "deny", rules: [{ tools: ["read_file"], outcome: "allow" }], audit: { store: "memory" } }),
      auditCapture,
    ],
    tools: { add: [recordingTool("read_file", executed, ["read"]), recordingTool("write_file", executed, ["write"])] },
  });

  const result = await (await agent.session({ id: "governance-deny", create: true })).run("read then write notes.txt");
  const refusals = await refusalsOf(store, result.sessionId);
  const records = await audit?.store.query({ tenantId: "local", userId: "governance-deny" });
  await agent.dispose();

  return {
    runStatus: result.status,
    executed,
    blockedTool: refusals[0]?.tool,
    blockedCode: refusals[0]?.code,
    blockedReason: refusals[0]?.message,
    auditOutcomes: (records?.items ?? []).map((record) => record.outcome).sort(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
