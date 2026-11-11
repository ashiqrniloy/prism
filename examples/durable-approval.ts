import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, type Decision, type ToolResultContent } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { sqliteStore } from "@arnilo/prism-extensions/store-sqlite";

/**
 * A suspended approval is resumed in a new process (roadmap Phase 6 Done):
 *
 * - process A runs a tool gated by an `ask` hook with no `host.ui`, so the run suspends into the SQLite
 *   store — the side effect must not happen yet;
 * - A spawns process B over the same database file and session id, carrying the `approvalId` from
 *   `RunResult.pending` and nothing else;
 * - B reopens the session, calls `session.resume([{ approvalId, outcome: "allow_once" }])`, and prints
 *   the completed run and the tool result.
 *
 * Imports only `@arnilo/prism`, `@arnilo/prism/testing`, and `@arnilo/prism-extensions/store-sqlite`; no credential,
 * no network. Run: bun examples/durable-approval.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;

function build(options: { readonly dir: string; readonly finalOnly?: boolean }) {
  const markerPath = join(options.dir, "side-effect.txt");
  return createAgent({
    id: "durable-approval-demo",
    model: MODEL,
    packages: [
      sqliteStore({ path: join(options.dir, "sessions.db") }),
      mockProvider(
        options.finalOnly
          ? [[providerTextDelta("Deleted."), providerDone()]]
          : [
              [providerToolCall(toolCallContent("call-1", "delete_file", { path: "tmp/scratch.txt" })), providerDone()],
              [providerTextDelta("Deleted."), providerDone()],
            ],
      ),
    ],
    // The host gate: every `delete_file` call needs a person's yes. Without a `host.ui` the run suspends.
    hooks: (hooks) => hooks.on("tool.call", (call) => (call.name === "delete_file" ? { ask: "Delete a file?" } : undefined)),
    tools: {
      add: [
        {
          name: "delete_file",
          description: "Deletes a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          effects: ["write"],
          execute: (args, context) => {
            writeFileSync(markerPath, `deleted ${String(args.path)}\n`);
            return { toolCallId: context.toolCallId, name: "delete_file", value: `deleted ${String(args.path)}` };
          },
        },
      ],
    },
  });
}

type PhaseB = {
  readonly phase: string;
  readonly pid: number;
  readonly sessionId: string;
  readonly approvalId: string;
  readonly events: readonly string[];
  readonly toolResult: unknown;
  readonly sideEffect: boolean;
};

/** Process A: suspend the run, then assert what the approving process did. */
async function phaseA(script: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "prism-durable-approval-"));
  const markerPath = join(dir, "side-effect.txt");
  try {
    const agent = await build({ dir });
    const session = await agent.session();
    const suspended = await session.run("Delete tmp/scratch.txt");
    const pending = suspended.pending ?? [];
    assert.equal(suspended.status, "suspended", "a gated tool with no host UI must suspend the run");
    assert.equal(pending.length, 1, "exactly one approval must be pending");
    assert.equal(existsSync(markerPath), false, "the tool must not run before the approval");
    await agent.dispose();

    const approvalId = pending[0]?.approvalId;
    assert.ok(approvalId, "the pending decision must carry an approval id");
    const child = spawnSync("bun", [script, "--phase=b", dir, session.id, approvalId], { encoding: "utf8" });
    assert.equal(child.status, 0, `phase B exited ${child.status}\n${child.stderr}`);
    const b = JSON.parse(child.stdout.trim().split("\n").at(-1) ?? "{}") as PhaseB;
    assert.equal(b.phase, "b", "phase B must report its phase");
    assert.notEqual(b.pid, process.pid, "phase B must be another process");
    assert.equal(b.sessionId, session.id, "phase B must reopen the same session id");
    assert.equal(b.approvalId, approvalId, "phase B must decide the pending approval id");
    assert.equal(b.events.at(-1), "run.completed", "the resumed run must complete");
    assert.equal(b.sideEffect, true, "the side effect happens in phase B, after the approval");
    assert.ok(JSON.stringify(b.toolResult).includes("deleted tmp/scratch.txt"), "the tool result must reach the model");

    return { phase: "a", sessionId: session.id, suspended: suspended.status, pending: pending.length, child: b };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Process B: reopen the session and approve. */
async function phaseB(dir: string, sessionId: string, approvalId: string): Promise<PhaseB> {
  const agent = await build({ dir, finalOnly: true });
  const session = await agent.session({ id: sessionId });
  const decisions: Decision[] = [{ approvalId, outcome: "allow_once" }];
  const events: string[] = [];
  for await (const event of session.resume(decisions)) events.push(event.type);
  const results = (await session.messages())
    .flatMap((message) => message.content)
    .filter((block): block is ToolResultContent => block.type === "tool_result");
  await agent.dispose();
  return {
    phase: "b",
    pid: process.pid,
    sessionId: session.id,
    approvalId,
    events,
    toolResult: results.at(-1)?.result,
    sideEffect: existsSync(join(dir, "side-effect.txt")),
  };
}

export async function demo(): Promise<Record<string, unknown>> {
  const args = process.argv.slice(2);
  const phase = args.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length) ?? "a";
  if (phase === "b") {
    const [dir, sessionId, approvalId] = args.filter((arg) => !arg.startsWith("--phase="));
    if (!dir || !sessionId || !approvalId) throw new Error("phase B needs a database directory, a session id, and an approval id");
    return phaseB(dir, sessionId, approvalId);
  }
  const script = process.argv[1];
  if (!script) throw new Error("phase A needs its own script path to spawn process B");
  return phaseA(script);
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
