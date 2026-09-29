import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AIProvider, createMockProvider, type ProviderRequest, providerDone } from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import { assembleAppAgent } from "../headless.js";
import { searchRepoSessions } from "../sessions.js";
import { createPrismCodeTui } from "../tui/index.js";

const tmp = () => mkdtemp(join(tmpdir(), "prism-code-process-"));

async function setup(dir: string, provider: AIProvider, onExit: (code: number) => void) {
  const env = await createTestRenderer({ width: 80, height: 24 });
  let destroys = 0;
  const destroy = env.renderer.destroy.bind(env.renderer);
  env.renderer.destroy = () => {
    destroys++;
    destroy();
  };
  const definition = await assembleAppAgent(
    { cwd: dir, store: { type: "sqlite", path: join(dir, "session.db") }, tools: { planes: { coding: false } } },
    provider,
  );
  const tui = createPrismCodeTui({ renderer: env.renderer, config: { cwd: dir }, onExit });
  await tui.start(definition);
  return { tui, definition, destroys: () => destroys };
}

describe("TUI fatal and signal shutdown", () => {
  it("uncaught exception and rejection restore terminal, report error, exit 1", async () => {
    for (const kind of ["uncaughtListener", "rejectionListener"] as const) {
      const dir = await tmp();
      const output: string[] = [];
      const originalWrite = process.stderr.write;
      const originalDebug = process.env.PRISM_DEBUG;
      try {
        let resolveExit!: (code: number) => void;
        const exited = new Promise<number>((resolve) => {
          resolveExit = resolve;
        });
        const { tui, definition, destroys } = await setup(dir, createMockProvider([providerDone()]), resolveExit);
        assert.ok(
          (kind === "uncaughtListener" ? process.listeners("uncaughtException") : process.listeners("unhandledRejection")).includes(
            (tui as any)[kind],
          ),
        );
        process.env.PRISM_DEBUG = kind === "rejectionListener" ? "1" : "0";
        process.stderr.write = ((text: string) => {
          output.push(text);
          return true;
        }) as typeof process.stderr.write;
        (tui as any)[kind](new Error("fatal test error"));
        assert.equal(await exited, 1);
        assert.equal(destroys(), 1);
        assert.ok(output.join("").includes("fatal test error"));
        assert.equal(output.join("").includes("at "), kind === "rejectionListener", "stack shown only with PRISM_DEBUG=1");
        await definition.dispose();
      } finally {
        process.stderr.write = originalWrite;
        if (originalDebug === undefined) delete process.env.PRISM_DEBUG;
        else process.env.PRISM_DEBUG = originalDebug;
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("SIGTERM and SIGHUP abort active run, persist session, restore renderer, exit with signal code", async () => {
    for (const [listener, code] of [
      ["sigtermListener", 143],
      ["sighupListener", 129],
    ] as const) {
      const dir = await tmp();
      try {
        let resolveEntry!: () => void;
        let resolveExit!: (code: number) => void;
        const entered = new Promise<void>((resolve) => {
          resolveEntry = resolve;
        });
        const exited = new Promise<number>((resolve) => {
          resolveExit = resolve;
        });
        let aborted = false;
        const provider: AIProvider = {
          id: "mock-slow",
          async *generate(req: ProviderRequest) {
            resolveEntry();
            await new Promise<void>((resolve) => {
              req.signal?.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  resolve();
                },
                { once: true },
              );
            });
            yield providerDone();
          },
        };
        const { tui, definition, destroys } = await setup(dir, provider, resolveExit);
        void (tui as any).handlePromptSubmit("persist me");
        await entered;
        (tui as any)[listener]();
        assert.equal(await exited, code);
        assert.equal(aborted, true);
        assert.equal(destroys(), 1);
        const store = definition.agent.config.store;
        assert.ok(store, "assembled agent exposes a store");
        const matches = await searchRepoSessions(store, { workspaceRoot: dir });
        assert.ok(matches.items.length > 0, "session record persisted before exit");
        await definition.dispose();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});
