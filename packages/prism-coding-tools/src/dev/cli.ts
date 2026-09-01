#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
/**
 * Plan 040 Task 4 — `prism-dev` bin and the programmatic runner that
 * `prism dev` delegates into. Boots the inspector against the current
 * `prism init` scaffold's agent (`dist/agent.js` exporting `createAppAgent`)
 * and serves it on loopback.
 *
 * Security posture: this process never reads `process.env` for secrets —
 * credentials belong to the scaffolded agent config (its provider closure).
 * Non-loopback `--host` values surface the inspector's own fail-closed
 * refusal from `listen()`; the bin has no remote-authorization flag.
 */
import process from "node:process";
import type { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { Agent } from "@arnilo/prism";
import { createPrismDevInspector, type PrismDevInspector } from "./index.js";

export interface DevCliRuntime {
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Working directory holding the scaffold (`dist/agent.js`). Default: `process.cwd()`. */
  readonly cwd?: string;
  /** Test seam: closes the inspector when aborted (production uses SIGINT). */
  readonly signal?: AbortSignal;
}

const usage = `Usage: prism-dev [--port <n>] [--host <addr>]
       prism dev    [--port <n>] [--host <addr>]   (delegates into @arnilo/prism-coding-tools/dev)

Boots the loopback inspector over the current prism-init scaffold's agent
(dist/agent.js → createAppAgent()). Default bind 127.0.0.1:4311. A
non-loopback --host is refused unless remote authorization is wired
programmatically. Credentials stay in the agent config — never read from the
environment here.
`;

function resolveScaffoldAgent(cwd: string, stderr: Writable): Promise<Agent | undefined> {
  const entry = join(cwd, "dist", "agent.js");
  return import(entryHref(cwd)).then(
    (mod: { createAppAgent?: () => Agent; default?: () => Agent }) => {
      const factory = mod.createAppAgent ?? mod.default;
      if (typeof factory !== "function") {
        stderr.write(`prism dev: ${entry} must export createAppAgent() — the prism init scaffold does this by default.\n`);
        return undefined;
      }
      return factory();
    },
    (error: unknown) => {
      const cause = error instanceof Error ? error.message : String(error);
      // Missing entry → not built yet; anything else → the scaffold's own deps.
      stderr.write(
        existsSync(entry)
          ? `prism dev: cannot load ${entry} — missing dependency in the scaffold (run npm install).\n  ${cause.split("\n")[0]}\n`
          : `prism dev: cannot load ${entry} — build the project first (npm run build), then re-run prism dev.\n`,
      );
      return undefined;
    },
  );
}

function entryHref(cwd: string): string {
  return pathToFileURL(join(cwd, "dist", "agent.js")).href;
}

/**
 * Runs the dev inspector until aborted (SIGINT in production). Resolves with
 * the process exit code. Start-to-listen stays under 1s: one dynamic module
 * load plus the inspector's loopback bind, no network calls.
 */
export async function runDevCli(argv: ReadonlyArray<string>, runtime: Partial<DevCliRuntime> = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const cwd = runtime.cwd ?? process.cwd();

  let host: string | undefined;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "-h" || flag === "--help") {
      stdout.write(usage);
      return 0;
    }
    if (flag === "--host") {
      host = argv[index + 1];
      if (!host) {
        stderr.write(`prism dev: --host requires a value\n${usage}`);
        return 2;
      }
      index += 1;
      continue;
    }
    if (flag === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        stderr.write(`prism dev: --port requires an integer 0-65535\n${usage}`);
        return 2;
      }
      port = value;
      index += 1;
      continue;
    }
    stderr.write(`prism dev: unknown argument ${flag}\n${usage}`);
    return 2;
  }

  const agent = await resolveScaffoldAgent(cwd, stderr);
  if (!agent) return 2;

  const inspectorOptions = {
    agent,
    ...(host !== undefined ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
  };
  let inspector: PrismDevInspector;
  try {
    // Construction fail-closes non-loopback hosts before any listener exists.
    inspector = createPrismDevInspector(inspectorOptions);
    await inspector.listen();
  } catch (error) {
    stderr.write(`prism dev: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  stdout.write(`prism dev → ${inspector.url} (press Ctrl+C to stop)\n`);

  return new Promise<number>((resolve) => {
    const stop = async (): Promise<void> => {
      await inspector.close().catch(() => undefined);
      resolve(0);
    };
    if (runtime.signal) {
      if (runtime.signal.aborted) {
        void stop();
        return;
      }
      runtime.signal.addEventListener("abort", () => void stop(), { once: true });
    } else {
      process.once("SIGINT", () => void stop());
    }
  });
}

/** Direct-bin entry point (the `prism-dev` command). */
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runDevCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`prism dev: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
