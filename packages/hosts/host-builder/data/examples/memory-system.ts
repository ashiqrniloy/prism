import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type Session,
  toolCallContent,
} from "@arnilo/prism";
import memorySystem, {
  MEMORY_LTM_SERVICE,
  MEMORY_SYSTEM_SERVICE,
  type MemoryLtmPort,
  type MemorySystemConfig,
  type MemorySystemService,
} from "@arnilo/prism-memory-system";

/**
 * The memory system's four partial-use profiles (plan 216 Task 6), each run end to end on one agent:
 *
 * - **`ltm`** (`{ stm: false, ltm }`): long-term memory alone. The model writes a fact note with `memory.insert`; there
 *   are no session tiers, no `recall` tool, no `memory:session` command and no `compaction` slot claim.
 * - **`session`** (`{ stm, wm }`, the defaults): the session tiers with no cross-session store. A turn is observed and
 *   the observations are reflected; no `memory.*` tool and no `memory.ltm` service exist.
 * - **`stm`** (`{ stm, wm: false }`): an event log with verbatim recall. Observed, never reflected.
 * - **`full`** (every component): observed, reflected and rehearsed (today's dropper, the `lowest-relevance` policy so
 *   it needs no model call), plus a long-term note. `sleep` is on and still a no-op.
 *
 * For each profile the demo asserts which tools, commands, slot claim and capabilities the package holds, and reads the
 * `memory.system` service's `status()`. A component turned off loads and registers nothing. The worker models are
 * scripted in one inline mock provider (`mock/main`, `mock/observer`, `mock/reflector`): no credential, no network.
 * Run: `bun examples/memory-system.ts` (`--json` prints the per-profile report the package test reads).
 */

const MAIN_MODEL = { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } } as const;
const PACKAGE = "@arnilo/prism-memory-system";
const FACT = "The retry budget is capped at three attempts.";

export type ProfileName = "ltm" | "session" | "stm" | "full";

const STM = { model: "mock/observer", triggerTokens: 1 } as const;
const WM = { model: "mock/reflector", observationTokens: 1 } as const;

/** The four profiles: documented recipes, not a config field. `root` is the long-term memory's directory. */
function profileConfig(profile: ProfileName, root: string): MemorySystemConfig {
  const ltm = { tools: { root } };
  switch (profile) {
    case "ltm":
      return { stm: false, ltm };
    case "session":
      return { stm: STM, wm: WM };
    case "stm":
      return { stm: STM, wm: false };
    case "full":
      return { stm: STM, wm: WM, rehearsal: { targetTokens: 1, policy: "lowest-relevance" }, ltm, sleep: {} };
  }
}

/** The observer: one `record_event` call sourced from the first entry its prompt lists. */
function observe(request: ProviderRequest): ProviderEvent[] {
  const prompt = request.messages.find((message) => message.role === "user")?.content[0];
  const sourceId = prompt?.type === "text" ? /\[[^\]]+\] \[([^\]]+)\] message:/.exec(prompt.text)?.[1] : undefined;
  if (request.messages.some((message) => message.role === "tool") || !sourceId) return [providerDone()];
  return [
    providerToolCall(
      toolCallContent("observe-1", "record_event", { kind: "statement", description: FACT, relevance: "high", sourceEntryIds: [sourceId] }),
    ),
    providerDone(),
  ];
}

/** The reflector: one `record_reflection` call supported by the first observation id its prompt lists. */
function reflect(request: ProviderRequest): ProviderEvent[] {
  const prompt = request.messages.find((message) => message.role === "user")?.content[0];
  const id = prompt?.type === "text" ? /\b([a-f0-9]{12})\b/.exec(prompt.text)?.[1] : undefined;
  if (request.messages.some((message) => message.role === "tool") || !id) return [providerDone()];
  return [
    providerToolCall(toolCallContent("reflect-1", "record_reflection", { content: `Durable: ${FACT}`, supportingObservationIds: [id] })),
    providerDone(),
  ];
}

/** The main model: writes the fact note when `memory.insert` is offered, then acknowledges. */
function answer(request: ProviderRequest): ProviderEvent[] {
  const offered = request.tools?.some((tool) => tool.name === "memory.insert") === true;
  const answered = request.messages.some((message) => message.role === "tool");
  if (offered && !answered) {
    return [
      providerToolCall(toolCallContent("insert-1", "memory.insert", { text: FACT, kind: "fact", scope: "project", keywords: ["retry"] })),
      providerDone(),
    ];
  }
  return [providerTextDelta("Noted."), providerDone()];
}

export interface ProfileReport {
  readonly profile: ProfileName;
  readonly capabilities: readonly string[];
  readonly compactionOwner: string;
  readonly tools: readonly string[];
  readonly commands: readonly string[];
  readonly components: Readonly<Record<string, boolean>>;
  readonly ltmService: boolean;
  readonly modelCalls: Readonly<Record<string, number>>;
  readonly observations: number;
  readonly reflections: number;
  readonly dropped: number;
  readonly facts: number;
}

interface SessionStatus {
  readonly observations: { readonly recorded: number; readonly dropped: number };
  readonly reflections: { readonly recorded: number };
  readonly inFlight: boolean;
}

/** Waits until the background pass a turn started has recorded an observation and settled. */
async function settled(agent: Agent, session: Session): Promise<SessionStatus> {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const status = (await agent.commands.run("memory:session:status", {}, { session })) as SessionStatus;
    if (status.observations.recorded > 0 && !status.inFlight) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the session tiers' background pass did not settle");
}

export async function runProfile(profile: ProfileName): Promise<ProfileReport> {
  const root = await mkdtemp(join(tmpdir(), `prism-memory-system-${profile}-`));
  const modelCalls: Record<string, number> = {};
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      const model = request.model.model;
      modelCalls[model] = (modelCalls[model] ?? 0) + 1;
      yield* model === "observer" ? observe(request) : model === "reflector" ? reflect(request) : answer(request);
    },
  };
  let services: { system?: MemorySystemService; ltm?: MemoryLtmPort } = {};
  const host = definePackage({
    name: "@example/memory-system-host",
    version: "0.0.0",
    description: "The demo's scripted provider, and a read of the services the memory system provides.",
    requires: { api: 1 },
    setup(prism) {
      prism.providers.register(provider);
      prism.hooks.on("session.opened", () => {
        services = {
          system: prism.services.consume<MemorySystemService>(MEMORY_SYSTEM_SERVICE),
          ltm: prism.services.consume<MemoryLtmPort>(MEMORY_LTM_SERVICE),
        };
      });
    },
  })();
  const agent = await createAgent({
    id: `memory-system-${profile}`,
    model: MAIN_MODEL,
    slots: { store: createMemorySessionStore() },
    packages: [host, memorySystem(profileConfig(profile, root))],
  });
  try {
    const inspection = agent.inspect();
    const session = await agent.session({ id: profile, create: true });
    const components: Readonly<Record<string, boolean>> = services.system?.status().components ?? {};
    // The session tiers are gated per session: this one turns them on.
    if (components.stm) await agent.commands.run("memory:session", {}, { session });
    await session.run(`Remember this: ${FACT}`);
    const status = components.stm ? await settled(agent, session) : undefined;
    const facts = services.ltm
      ? (await services.ltm.scanMetadata("project", { limit: 50 })).notes.filter((note) => note.kind === "fact").length
      : 0;
    await session.close();
    return {
      profile,
      capabilities: [...(inspection.packages.find((entry) => entry.name === PACKAGE)?.capabilities ?? [])].sort(),
      compactionOwner: inspection.slots.compaction,
      tools: inspection.tools
        .filter((tool) => tool.package === PACKAGE)
        .map((tool) => tool.name)
        .sort(),
      commands: inspection.commands
        .filter((command) => command.package === PACKAGE)
        .map((command) => command.name)
        .sort(),
      components,
      ltmService: services.ltm !== undefined,
      modelCalls,
      observations: status?.observations.recorded ?? 0,
      reflections: status?.reflections.recorded ?? 0,
      dropped: status?.observations.dropped ?? 0,
      facts,
    };
  } finally {
    await agent.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

/** What each profile must show; the package test asserts the same through `--json`. */
export function checkProfile(report: ProfileReport): void {
  const { profile } = report;
  const on = (name: string) => report.components[name] === true;
  const memoryTools = report.tools.filter((tool) => tool.startsWith("memory."));
  // Long-term memory: its tools and its read-only port exist only when `ltm` is on, and it stored the fact.
  assert.equal(memoryTools.length > 0, on("ltm"), `${profile}: memory.* tools follow ltm`);
  assert.equal(report.ltmService, on("ltm"), `${profile}: the memory.ltm service follows ltm`);
  assert.equal(report.facts, on("ltm") ? 1 : 0, `${profile}: the fact note`);
  // The session tiers: the recall tool, the memory:session commands and the compaction slot follow stm.
  assert.equal(report.tools.includes("recall"), on("stm"), `${profile}: recall follows stm`);
  assert.equal(report.commands.includes("memory:session"), on("stm"), `${profile}: memory:session follows stm`);
  assert.equal(report.compactionOwner === PACKAGE, on("stm"), `${profile}: the compaction slot follows stm`);
  assert.equal(report.capabilities.includes("slot:compaction"), on("stm"), `${profile}: slot:compaction follows stm`);
  assert.equal(report.capabilities.includes("credentials"), on("ltm"), `${profile}: credentials follows ltm`);
  // The passes: observed with stm, reflected only with wm, rehearsed (dropped) only with rehearsal.
  assert.equal(report.observations > 0, on("stm"), `${profile}: observations`);
  assert.equal(report.reflections > 0, on("wm"), `${profile}: reflections`);
  assert.equal((report.modelCalls.reflector ?? 0) > 0, on("wm"), `${profile}: the reflector model is called only with wm`);
  assert.equal((report.modelCalls.observer ?? 0) > 0, on("stm"), `${profile}: the observer model is called only with stm`);
  assert.equal(report.dropped > 0, on("rehearsal"), `${profile}: rehearsal drops only when on`);
}

const PROFILES: readonly ProfileName[] = ["ltm", "session", "stm", "full"];

if (import.meta.main) {
  const reports: ProfileReport[] = [];
  for (const profile of PROFILES) {
    const report = await runProfile(profile);
    checkProfile(report);
    reports.push(report);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(reports));
  else
    for (const report of reports) {
      const components = Object.entries(report.components)
        .filter(([, on]) => on)
        .map(([name]) => name)
        .join("+");
      console.log(
        `${report.profile.padEnd(7)} components ${components.padEnd(26)} tools ${String(report.tools.length).padStart(2)}  ` +
          `observations ${report.observations}  reflections ${report.reflections}  dropped ${report.dropped}  facts ${report.facts}  ` +
          `slot ${report.compactionOwner === PACKAGE ? "claimed" : "not claimed"}  capabilities [${report.capabilities.join(", ")}]`,
      );
    }
}
