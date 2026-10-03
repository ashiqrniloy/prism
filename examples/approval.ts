import { type AIProvider, createAgent, createMemorySessionStore, type Decision } from "@arnilo/prism";
import {
  createMockProvider,
  createScriptedHostUi,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";

/**
 * A tool gated by a host `tool.call` hook returning `{ ask }` (roadmap §2.4), resolved both ways:
 * - with a `HostUi` the kernel sends a `confirm` request inline and the run goes on;
 * - with no UI the run suspends (`status: "suspended"`, `pending`), the suspension is written through the
 *   `store` slot, and `agent.session({ id })` plus `session.resume(decisions)` finishes it, here from a
 *   brand-new agent over the same store, as a new process would.
 * Imports only `@arnilo/prism` and `@arnilo/prism/testing`; no credential. Network-free.
 * Run: npm run build:core && node examples/approval.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;

/** The mock provider replays one script per call; this plays a different one on each turn. */
function turns(...scripts: Parameters<typeof createMockProvider>[0][]): AIProvider {
  let turn = 0;
  return { id: "mock", generate: (request) => createMockProvider(scripts[Math.min(turn++, scripts.length - 1)]).generate(request) };
}

function build(options: {
  readonly executed: string[];
  readonly ui?: ReturnType<typeof createScriptedHostUi>["ui"];
  readonly store: ReturnType<typeof createMemorySessionStore>;
  readonly finalOnly?: boolean;
}) {
  return createAgent({
    id: "approval-demo",
    model: MODEL,
    slots: { store: options.store },
    ...(options.ui ? { host: { ui: options.ui } } : {}),
    // The host gate: every `delete_file` call needs a person's yes.
    hooks: (hooks) => hooks.on("tool.call", (call) => (call.name === "delete_file" ? { ask: "Delete a file?" } : undefined)),
    provider: options.finalOnly
      ? turns([providerTextDelta("Deleted."), providerDone()])
      : turns(
          [providerToolCall(toolCallContent("call-1", "delete_file", { path: "tmp/scratch.txt" })), providerDone()],
          [providerTextDelta("Deleted."), providerDone()],
        ),
    tools: {
      add: [
        {
          name: "delete_file",
          description: "Deletes a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          effects: ["write"],
          execute: (args, context) => {
            options.executed.push(String(args.path));
            return { toolCallId: context.toolCallId, name: "delete_file", value: "deleted" };
          },
        },
      ],
    },
  });
}

export async function demo(): Promise<Record<string, unknown>> {
  // 1. A UI answers inline: the run never suspends.
  const inlineRuns: string[] = [];
  const scripted = createScriptedHostUi({ confirm: true });
  const inline = await build({ executed: inlineRuns, ui: scripted.ui, store: createMemorySessionStore() });
  const inlineResult = await (await inline.session()).run("Clean up tmp/scratch.txt");

  // 2. No UI: the run suspends, and a new agent over the same store resumes it.
  const store = createMemorySessionStore();
  const executed: string[] = [];
  const first = await build({ executed, store });
  const session = await first.session();
  const suspended = await session.run("Clean up tmp/scratch.txt");
  const pending = suspended.pending ?? [];
  const executedWhileSuspended = executed.length;

  const second = await build({ executed, store, finalOnly: true });
  const reopened = await second.session({ id: session.id });
  const decisions: Decision[] = pending.map((entry) => ({ approvalId: entry.approvalId, outcome: "allow_once" }));
  const eventTypes: string[] = [];
  for await (const event of reopened.resume(decisions)) eventTypes.push(event.type);

  return {
    inline: { status: inlineResult.status, executed: inlineRuns, confirmRequests: scripted.requestsOf("confirm").length },
    suspended: { status: suspended.status, pending: pending.map((entry) => entry.scope.toolName), executedWhileSuspended },
    resumed: { events: eventTypes, executed, final: (await reopened.messages()).at(-1)?.role },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
