import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { sqliteStore } from "@arnilo/prism-store-sqlite";

/**
 * A session survives a process restart on the SQLite store (roadmap Phase 6 Done):
 *
 * - process A lists `sqliteStore({ path })`, runs two turns, and bumps a counter the stand-in package
 *   keeps in `prism.state.session` (one `package_state` entry per write, on the session's branch);
 * - A spawns process B over the same database file and session id; B builds a new agent, reopens the
 *   session with `agent.session({ id })`, and prints the message count and the counter value;
 * - A asserts B's output: another pid, the same session, the same messages, and the counter the durable
 *   state carried across the process boundary.
 *
 * The stand-in package is defined inline with `definePackage` — no internal seam. Imports only
 * `@arnilo/prism`, `@arnilo/prism/testing`, and `@arnilo/prism-store-sqlite`; no credential, no network.
 * Run: bun examples/sqlite-resume.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;
const DEFAULT_STEP = 1;

interface CounterConfig {
  readonly step?: number;
}

const counter = definePackage<CounterConfig>({
  name: "@acme/sqlite-counter",
  version: "1.0.0",
  description: "Bumps a counter kept in session state.",
  requires: { api: 1 },
  capabilities: ["session-state"],
  config: {
    type: "object",
    properties: { step: { type: "integer", minimum: 1, default: DEFAULT_STEP } },
    additionalProperties: false,
  },
  setup(prism) {
    const total = prism.state.session("total", { n: 0 });
    const step = prism.config.step ?? DEFAULT_STEP;
    prism.commands.register({
      name: "bump",
      description: "Adds one step to the session total.",
      run: async (_args, { session }) => {
        if (!session) throw new Error("bump needs a session");
        const next = { n: total.get(session).n + step };
        await total.set(session, next);
        return next.n;
      },
    });
    prism.commands.register({
      name: "total",
      description: "Reads the session total.",
      run: (_args, { session }) => {
        if (!session) throw new Error("total needs a session");
        return total.get(session).n;
      },
    });
  },
});

function build(dir: string) {
  return createAgent({
    id: "sqlite-resume-demo",
    model: MODEL,
    packages: [
      sqliteStore({ path: join(dir, "sessions.db") }),
      counter({ step: DEFAULT_STEP }),
      mockProvider([
        [providerTextDelta("First turn."), providerDone()],
        [providerTextDelta("Second turn."), providerDone()],
      ]),
    ],
  });
}

type PhaseB = {
  readonly phase: string;
  readonly pid: number;
  readonly sessionId: string;
  readonly messageCount: number;
  readonly counter: number;
};

/** Process A: write a session and package state, then assert what a fresh process reads back. */
async function phaseA(script: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "prism-sqlite-resume-"));
  try {
    const agent = await build(dir);
    const session = await agent.session();
    await session.run("first turn");
    const afterFirst = await agent.commands.run("bump", {}, { session });
    await session.run("second turn");
    const afterSecond = await agent.commands.run("bump", {}, { session });
    const messages = await session.messages();
    await agent.dispose();

    const child = spawnSync("bun", [script, "--phase=b", dir, session.id], { encoding: "utf8" });
    assert.equal(child.status, 0, `phase B exited ${child.status}\n${child.stderr}`);
    const b = JSON.parse(child.stdout.trim().split("\n").at(-1) ?? "{}") as PhaseB;
    assert.equal(b.phase, "b", "phase B must report its phase");
    assert.notEqual(b.pid, process.pid, "phase B must be another process");
    assert.equal(b.sessionId, session.id, "phase B must reopen the same session id");
    assert.equal(b.messageCount, messages.length, "phase B must see the same messages");
    assert.equal(b.counter, afterSecond, "phase B must read the counter the store carried");

    return {
      phase: "a",
      sessionId: session.id,
      messageCount: messages.length,
      counter: { afterFirst, afterSecond },
      child: b,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Process B: a new agent over the same file, resuming by session id. */
async function phaseB(dir: string, sessionId: string): Promise<PhaseB> {
  const agent = await build(dir);
  const session = await agent.session({ id: sessionId });
  const messages = await session.messages();
  const counter = await agent.commands.run("total", {}, { session });
  await agent.dispose();
  return { phase: "b", pid: process.pid, sessionId: session.id, messageCount: messages.length, counter: Number(counter) };
}

export async function demo(): Promise<Record<string, unknown>> {
  const args = process.argv.slice(2);
  const phase = args.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length) ?? "a";
  if (phase === "b") {
    const [dir, sessionId] = args.filter((arg) => !arg.startsWith("--phase="));
    if (!dir || !sessionId) throw new Error("phase B needs a database directory and a session id");
    return phaseB(dir, sessionId);
  }
  const script = process.argv[1];
  if (!script) throw new Error("phase A needs its own script path to spawn process B");
  return phaseA(script);
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
