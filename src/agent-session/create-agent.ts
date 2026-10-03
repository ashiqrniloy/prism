/** create-agent (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  OwnershipScope,
  SessionEntry,
  SessionOptions,
  Skill,
  SubscribeOptions,
} from "../contracts.js";
import { SessionNotFoundError } from "../contracts-core/session.js";
import { inspectAgent } from "../agent/inspect.js";
import { createHookBus } from "../hooks/index.js";
import { mergeManifestSlots } from "../packages/define.js";
import { loadPackages } from "../packages/loader.js";
import { createSlotDefaults, createSlotRegistry } from "../slots/index.js";
import { registerSkillCatalog } from "../skills-catalog.js";
import { KERNEL_VERSION } from "../version.js";
import { entriesInScope, getSessionBranchEntries } from "../session-stores.js";
import { createModelIndex } from "../agent/models.js";
import { createSessionIndex } from "../agent/sessions.js";
import { skillInfos, toolInfos } from "../agent/views.js";
import { EventSubscriber } from "./event-subscriber.js";
import { randomId } from "./helpers.js";
import { type AgentRuntime, registerAgentRuntime } from "./runtime-registry.js";
import { RuntimeAgentSession } from "./session.js";

export { agentRuntime, tryAgentRuntime, type AgentRuntime } from "./runtime-registry.js";

/** Test seam: the kernel version a package's `requires.prism` is checked against. */
export interface CreateAgentInternals {
  readonly kernelVersion?: string;
  /** Reads a `skills.addDir` directory. Defaults to the Node reader, imported only when a package asks. */
  readonly readSkillDir?: (path: string) => Promise<readonly Skill[]>;
}

/** The fs read lives in `node/`, so the kernel root's static imports stay fs-free. */
async function readSkillDirectory(path: string): Promise<readonly Skill[]> {
  const { loadSkillDirectory } = await import("../node/contribution-discovery.js");
  return loadSkillDirectory(path);
}

/** Read `AgentConfig.skills.dirs` once per agent, through the same reader as `PackageAPI.skills.addDir`. */
async function resolveHostSkillDirs(config: AgentConfig, read: (path: string) => Promise<readonly Skill[]>): Promise<AgentConfig> {
  const dirs = config.skills?.dirs;
  if (!dirs?.length) return config;
  const loaded: Skill[] = [];
  for (const dir of dirs) {
    if (typeof dir !== "string" || !dir.length) throw new TypeError("skills.dirs requires a directory path");
    loaded.push(...(await read(dir)));
  }
  return { ...config, skills: { ...config.skills, add: [...(config.skills?.add ?? []), ...loaded] } };
}

export async function createAgent(config: AgentConfig): Promise<Agent> {
  return createAgentWith(config, {});
}

/** `createAgent` with internal seams. Not exported from the root. */
export async function createAgentWith(config: AgentConfig, internals: CreateAgentInternals): Promise<Agent> {
  if ("store" in (config as unknown as Record<string, unknown>) && (config as unknown as Record<string, unknown>).store !== undefined) {
    throw new TypeError("AgentConfig.store was removed in Prism 1.0; assign the store slot via AgentConfig.slots.store instead");
  }

  let sink: ((event: AgentEvent) => void) | undefined;
  const agentSubscribers = new Set<EventSubscriber>();
  /** Agent-level fan-out only: the emitting session already observed the event, so it must not re-enter `sink`. */
  function emitAgentEvent(event: AgentEvent): void {
    for (const subscriber of agentSubscribers) {
      subscriber.push(event);
    }
  }

  // Values `credentials.resolve` returned: the bus and the loader redact them from here on.
  const secrets: string[] = [];
  const hooks = createHookBus({ onEvent: (event) => sink?.(event), secrets });
  const slots = createSlotRegistry(createSlotDefaults());
  registerSkillCatalog(hooks.registrar("kernel"));
  const readSkillDir = internals.readSkillDir ?? readSkillDirectory;
  // `skills.dirs` reads through the same reader as `PackageAPI.skills.addDir`, once per agent.
  const resolved = await resolveHostSkillDirs(config, readSkillDir);
  // A manifest instance may assign slots to its package; `AgentConfig.slots` wins per slot.
  const manifestSlots = mergeManifestSlots(resolved.packages ?? [], resolved.slots);
  const effective = manifestSlots === resolved.slots ? resolved : { ...resolved, ...(manifestSlots ? { slots: manifestSlots } : {}) };
  // Loading is host code: a throwing package or host registrar fails agent creation closed, and a
  // failed load has already unwound everything it registered. `AgentConfig.hooks` is the inline
  // package `host`, loaded after every listed package.
  const packages = await loadPackages({
    inputs: config.packages ?? [],
    packageConfig: config.packageConfig,
    hostHooks: config.hooks,
    slotAssignments: effective.slots,
    bus: hooks,
    slots,
    host: config.host,
    redactor: config.redactor,
    kernelVersion: internals.kernelVersion ?? KERNEL_VERSION,
    hostConfig: effective,
    secrets,
    readSkillDir,
    emitAgentEvent: (event) => emitAgentEvent(event),
  });
  const agentId = effective.id ?? effective.name ?? randomId("agent");
  let disposed = false;
  // Computed on first read and not rebuilt per access; a disposed agent exposes nothing.
  let toolView: ReturnType<typeof toolInfos> | undefined;
  let skillView: ReturnType<typeof skillInfos> | undefined;
  const agent: Agent = {
    id: agentId,
    config: effective,
    get tools() {
      if (disposed) return Object.freeze([]);
      return (toolView ??= toolInfos(agent));
    },
    get skills() {
      if (disposed) return Object.freeze([]);
      return (skillView ??= skillInfos(agent));
    },
    sessions: createSessionIndex({
      store: () => slots.resolve("store", effective.slots?.store),
      ownership: effective.ownership,
    }),
    models: createModelIndex({
      configured: effective.model,
      packages: () => packages,
      redactor: () => packages.redactor(effective.redactor),
    }),
    async session(options?: SessionOptions) {
      if (options && "store" in (options as Record<string, unknown>) && (options as Record<string, unknown>).store !== undefined) {
        throw new TypeError(
          'Session options no longer accept "store"; configure the store slot on the agent via AgentConfig.slots.store instead',
        );
      }
      const resolvedStore = slots.resolve("store", effective.slots?.store);
      if (!options?.id) {
        const id = randomId("session");
        const session = new RuntimeAgentSession({ ...options, id, agent: this, store: resolvedStore });
        await session.openNewSession();
        return session;
      }
      const branchReader = resolvedStore.readBranchPath;
      const branch = branchReader
        ? (await branchReader.call(resolvedStore, { sessionId: options.id, leafId: options.leafId })).items
        : getSessionBranchEntries(await resolvedStore.list(options.id), { leafId: options.leafId });
      if (branch.length === 0) {
        if (!options.create) throw new SessionNotFoundError(options.id);
        const created = new RuntimeAgentSession({ ...options, id: options.id, agent: this, store: resolvedStore });
        await created.openNewSession();
        return created;
      }
      // Fail closed: an entry that does not carry the agent's declared scope is another scope's (or unscoped).
      if (!entriesInScope(branch, effective.ownership)) {
        throw new SessionNotFoundError(options.id);
      }
      const session = new RuntimeAgentSession({ ...options, id: options.id, agent: this, store: resolvedStore });
      await session.openResumedSession(branch);
      return session;
    },
    subscribe(options: SubscribeOptions = {}) {
      const subscriber = new EventSubscriber(agentId, { ...options, acrossRuns: true }, () => agentSubscribers.delete(subscriber));
      agentSubscribers.add(subscriber);
      return subscriber;
    },
    commands: {
      list: () => packages.commands().map(({ name, description, package: owner }) => ({ name, description, package: owner })),
      async run(name, args, options = {}) {
        const owner = packages.commands().find((entry) => entry.name === name)?.package;
        const session = options.session;
        const own = session instanceof RuntimeAgentSession ? session : undefined;
        // A command may read package state, so the session reads its branch first.
        await own?.ready();
        // The command sees the session as its own package does: `background` is capability-checked.
        const view = own && owner !== undefined ? own.sessionContextFor(owner) : undefined;
        return packages.runCommand(name, args, { ...(view ? { session: view } : {}), agent });
      },
    },
    dispose: async () => {
      disposed = true;
      // The kernel's own catalog registration goes too, so a disposed agent carries no hooks.
      hooks.removeOwner("kernel");
      await packages.dispose();
      // `agent.subscribe()` ends with the agent.
      for (const subscriber of [...agentSubscribers]) subscriber.close();
    },
    inspect: () => inspectAgent(agent, { config: effective, packages, hooks, slots }),
  };
  const runtime: AgentRuntime = {
    hooks,
    slots,
    packages,
    setEventSink(next) {
      sink = next;
    },
    emitAgentEvent,
  };
  registerAgentRuntime(agent, runtime);
  return agent;
}
