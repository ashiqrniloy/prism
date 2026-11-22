/** create-agent (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import { ModelError } from "./model-errors.js";
import { assertAgentConfigShape, assertSessionOptionsShape } from "./config-shape.js";
import { parseModelRef } from "../models/ref.js";
import type {
  Agent,
  AgentConfig,
  ResolvedAgentConfig,
  AgentEvent,
  OwnershipScope,
  Session,
  SessionOptions,
  Skill,
  SubscribeOptions,
} from "../contracts.js";
import {
  MAX_SESSION_LINK_DEPTH,
  MAX_SESSION_SEED_ENTRIES,
  type SessionSeedEntry,
  SessionNotFoundError,
} from "../contracts-core/session.js";
import { AgentDisposedError } from "../contracts.js";
import { inspectAgent } from "../agent/inspect.js";
import { createHookBus } from "../hooks/index.js";
import { mergeManifestSlots } from "../packages/define.js";
import { type LoadedPackages, loadPackages } from "../packages/loader.js";
import { createSlotDefaults, createSlotRegistry } from "../slots/index.js";
import { registerSkillCatalog } from "../skills-catalog.js";
import { KERNEL_VERSION } from "../version.js";
import { bindAgentCeilings, resolveCeilings } from "../run-limits.js";
import { entriesInScope, readSessionSnapshot } from "../session-stores.js";
import { createModelIndex } from "../agent/models.js";
import { createSessionIndex, narrowScope } from "../agent/sessions.js";
import { skillInfos, toolInfos } from "../agent/views.js";
import { EventSubscriber } from "./event-subscriber.js";
import { randomId } from "./helpers.js";
import { type AgentRuntime, registerAgentRuntime, skillSourceFor, toolListFor } from "./runtime-registry.js";
import { RuntimeAgentSession, type RuntimeSessionInternals } from "./session.js";
import type { PackageSessionOpenOptions } from "../packages/api.js";

export { agentRuntime, tryAgentRuntime, type AgentRuntime } from "./runtime-registry.js";

/** Test seam: the kernel version a package's `requires.prism` is checked against. */
export interface CreateAgentInternals {
  readonly kernelVersion?: string;
  /** Reads a `skills.addDir` directory. Defaults to the Node reader, imported only when a package asks. */
  readonly readSkillDir?: (path: string) => Promise<readonly Skill[]>;
  /** The built-in provider's `fetch`. Tests inject one; the default is the global. */
  readonly fetch?: typeof fetch;
}

/** Plan 177 Task 5: the abort reason `dispose()` gives every active run; its code is the run's failure code. */
function agentDisposedAbort(): Error {
  return Object.assign(new Error("Agent disposed"), { code: "agent_disposed", name: "AgentDisposedError" });
}

/** The fs read lives in `node/`, so the kernel root's static imports stay fs-free. */
async function readSkillDirectory(path: string, maxSkillBytes: number): Promise<readonly Skill[]> {
  const { loadSkillDirectory } = await import("../node/contribution-discovery.js");
  return loadSkillDirectory(path, { maxSkillBytes });
}

/** Read `AgentConfig.skills.dirs` once per agent, through the same reader as `PackageAPI.skills.addDir`. */
async function resolveHostSkillDirs<T extends AgentConfig>(config: T, read: (path: string) => Promise<readonly Skill[]>): Promise<T> {
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
export async function createAgentWith(input: AgentConfig, internals: CreateAgentInternals): Promise<Agent> {
  if ("store" in (input as unknown as Record<string, unknown>) && (input as unknown as Record<string, unknown>).store !== undefined) {
    throw new TypeError("AgentConfig.store was removed in Prism 1.0; assign the store slot via AgentConfig.slots.store instead");
  }

  for (const field of ["provider", "providerSource"] as const) {
    if ((input as unknown as Record<string, unknown>)[field] !== undefined) {
      throw new TypeError(
        `AgentConfig.${field} was removed in Prism 1.0; list a package that registers the provider via AgentConfig.packages (providers.register) instead`,
      );
    }
  }
  // Plan 229 Task 3: an unknown key or a wrong-shaped one fails here, before any package loads.
  assertAgentConfigShape(input);
  // Plan 239 Task 4: resolved once from the host's own config and bound to the agent below; nothing later raises one.
  const ceilings = resolveCeilings(input.ceilings);

  // `model` parses once here; everything below reads a `ModelSpec`. A bad reference fails creation closed.
  // An object ref is already a `ModelSpec`, so the host's own config object stays `agent.config`.
  // Absent only for a loop that declares `usesModel: false`; checked once the loop slot resolves below.
  const spec = input.model === undefined ? undefined : parseModelRef(input.model);
  const config = (spec === input.model ? input : { ...input, model: spec }) as ResolvedAgentConfig;

  const agentSubscribers = new Set<EventSubscriber>();
  /** Agent-level fan-out only: the emitting session already observed the event. Also the sink of the unbound bus. */
  function emitAgentEvent(event: AgentEvent): void {
    for (const subscriber of agentSubscribers) {
      subscriber.push(event);
    }
  }

  // Values `credentials.resolve` returned: the bus and the loader redact them from here on.
  const secrets: string[] = [];
  const readSkillDir = internals.readSkillDir ?? ((path: string) => readSkillDirectory(path, ceilings.skillInstructionBytes));
  // `createAgent` and `reload()` assemble through this one view: `skills.list()` during setup sees the
  // host's own config, never the packages being replaced.
  const registryView: { config: ResolvedAgentConfig; packages: LoadedPackages | undefined } = { config, packages: undefined };
  const assemblePackages = async (
    baseConfig: ResolvedAgentConfig,
    bus: ReturnType<typeof createHookBus>,
    slotRegistry: ReturnType<typeof createSlotRegistry>,
  ) => {
    // `skills.dirs` reads through the same reader as `PackageAPI.skills.addDir`, on every assembly.
    const resolved = await resolveHostSkillDirs(baseConfig, readSkillDir);
    // A manifest instance may assign slots to its package; `AgentConfig.slots` wins per slot.
    const manifestSlots = mergeManifestSlots(resolved.packages ?? [], resolved.slots);
    const nextConfig = manifestSlots === resolved.slots ? resolved : { ...resolved, ...(manifestSlots ? { slots: manifestSlots } : {}) };
    registryView.config = nextConfig;
    registryView.packages = undefined;
    // Loading is host code: a throwing package or host registrar fails assembly closed, and a failed load
    // has already unwound everything it registered. `AgentConfig.hooks` is the inline `host` package.
    const loaded = await loadPackages({
      inputs: baseConfig.packages ?? [],
      packageConfig: baseConfig.packageConfig,
      hostHooks: baseConfig.hooks,
      slotAssignments: nextConfig.slots,
      bus,
      slots: slotRegistry,
      host: baseConfig.host,
      redactor: baseConfig.redactor,
      kernelVersion: internals.kernelVersion ?? KERNEL_VERSION,
      hostConfig: nextConfig,
      ceilings,
      secrets,
      readSkillDir,
      fetch: internals.fetch,
      emitAgentEvent: (event) => emitAgentEvent(event),
      registry: {
        tools: () => toolListFor(registryView.config, registryView.packages),
        skills: () => skillSourceFor(registryView.config, registryView.packages),
        openSession: (options) => openChildSession(options),
      },
    });
    return { config: nextConfig, packages: loaded };
  };
  const assertLoop = (nextConfig: ResolvedAgentConfig, slotRegistry: ReturnType<typeof createSlotRegistry>): void => {
    // Resolved on every assembly: a missing model and an unknown `runModel` fail closed, and a slot conflict
    // surfaces now. The loop is the only object that can say it never needs a model.
    const loop = slotRegistry.resolve("loop", nextConfig.slots?.loop);
    if (loop.runModel !== undefined && loop.runModel !== "passthrough" && loop.runModel !== "none") {
      throw new ModelError("invalid_run_model_mode", `Loop "${loop.name}" declares an unknown runModel; use "passthrough" or "none"`);
    }
    if (nextConfig.model === undefined && loop.usesModel !== false) {
      throw new ModelError("model_required", `AgentConfig.model is required unless the loop "${loop.name}" declares usesModel: false`);
    }
  };
  const hooks = createHookBus({ onEvent: (event) => emitAgentEvent(event), secrets });
  const slots = createSlotRegistry(createSlotDefaults());
  registerSkillCatalog(hooks.registrar("kernel"));
  const initial = await assemblePackages(config, hooks, slots);
  const effective = initial.config;
  const packages = initial.packages;
  registryView.config = effective;
  registryView.packages = packages;
  assertLoop(effective, slots);
  let currentConfig = effective;
  let currentPackages = packages;
  let currentHooks = hooks;
  let currentSlots = slots;
  const agentId = effective.id ?? effective.name ?? randomId("agent");
  let disposed = false;
  let disposing: Promise<void> | undefined;
  let reloading: Promise<void> | undefined;
  let runtime: AgentRuntime | undefined;
  // Plan 177 Task 5: open sessions, so `dispose()` can abort their runs and close them.
  const openSessions = new Set<RuntimeAgentSession>();
  // Computed on first read and not rebuilt per access; a disposed agent exposes nothing.
  let toolView: ReturnType<typeof toolInfos> | undefined;
  let skillView: ReturnType<typeof skillInfos> | undefined;
  async function openAgentSession(options: SessionOptions | undefined, internals: RuntimeSessionInternals): Promise<Session> {
    if (disposed) throw new AgentDisposedError();
    if (options && "store" in (options as Record<string, unknown>) && (options as Record<string, unknown>).store !== undefined) {
      throw new TypeError(
        'Session options no longer accept "store"; configure the store slot on the agent via AgentConfig.slots.store instead',
      );
    }
    assertSessionOptionsShape(options);
    const resolvedStore = currentSlots.resolve("store", currentConfig.slots?.store);
    // Plan 177 Task 4: the session's scope narrows the agent's; a conflicting field throws before any read.
    const sessionScope = narrowScope(effective.ownership, options?.ownership, "Session");
    // Plan 177 Task 5: register before the open, so a dispose that starts mid-open still closes it.
    const openSession = async (id: string, open: (session: RuntimeAgentSession) => Promise<void>): Promise<Session> => {
      const session = new RuntimeAgentSession({ ...options, ...internals, id, ownership: sessionScope, agent, store: resolvedStore });
      openSessions.add(session);
      try {
        await open(session);
      } catch (error) {
        openSessions.delete(session);
        throw error;
      }
      if (disposed) {
        await session.close();
        throw new AgentDisposedError();
      }
      return session;
    };
    if (!options?.id) return openSession(randomId("session"), (session) => session.openNewSession());
    // Plan 230 Task 3: the open reads the branch from its newest compaction on, and the session keeps it as its snapshot.
    const snapshot = await readSessionSnapshot(
      resolvedStore,
      { sessionId: options.id, leafId: options.leafId },
      { maxPages: ceilings.branchReadPages },
    );
    if (snapshot.entries.length === 0) {
      if (!options.create) throw new SessionNotFoundError(options.id);
      return openSession(options.id, (session) => session.openNewSession());
    }
    // Fail closed: an entry that does not carry the session's effective scope is another scope's (or unscoped).
    if (!entriesInScope(snapshot.entries, sessionScope)) {
      throw new SessionNotFoundError(options.id);
    }
    return openSession(options.id, (session) => session.openResumedSession(snapshot));
  }

  /**
   * Plan 232 Task 2: `PackageAPI.sessions.open`. The parent must be a session of this agent that is open now; the
   * child inherits its scope (narrowed, never widened), is stamped one level deeper, and closes with it.
   */
  async function openChildSession(options: PackageSessionOpenOptions): Promise<Session> {
    const { parent: parentLink, seed, ownership, actor, metadata, id } = assertChildSessionOptions(options);
    let parent: RuntimeAgentSession | undefined;
    for (const session of openSessions) {
      if (session.id === parentLink.sessionId && !session.isClosing()) {
        parent = session;
        break;
      }
    }
    if (!parent) throw new TypeError("sessions.open: parent.sessionId must name an open session of this agent");
    const depth = parent.depth + 1;
    if (depth > MAX_SESSION_LINK_DEPTH)
      throw new TypeError(`sessions.open: a child would be ${depth} links deep; the most is ${MAX_SESSION_LINK_DEPTH}`);
    const scope = narrowScope(parent.scope, ownership, "Session");
    if (id !== undefined) return reopenChildSession(parent, id, scope);
    const child = (await openAgentSession(
      {
        parent: parentLink,
        ...(actor !== undefined ? { actor } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(scope !== undefined ? { ownership: scope } : {}),
      },
      { depth, ...(seed !== undefined ? { seed } : {}) },
    )) as RuntimeAgentSession;
    child.openParent = parent;
    parent.children.add(child);
    if (parent.isClosing()) {
      await child.close();
      throw new TypeError("sessions.open: the parent session closed while the child was opening");
    }
    return child;
  }

  /**
   * Plan 232 Task 4: a stored child of `parent`, reopened (a parent resumed in a new process reaches its suspended
   * child this way). The child's own links decide: a session linked to another parent, or to none, is refused.
   */
  async function reopenChildSession(parent: RuntimeAgentSession, id: string, scope: OwnershipScope | undefined): Promise<Session> {
    for (const open of parent.children) if (open.id === id && !open.isClosing()) return open;
    const child = (await openAgentSession({ id, ...(scope !== undefined ? { ownership: scope } : {}) }, {})) as RuntimeAgentSession;
    if (child.parentSessionId !== parent.id) {
      await child.close();
      throw new TypeError("sessions.open: id must name a child session of parent.sessionId");
    }
    child.openParent = parent;
    parent.children.add(child);
    if (parent.isClosing()) {
      await child.close();
      throw new TypeError("sessions.open: the parent session closed while the child was opening");
    }
    return child;
  }

  const agent: Agent = {
    id: agentId,
    get config() {
      return currentConfig;
    },
    get tools() {
      if (disposed) return Object.freeze([]);
      // A `tools.source` answers the current set, so the view is read fresh instead of cached (plan 234 Task 4).
      if (registryView.packages?.hasToolSources) return toolInfos(agent);
      return (toolView ??= toolInfos(agent));
    },
    get skills() {
      if (disposed) return Object.freeze([]);
      return (skillView ??= skillInfos(agent));
    },
    sessions: createSessionIndex(() => currentSlots.resolve("store", currentConfig.slots?.store), { ownership: effective.ownership }),
    models: createModelIndex({
      configured: effective.model,
      packages: () => currentPackages,
      redactor: () => currentPackages.redactor(currentConfig.redactor),
    }),
    session(options?: SessionOptions) {
      return openAgentSession(options, {});
    },
    subscribe(options: SubscribeOptions = {}) {
      const subscriber = new EventSubscriber(agentId, { ...options, acrossRuns: true }, () => agentSubscribers.delete(subscriber));
      agentSubscribers.add(subscriber);
      return subscriber;
    },
    commands: {
      list: () => currentPackages.commands().map(({ name, description, package: owner }) => ({ name, description, package: owner })),
      async run(name, args, options = {}) {
        if (disposed) throw new AgentDisposedError();
        const owner = currentPackages.commands().find((entry) => entry.name === name)?.package;
        const session = options.session;
        const own = session instanceof RuntimeAgentSession ? session : undefined;
        // A command may read package state, so the session reads its branch first.
        await own?.ready();
        // The command sees the session as its own package does: `background` is capability-checked.
        const view = own && owner !== undefined ? own.sessionContextFor(owner) : undefined;
        return currentPackages.runCommand(name, args, { ...(view ? { session: view } : {}), agent });
      },
    },
    async reload() {
      if (disposed) throw new AgentDisposedError();
      // Package teardown closes resources a run may be using; a live run must finish first.
      if ([...openSessions].some((session) => session.hasActiveRun())) {
        throw new Error("Cannot reload while a session run is active");
      }
      // One reload at a time; concurrent callers await the same attempt. A failed attempt leaves the
      // committed bus, slots, packages, and config untouched.
      reloading ??= (async () => {
        if (runtime) runtime.reloading = true;
        const previous = { config: registryView.config, packages: registryView.packages };
        const nextHooks = createHookBus({ onEvent: (event) => emitAgentEvent(event), secrets });
        registerSkillCatalog(nextHooks.registrar("kernel"));
        const nextSlots = createSlotRegistry(createSlotDefaults());
        let assembled: Awaited<ReturnType<typeof assemblePackages>>;
        try {
          assembled = await assemblePackages(config, nextHooks, nextSlots);
          assertLoop(assembled.config, nextSlots);
        } catch (error) {
          registryView.config = previous.config;
          registryView.packages = previous.packages;
          throw error;
        }
        if (disposed) {
          await assembled.packages.dispose();
          registryView.config = previous.config;
          registryView.packages = previous.packages;
          throw new AgentDisposedError();
        }
        if ([...openSessions].some((session) => session.hasActiveRun())) {
          await assembled.packages.dispose();
          registryView.config = previous.config;
          registryView.packages = previous.packages;
          throw new Error("Cannot reload while a session run is active");
        }
        // Retire the old bus last: a run that started before this point keeps the hooks it loaded.
        await currentPackages.dispose();
        currentHooks = nextHooks;
        currentSlots = nextSlots;
        currentPackages = assembled.packages;
        currentConfig = assembled.config;
        registryView.config = currentConfig;
        registryView.packages = currentPackages;
        if (runtime) {
          runtime.hooks = currentHooks;
          runtime.slots = currentSlots;
          runtime.packages = currentPackages;
        }
        // Both views are per-agent caches; the next read rebuilds them from the new package set.
        toolView = undefined;
        skillView = undefined;
      })().finally(() => {
        if (runtime) runtime.reloading = false;
        reloading = undefined;
      });
      await reloading;
    },
    dispose: async () => {
      // Idempotent: the first call owns the unwind, a second awaits it. `disposed` flips synchronously.
      disposing ??= (async () => {
        disposed = true;
        // A reload in flight either commits first or unwinds itself once it sees `disposed`.
        await reloading?.catch(() => undefined);
        // Abort first, so no tool runs after this point even if a loop ignores its signal.
        for (const session of [...openSessions]) session.abort(agentDisposedAbort());
        for (const session of [...openSessions]) await session.close();
        // The kernel's own catalog registration goes too, so a disposed agent carries no hooks.
        currentHooks.removeOwner("kernel");
        await currentPackages.dispose();
        // `agent.subscribe()` ends with the agent.
        for (const subscriber of [...agentSubscribers]) subscriber.close();
      })();
      await disposing;
    },
    inspect: () => inspectAgent(agent, { config: currentConfig, packages: currentPackages, hooks: currentHooks, slots: currentSlots }),
  };
  runtime = {
    hooks: currentHooks,
    slots: currentSlots,
    packages: currentPackages,
    openSessions,
    emitAgentEvent,
  };
  registerAgentRuntime(agent, runtime);
  bindAgentCeilings(agent, ceilings);
  return agent;
}

/** `PackageAPI.sessions.open` options, checked before anything opens: a child is a conversation, never a config bag. */
function assertChildSessionOptions(options: PackageSessionOpenOptions): PackageSessionOpenOptions {
  if (!options || typeof options !== "object") throw new TypeError("sessions.open needs an options object");
  const known = new Set(["parent", "actor", "metadata", "ownership", "seed", "id"]);
  for (const key of Object.keys(options)) if (!known.has(key)) throw new TypeError(`sessions.open: unknown option ${JSON.stringify(key)}`);
  const parent = options.parent as unknown as Record<string, unknown> | undefined;
  if (!parent || typeof parent !== "object" || typeof parent.sessionId !== "string" || parent.sessionId.length === 0) {
    throw new TypeError("sessions.open: parent.sessionId is required");
  }
  for (const key of Object.keys(parent)) {
    if (key !== "sessionId" && key !== "delegationId" && key !== "workflowRunId") {
      throw new TypeError(`sessions.open: parent.${key} is not a child link; use sessionId, delegationId or workflowRunId`);
    }
  }
  if (options.id !== undefined) {
    if (typeof options.id !== "string" || options.id.length === 0) throw new TypeError("sessions.open: id must be a non-empty string");
    for (const key of ["seed", "actor", "metadata"] as const) {
      if (options[key] !== undefined)
        throw new TypeError(`sessions.open: ${key} cannot be given with id; a reopened child keeps what it recorded`);
    }
  }
  const seed = options.seed;
  if (seed !== undefined) {
    if (!Array.isArray(seed)) throw new TypeError("sessions.open: seed must be an array");
    if (seed.length > MAX_SESSION_SEED_ENTRIES)
      throw new TypeError(`sessions.open: seed holds at most ${MAX_SESSION_SEED_ENTRIES} entries`);
    for (const [index, entry] of (seed as SessionSeedEntry[]).entries()) assertSeedEntry(entry, index);
  }
  return options;
}

function assertSeedEntry(entry: SessionSeedEntry, index: number): void {
  const value = entry as unknown as Record<string, unknown>;
  const path = `sessions.open: seed[${index}]`;
  if (!value || typeof value !== "object") throw new TypeError(`${path} must be an object`);
  if (value.kind === "summary") {
    if (typeof value.summary !== "string" || Object.keys(value).some((key) => key !== "kind" && key !== "summary")) {
      throw new TypeError(`${path} must be { kind: "summary", summary: string }`);
    }
    return;
  }
  if (value.kind === "message") {
    const message = value.message as Record<string, unknown> | undefined;
    if (
      !message ||
      typeof message !== "object" ||
      (message.role !== "user" && message.role !== "assistant" && message.role !== "tool") ||
      !Array.isArray(message.content) ||
      Object.keys(value).some((key) => key !== "kind" && key !== "message")
    ) {
      throw new TypeError(`${path} must be { kind: "message", message } with a user, assistant or tool message`);
    }
    return;
  }
  throw new TypeError(`${path}.kind must be "message" or "summary"; got ${JSON.stringify(value.kind)}`);
}
