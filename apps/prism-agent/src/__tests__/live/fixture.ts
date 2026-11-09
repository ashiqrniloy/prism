/**
 * The live provider journey's one fixture (plan 215 Task 32). It is the only module that names a
 * provider: `JOURNEY_PROVIDERS` maps the `PRISM_LIVE_JOURNEY_PROVIDER` switch to a provider package
 * instance, its key, and its model variable. Everything else is provider-agnostic and is shared by the
 * suite and the resume child process, so both build the same agent (the resume fingerprint must match).
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Agent,
  type AgentConfig,
  type AgentEvent,
  createAgent,
  definePackage,
  type HostUi,
  type ModelConfig,
  type PackageInstance,
  type ProviderEvent,
  type ProviderRequest,
} from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-approval";
import { commandcode } from "@arnilo/prism-provider-commandcode";
import { hyper } from "@arnilo/prism-provider-hyper";
import { ollamaCloud } from "@arnilo/prism-provider-ollama-cloud";
import { opencodeGo } from "@arnilo/prism-provider-opencode-go";
import { sqliteStore } from "@arnilo/prism-store-sqlite";
import { toolsCoding } from "@arnilo/prism-tools-coding";

/** One journey provider: its package (with the counting transport), key variable, and model. */
export interface JourneyProvider {
  readonly name: string;
  /** npm name of the provider package; the name-isolation test reads it. */
  readonly packageName: string;
  readonly keyEnv: string;
  readonly modelEnv: string;
  readonly defaultModel: string;
  readonly pkg: (fetch: typeof globalThis.fetch) => PackageInstance;
}

/** Keys are only ever `env:` refs; the suite reads the key's value only to seed the leak scan. */
export const JOURNEY_PROVIDERS: Readonly<Record<string, JourneyProvider>> = {
  hyper: {
    name: "hyper",
    packageName: "@arnilo/prism-provider-hyper",
    keyEnv: "HYPER_API_KEY",
    modelEnv: "PRISM_LIVE_HYPER_JOURNEY_MODEL",
    defaultModel: "deepseek-v4-pro",
    pkg: (fetch) => hyper({ apiKey: "env:HYPER_API_KEY", fetch }),
  },
  "opencode-go": {
    name: "opencode-go",
    packageName: "@arnilo/prism-provider-opencode-go",
    keyEnv: "OPENCODE_GO_API_KEY",
    modelEnv: "PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL",
    defaultModel: "mimo-v2.5",
    pkg: (fetch) => opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY", fetch }),
  },
  // Owner direction 2026-11-08: the journey also runs on Command Code and Ollama Cloud.
  commandcode: {
    name: "commandcode",
    packageName: "@arnilo/prism-provider-commandcode",
    keyEnv: "COMMAND_CODE_API_KEY",
    modelEnv: "PRISM_LIVE_COMMANDCODE_JOURNEY_MODEL",
    defaultModel: "Qwen/Qwen3.7-Flash",
    pkg: (fetch) => commandcode({ apiKey: "env:COMMAND_CODE_API_KEY", fetch }),
  },
  "ollama-cloud": {
    name: "ollama-cloud",
    packageName: "@arnilo/prism-provider-ollama-cloud",
    keyEnv: "OLLAMA_API_KEY",
    modelEnv: "PRISM_LIVE_OLLAMA_CLOUD_JOURNEY_MODEL",
    defaultModel: "gemma4:31b",
    pkg: (fetch) => ollamaCloud({ apiKey: "env:OLLAMA_API_KEY", fetch }),
  },
};

/** Per provider, per full run. The README and the manifest rows state the same numbers. */
export const JOURNEY_BUDGET = { maxRequests: 36, maxInputTokens: 80_000 } as const;
export const SCENARIO_TIMEOUT_MS = 120_000;

/** Why the live suite skips under `env`, or `undefined` when every switch and the key are set. */
export function journeySkipReason(env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (env.PRISM_LIVE_PROVIDER_TESTS !== "1") return "PRISM_LIVE_PROVIDER_TESTS is not 1";
  if (env.PRISM_LIVE_RELEASE_JOURNEY !== "1") return "PRISM_LIVE_RELEASE_JOURNEY is not 1";
  const name = env.PRISM_LIVE_JOURNEY_PROVIDER;
  if (name === undefined || name === "") return "PRISM_LIVE_JOURNEY_PROVIDER is not set";
  const provider = JOURNEY_PROVIDERS[name];
  if (provider === undefined) return `PRISM_LIVE_JOURNEY_PROVIDER must be one of ${Object.keys(JOURNEY_PROVIDERS).join(", ")}`;
  if (!env[provider.keyEnv]) return `${provider.keyEnv} is not set`;
  return undefined;
}

/** The selected provider; call only after `journeySkipReason` returned `undefined`. */
export function journeyProvider(env: Readonly<Record<string, string | undefined>>): JourneyProvider & { readonly model: string } {
  const provider = JOURNEY_PROVIDERS[env.PRISM_LIVE_JOURNEY_PROVIDER ?? ""];
  if (provider === undefined) throw new Error("journeyProvider: no provider selected");
  return { ...provider, model: env[provider.modelEnv] || provider.defaultModel };
}

export class JourneyBudgetError extends Error {
  constructor(axis: string, observed: number, maximum: number) {
    super(`journey budget exceeded: ${axis} ${observed} > ${maximum}`);
    this.name = "JourneyBudgetError";
  }
}

/**
 * Request and input-token ceilings for one provider's full run. Two counters share the request ceiling:
 * `modelCalls` (every agent turn, through the `model.call` hook) and `transport` (every HTTP request the
 * provider package sends, including the compaction summary and catalog calls, which bypass `model.call`).
 * Over a ceiling the request is refused before it is sent, and `tripped` records why.
 */
export class JourneyBudget {
  modelCalls = 0;
  transport = 0;
  /** Every request the `model.call` hook saw, in order (the tool-loop scenario reads the replayed thinking). */
  readonly calls: ProviderRequest[] = [];
  inputTokens = 0;
  tripped: string | undefined;
  constructor(
    readonly maxRequests: number = JOURNEY_BUDGET.maxRequests,
    readonly maxInputTokens: number = JOURNEY_BUDGET.maxInputTokens,
  ) {}
  get requests(): number {
    return Math.max(this.modelCalls, this.transport);
  }
  remaining(): { readonly maxRequests: number; readonly maxInputTokens: number } {
    return { maxRequests: this.maxRequests - this.requests, maxInputTokens: this.maxInputTokens - this.inputTokens };
  }
  /** Adds what the resume child process spent. */
  absorb(spent: { readonly requests: number; readonly inputTokens: number }): void {
    this.modelCalls += spent.requests;
    this.transport += spent.requests;
    this.inputTokens += spent.inputTokens;
    this.check();
  }
  countModelCall(): void {
    this.modelCalls += 1;
    this.check();
  }
  countTransport(): void {
    this.transport += 1;
    this.check();
  }
  addInputTokens(tokens: number): void {
    this.inputTokens += tokens;
    this.check();
  }
  private check(): void {
    const over =
      this.requests > this.maxRequests
        ? new JourneyBudgetError("requests", this.requests, this.maxRequests)
        : this.inputTokens > this.maxInputTokens
          ? new JourneyBudgetError("input tokens", this.inputTokens, this.maxInputTokens)
          : undefined;
    if (over === undefined) return;
    this.tripped ??= over.message;
    throw over;
  }
  /** A `fetch` that counts every request against the ceiling and refuses one past it. */
  fetch(): typeof globalThis.fetch {
    const counted = (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      this.countTransport();
      return globalThis.fetch(input, init);
    }) as typeof globalThis.fetch;
    return counted;
  }
}

/** The counting `model.call` hook, as a package so the child process installs the identical hook. */
export function journeyBudgetPackage(budget: JourneyBudget): PackageInstance {
  return definePackage({
    name: "journey-budget",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on(
        "model.call",
        async (request, next) => {
          budget.countModelCall();
          budget.calls.push(request);
          const stream = await next(request);
          return (async function* (): AsyncGenerator<ProviderEvent> {
            // A provider may report usage on a `usage` event, on `done`, or both (cumulative): count the
            // growth as it arrives, so an overrun throws before the turn's `done` reaches the loop.
            let counted = 0;
            for await (const event of stream) {
              const input = event.type === "usage" || event.type === "done" ? event.usage?.inputTokens : undefined;
              if (input !== undefined && input > counted) {
                budget.addInputTokens(input - counted);
                counted = input;
              }
              yield event;
            }
          })();
        },
        { id: "journey-budget" },
      );
    },
  })();
}

/** A temp git repository with a README whose first line the tool-loop scenario quotes. */
export interface JourneyWorkspace {
  readonly dir: string;
  readonly root: string;
  readonly dbPath: string;
}

export const README_FIRST_LINE = "Prism journey marker: amber-falcon-42";

export function createWorkspace(prefix = "prism-live-journey-"): JourneyWorkspace {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const root = join(dir, "repo");
  mkdirSync(root);
  spawnSync("git", ["init", "-q"], { cwd: root, timeout: 10_000 });
  writeFileSync(join(root, "README.md"), `${README_FIRST_LINE}\n\nA scratch repository for the live journey.\n`);
  // Scenario 7: the pointer names a file the model cannot guess, so the answer needs two tool rounds.
  writeFileSync(join(root, "POINTER.md"), "The answer is in the file named clue-7f3a.txt in this directory.\n");
  writeFileSync(join(root, "clue-7f3a.txt"), "The answer is cobalt.\n");
  return { dir, root, dbPath: join(dir, "journey.db") };
}

export interface JourneyAgentOptions {
  readonly provider: JourneyProvider & { readonly model: string };
  /** The resolved model, from the provider catalog when it lists one. */
  readonly model: ModelConfig;
  readonly workspace: JourneyWorkspace;
  readonly budget: JourneyBudget;
  /** Adds the SQLite store; omitted, the kernel's in-memory store is used. */
  readonly sqlite?: boolean;
  readonly extraPackages?: readonly PackageInstance[];
  readonly host?: { readonly ui?: HostUi };
  readonly limits?: AgentConfig["limits"];
  readonly ownership?: AgentConfig["ownership"];
  readonly id?: string;
}

export const JOURNEY_PRINCIPAL = { kind: "user", id: "journey" } as const;

export const UNUSED_CODING_TOOLS = ["edit", "grep", "glob", "delete", "move", "ask_user_decision"] as const;

/** Every per-run ceiling the journey uses unless a scenario narrows it further. */
export const RUN_LIMITS = { maxTurns: 6, maxInputTokens: 20_000 } as const;

/**
 * Builds the journey agent: the provider package, the coding tools (no shell, git, todo, or worktrees,
 * so the tool list stays small), the approval package with a static allow for `read`, and the budget hook.
 */
export async function buildJourneyAgent(options: JourneyAgentOptions): Promise<Agent> {
  const packages: PackageInstance[] = [
    options.provider.pkg(options.budget.fetch()),
    toolsCoding({
      root: options.workspace.root,
      shell: { enabled: false },
      git: { enabled: false },
      todo: { enabled: false },
      workspace: { enabled: false },
    }),
    approvalPackage({ mode: "ask", rules: [{ tool: "read" }] }),
    ...(options.sqlite === true ? [sqliteStore({ path: options.workspace.dbPath })] : []),
    journeyBudgetPackage(options.budget),
    ...(options.extraPackages ?? []),
  ];
  const agent = await createAgent({
    id: options.id ?? "journey",
    model: options.model,
    limits: options.limits ?? RUN_LIMITS,
    // Only `read` and `write` are offered: the other coding tools' schemas would cost ~2k input tokens a request.
    disable: { tools: [...UNUSED_CODING_TOOLS] },
    // `write` is a durable effect: it needs a principal and an ownership scope. `toolsCoding` pins no
    // principal id, so a remote principal (scenario 9) may write. The scope leaves `userId`
    // open so a session (scenario 6) or a remote principal (scenario 9) can narrow it.
    principal: JOURNEY_PRINCIPAL,
    ownership: options.ownership ?? { tenantId: "journey" },
    ...(options.host === undefined ? {} : { host: options.host }),
    packages,
  });
  listed.set(agent, packages);
  return agent;
}

const listed = new WeakMap<Agent, readonly PackageInstance[]>();

/**
 * Each listed package's load status from `agent.inspect()` joined with its definition's `requires.api`.
 * `inspect()` does not report `requires`, so the level is read from the instance the journey listed.
 */
export function apiLevelsOf(
  agent: Agent,
): { readonly name: string; readonly status: string | undefined; readonly api: number | undefined }[] {
  const inspected = agent.inspect().packages;
  return (listed.get(agent) ?? []).map((instance) => ({
    name: instance.definition.name,
    status: inspected.find((entry) => entry.name === instance.definition.name)?.status,
    api: instance.definition.requires?.api,
  }));
}

/**
 * The catalog entry for the model id, or a bare model when the catalog omits it. Discovery is not
 * generation, and its cost varies by provider (one `GET /models`, or `/api/tags` plus one `/api/show`
 * per model), so it is counted on its own and reported next to the budget rather than charged to it.
 */
export async function resolveJourneyModel(
  provider: JourneyProvider & { readonly model: string },
): Promise<{ readonly model: ModelConfig; readonly catalogRequests: number }> {
  const catalog = new JourneyBudget(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const probe = await createAgent({
    id: "journey-catalog",
    model: { provider: provider.name, model: provider.model },
    packages: [provider.pkg(catalog.fetch())],
  });
  try {
    const found = (await probe.models.list()).find((model) => model.model === provider.model && model.provider === provider.name);
    return { model: found ?? { provider: provider.name, model: provider.model }, catalogRequests: catalog.transport };
  } finally {
    await probe.dispose();
  }
}

export async function collect(stream: AsyncIterable<AgentEvent>, into: AgentEvent[] = []): Promise<AgentEvent[]> {
  for await (const event of stream) into.push(event);
  return into;
}

/**
 * The leak scan: the serialized value must not contain any secret. It is the same substring rule as the
 * kernel's `assertNoSecretLeak` (`@arnilo/prism/provider-kit`, a subpath the reference host may not
 * import), and its message names the place, never the secret.
 */
export function assertNoLeak(label: string, value: unknown, secrets: readonly string[]): void {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, (_key, item) => (item instanceof Error ? `${item.name}: ${item.message}` : item)) ?? "");
  for (const secret of secrets) if (secret.length > 0 && text.includes(secret)) throw new Error(`secret leak found in ${label}`);
}

/** Every row of every table in the SQLite file, for the leak scan. */
export function sqliteRows(path: string): Record<string, unknown[]> {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const rows: Record<string, unknown[]> = {};
    for (const { name } of tables) rows[name] = db.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
    return rows;
  } finally {
    db.close();
  }
}

/** The text of every message of a transcript or run, for substring assertions. */
export function textOf(value: unknown): string {
  return JSON.stringify(value);
}
