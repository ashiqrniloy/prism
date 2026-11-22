import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import type { HostConfig } from "../host/index.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/prism-agent.ts");
const SESSION = "recover-after-crash";

export interface RecoverAfterCrashResult {
  /** The first process's signal: `SIGKILL` once the second model request arrives. */
  readonly crashSignal: string | null;
  /** The ledger's status for the killed run before the restart. */
  readonly ledgerStatus: string | undefined;
  readonly recoverExit: number | null;
  readonly recoveryLines: readonly Record<string, unknown>[];
  /** The file the tool round wrote before the crash. */
  readonly written: string | undefined;
  readonly roles: readonly string[];
  readonly finalText: string | undefined;
  /** A second sweep finds nothing left to do. */
  readonly secondSweep: readonly Record<string, unknown>[];
}

function cli(argv: readonly string[], mock: string) {
  return spawnSync(process.execPath, [BIN, ...argv], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PRISM_AGENT_MOCK: mock },
  });
}

const lines = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** A coding run is killed after its tool round; `prism-agent recover` on the same SQLite file finishes it. */
export async function recoverAfterCrash(root: string): Promise<RecoverAfterCrashResult> {
  mkdirSync(root, { recursive: true });
  const storePath = join(root, "s.db");
  const configPath = join(root, "prism-agent.json");
  const model = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
  const config: HostConfig = {
    models: { orchestrator: model, coding: model, research: model },
    storePath,
    workspace: root,
    approval: "auto",
    web: { backend: "obscura" },
    recovery: { olderThanMs: 0 },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const crashed = cli(["run", "--agent", "coding", "--config", configPath, "--session", SESSION, "Write note.txt"], "write-then-crash");
  const probe = createSqlitePersistence({ filename: storePath });
  try {
    const before = await probe.queryRuns({ sessionId: SESSION });
    const recovered = cli(["recover", "--agent", "coding", "--config", configPath], "text");
    const again = cli(["recover", "--agent", "coding", "--config", configPath], "text");
    const entries = await probe.queryEntries({ sessionId: SESSION, kind: "message", limit: 100 });
    const messages = entries.items.flatMap((entry): Message[] => (entry.message === undefined ? [] : [entry.message]));
    const last = messages.at(-1);
    const text = last?.content.find((part) => part.type === "text");
    const notePath = join(root, "note.txt");
    return {
      crashSignal: crashed.signal,
      ledgerStatus: before.items[0]?.status,
      recoverExit: recovered.status,
      recoveryLines: lines(recovered.stdout),
      written: existsSync(notePath) ? readFileSync(notePath, "utf8") : undefined,
      roles: messages.map((message) => message.role),
      finalText: text?.type === "text" ? text.text : undefined,
      secondSweep: lines(again.stdout),
    };
  } finally {
    probe.close?.();
  }
}
