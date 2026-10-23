import type {
  AgentConfig,
  AgentEvent,
  CredentialContext,
  JsonObject,
  JsonValue,
  ModelConfig,
  ModelProvider,
  ModelRef,
  ModelSpec,
  ProviderEvent,
  ProviderRequest,
  Secret,
  Skill,
  ToolDefinition,
} from "../contracts.js";
import { assertDecisionRequest, DecisionsError, modelSupportsDecisions } from "../contracts-core/decisions.js";
import { EmbeddingsError, modelSupportsEmbeddings } from "../contracts-core/embeddings.js";
import type { HookBus, HookRegistrar } from "../hooks/index.js";
import type { HostPort, HostUiRequest, HostUiRequestKind, HostUiResponse, HostUiSecretRequest, HostUiTerminalRequest, Logger } from "../host/types.js";
import { BUILTIN_PROVIDER_ID, createBuiltinProvider } from "../models/builtin.js";
import { normalizeStopReason } from "../models/events.js";
import { parseModelRef } from "../models/ref.js";
import { mergeRetry, retryLoop } from "../models/retry.js";
import { errorToErrorInfo, redactSecrets, type SecretRedactor } from "../redaction.js";
import { createAgentState, createSessionLog, createSessionState } from "../session/state.js";
import type { SessionContext } from "../session-context.js";
import { createSkillRegistry } from "../skills.js";
import { SLOT_NAMES, type SlotAssignments, type SlotName, type SlotRegistry } from "../slots/index.js";
import { createToolRegistry } from "../tools.js";
import type { ModelClient, PackageAPI, PackageCommand, PackageCommandInfo, PackageInstance, SlotRegistrar } from "./api.js";
import { type Capability, requireCapability } from "./capabilities.js";
import { type PackageConfigSource, resolvePackageConfig } from "./config.js";
import { type NormalizedPackage, normalizePackageInput } from "./define.js";
import { PackageLoadError } from "./errors.js";
import { assertJsonSchemaSupported, SECRET_REF, toJsonValue, validateJsonSchema } from "./schema.js";
import { parseRange, parseVersion, satisfies } from "./semver.js";
import { SUPPORTED_API_LEVELS } from "../version.js";

export interface LoadPackagesOptions {
  readonly inputs: readonly import("./api.js").PackageInput[];
  readonly packageConfig?: Readonly<Record<string, unknown>>;
  /** `AgentConfig.hooks`: an inline, unnamed package with owner `host` that loads last. */
  readonly hostHooks?: (hooks: HookRegistrar) => void;
  readonly slotAssignments?: SlotAssignments;
  readonly bus: HookBus;
  readonly slots: SlotRegistry;
  readonly host?: HostPort;
  readonly redactor?: SecretRedactor;
  /** The kernel version `requires.prism` is checked against. Tests inject one. */
  readonly kernelVersion: string;
  /**
   * The host's own contributions and overrides: collision checks for tools and skills, `disable`, and the
   * provider resolution `models.client` shares with sessions. Never mutated.
   */
  readonly hostConfig?: Partial<Pick<AgentConfig, "model" | "tools" | "skills" | "retry" | "disable">>;
  /** Values resolved through `credentials.resolve`. Shared with the hook bus so its errors are redacted too. */
  readonly secrets?: string[];
  /** The built-in provider's `fetch`; defaults to the global. */
  readonly fetch?: typeof fetch;
  /** Reads a `skills.addDir` directory. Only called when a package asked for one. */
  readonly readSkillDir?: (path: string) => Promise<readonly Skill[]>;
  /** Agent-scoped fan-out (`agent.subscribe()`): receives each `package.status` after it is recorded and redacted. */
  readonly emitAgentEvent?: (event: AgentEvent) => void;
  /**
   * The agent's effective tool and skill views behind `PackageAPI.tools.list` and `skills.list`/`get`. The agent does
   * not exist while packages load, so `create-agent.ts` passes closures that read it later. Never called during `setup`.
   */
  readonly registry?: {
    readonly tools: () => readonly ToolDefinition[];
    readonly skills: () => readonly Skill[];
  };
}

/** Names the kernel generates tools under, so a package cannot shadow them. `search_tools` left
 *  this set in plan 158 Task 7 — `@arnilo/prism-context-engineering` owns the activation tool, and
 *  Task 8 deleted the kernel's own run-assembly path — so `load_skill` is the only name left. */
export const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set(["load_skill"]);

export interface PackageToolEntry {
  readonly owner: string;
  readonly tool: ToolDefinition;
  readonly when?: (session: SessionContext) => boolean;
}

export interface PackageCommandEntry extends PackageCommandInfo {
  readonly command: PackageCommand;
}

export interface PackageStatusNote {
  readonly package: string;
  readonly level: "info" | "warn";
  readonly message: string;
  readonly at: string;
}

/** One loaded package, as `inspect()` lists it. Config holds refs for secret fields, never values. */
export interface LoadedPackage {
  readonly name: string;
  readonly version: string;
  /** Whether the instance was marked `optional`. */
  readonly optional: boolean;
  /** `skipped`: an `optional` instance whose `setup` threw. Its contributions were unwound. */
  readonly status: "loaded" | "skipped";
  readonly description?: string;
  readonly capabilities: readonly Capability[];
  readonly config: JsonObject;
  readonly configSources: Readonly<Record<string, PackageConfigSource>>;
  /** `code` for a package the host listed, `manifest:<scope>` for one `loadManifest` built. */
  readonly source: "code" | "manifest:user" | "manifest:project";
}

export interface LoadedPackages {
  /** Packages in load order. The inline host package is not listed. */
  readonly packages: readonly LoadedPackage[];
  /** `optional` instances that were skipped, in load order. They hold no contribution. */
  readonly skippedPackages: readonly LoadedPackage[];
  /** Declared capabilities per package name. Owners absent from the map (`host`, `kernel`) are unrestricted. */
  readonly capabilities: ReadonlyMap<string, ReadonlySet<Capability>>;
  statusNotes(): readonly PackageStatusNote[];
  /** Tools packages registered, after `disable`. Read live, so a disposed package's tools are gone. */
  tools(): readonly PackageToolEntry[];
  /** Skills packages registered (and `addDir` read), after `disable`. */
  skills(): readonly Skill[];
  /** The same skills with the package that registered each. */
  skillEntries(): readonly { readonly owner: string; readonly skill: Skill }[];
  /** A provider a package registered for this `provider` id. */
  provider(id: string): ModelProvider | undefined;
  /** Every provider the agent can resolve: the built-in first, then packages' in load order. */
  providers(): readonly { readonly owner: string; readonly provider: ModelProvider }[];
  /** The agent's provider resolution: the model's provider id picks from the registry. Throws `Unknown provider: <id>`. */
  resolveProvider(model: ModelConfig): ModelProvider;
  /** Commands packages registered, after `disable`. */
  commands(): readonly PackageCommandEntry[];
  /** Host tool and skill names `disable` removed. They stay in the host's registry and are filtered from every view. */
  readonly disabled: { readonly tools: ReadonlySet<string>; readonly skills: ReadonlySet<string>; readonly packages: ReadonlySet<string> };
  /** The host port as `owner` sees it: `host-ui` is checked against its capabilities and requests are stamped. */
  hostFor(owner: string, sessionId?: string): HostPort;
  /** Applies the values `credentials.resolve` returned on top of `redactor`. Identity when none was resolved. */
  redactor(base: SecretRedactor | undefined): SecretRedactor | undefined;
  /** Whether any loaded package may resolve credentials, so the secret set can grow during a run. */
  readonly resolvesCredentials: boolean;
  /** Whether a loaded package declared session state, so a session must read its branch before it is used. */
  readonly usesSessionState: boolean;
  /** Runs a command's `run`: arguments are validated against its schema first. */
  runCommand(
    name: string,
    args: unknown,
    context: { readonly session?: SessionContext; readonly agent: import("../contracts.js").Agent },
  ): Promise<unknown>;
  /** Disposes packages in reverse load order and removes every contribution. Idempotent. */
  dispose(): Promise<void>;
}

const HOST_OWNER = "host";
const KERNEL_OWNER = "kernel";
const MAX_STATUS_NOTES = 200;
const MAX_NOTE_LENGTH = 1024;
const MAX_EVENT_NAME = 128;

interface Entry extends NormalizedPackage {
  readonly name: string;
  readonly version: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly config: JsonObject;
  readonly configSources: Readonly<Record<string, PackageConfigSource>>;
}

interface State {
  readonly entry: Entry;
  readonly disposers: (() => void | Promise<void>)[];
  readonly skillDirs: string[];
  /** `state.session` / `state.agent` keys this package declared, so a key is declared once. */
  readonly stateKeys: Set<string>;
}

const MAX_COMMAND_NAME = 128;

/** A package declares each state key once per scope: a second declaration is a bug, not a lookup. */
function declareStateKey(state: State, kind: "session" | "log" | "agent", key: string): void {
  const id = `${kind}:${key}`;
  if (state.stateKeys.has(id))
    throw new TypeError(`state.${kind}("${String(key).slice(0, 64)}") was declared twice by ${state.entry.name}`);
  state.stateKeys.add(id);
}

function listNames(value: { list(): readonly { readonly name: string }[] } | readonly { readonly name: string }[] | undefined): string[] {
  if (!value) return [];
  return (("list" in value ? value.list() : value) as readonly { readonly name: string }[]).map((item) => item.name);
}

function disableIds(label: string, ids: unknown): readonly string[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new TypeError(`disable.${label} must be an array of non-empty strings`);
  }
  return ids;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stable topological order over `requires.packages`: dependencies first, otherwise input order. */
function orderPackages(entries: readonly Entry[]): Entry[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const done = new Set<string>();
  const stack: string[] = [];
  const ordered: Entry[] = [];
  const visit = (entry: Entry): void => {
    if (done.has(entry.name)) return;
    const at = stack.indexOf(entry.name);
    if (at >= 0) {
      const cycle = [...stack.slice(at), entry.name].join(" -> ");
      throw new PackageLoadError("dependency_cycle", `Package dependency cycle: ${cycle}.`, { package: entry.name });
    }
    stack.push(entry.name);
    for (const dependency of Object.keys(entry.definition.requires?.packages ?? {})) {
      const next = byName.get(dependency);
      if (next) visit(next);
    }
    stack.pop();
    done.add(entry.name);
    ordered.push(entry);
  };
  for (const entry of entries) visit(entry);
  return ordered;
}

/**
 * Runs the §2.6 lifecycle: resolve inputs, merge and validate config, order, check `requires`, run
 * `setup`, check services, and resolve slots. Any failure unwinds every package already set up, in
 * reverse order, and rejects with a `PackageLoadError` (or `SlotConflictError`).
 */
export async function loadPackages(options: LoadPackagesOptions): Promise<LoadedPackages> {
  const { bus, slots, redactor } = options;
  const hostConfig = options.hostConfig ?? {};
  // Values `credentials.resolve` returned. The same array reaches the bus, so its errors redact them too.
  const secrets = options.secrets ?? [];
  const redact = (text: string): string => redactSecrets(redactor?.redact(text) ?? text, secrets);
  const redactValue = <T>(value: T): T => redactSecrets(redactor?.redact(value) ?? value, secrets);

  // 1. Resolve inputs.
  const normalized = options.inputs.map((input) => normalizePackageInput(input));
  const seen = new Set<string>();
  for (const item of normalized) {
    const name = item.definition.name;
    if (seen.has(name)) throw new PackageLoadError("duplicate_package", `Package ${name} is listed more than once.`, { package: name });
    seen.add(name);
  }
  for (const name of Object.keys(options.packageConfig ?? {})) {
    if (!seen.has(name)) {
      throw new PackageLoadError("config_unknown_key", `packageConfig names package ${name.slice(0, 64)}, which is not loaded.`, {
        package: name,
      });
    }
  }

  // 2-3. Merge and validate config.
  const entries: Entry[] = normalized.map((item) => {
    const { definition } = item;
    const host = options.packageConfig?.[definition.name];
    // The instance's config is the manifest layer for a `loadManifest` instance and the code layer for the rest.
    const resolved = resolvePackageConfig(
      definition,
      item.source
        ? {
            manifest: item.config,
            host,
            manifestScopes: item.source.scopes,
            manifestScope: item.source.scope,
          }
        : { code: item.config, host },
    );
    return {
      ...item,
      name: definition.name,
      version: definition.version,
      capabilities: new Set(definition.capabilities ?? []),
      config: resolved.config,
      configSources: resolved.sources,
    };
  });

  // 4. Order topologically, then 5. check requires (kernel range and packages).
  const ordered = orderPackages(entries);
  const kernel = parseVersion(options.kernelVersion);
  const versions = new Map(ordered.map((entry) => [entry.name, parseVersion(entry.version)]));
  for (const entry of ordered) {
    const requires = entry.definition.requires;
    if (!requires) {
      throw new PackageLoadError("definition_invalid", `Package ${entry.name} defines no requires; declare requires.api.`, {
        package: entry.name,
      });
    }
    if (!SUPPORTED_API_LEVELS.includes(requires.api)) {
      throw new PackageLoadError(
        "kernel_api",
        `Package ${entry.name} targets kernel API ${requires.api}; this kernel supports ${SUPPORTED_API_LEVELS.join(", ")}.`,
        { package: entry.name },
      );
    }
    if (requires.prism !== undefined && (!kernel || !satisfies(kernel, parseRange(requires.prism)))) {
      throw new PackageLoadError(
        "kernel_range",
        `Package ${entry.name} requires kernel ${requires.prism}, but this is ${options.kernelVersion}.`,
        { package: entry.name },
      );
    }
    for (const [dependency, range] of Object.entries(requires.packages ?? {})) {
      const version = versions.get(dependency);
      if (!version) {
        throw new PackageLoadError("missing_package", `Package ${entry.name} requires package ${dependency}, which is not loaded.`, {
          package: entry.name,
        });
      }
      if (!satisfies(version, parseRange(range))) {
        throw new PackageLoadError(
          "missing_package",
          `Package ${entry.name} requires ${dependency} ${range}, but version ${entries.find((e) => e.name === dependency)?.version} is loaded.`,
          { package: entry.name },
        );
      }
    }
  }

  // Shared agent-scope state.
  const services = new Map<string, { readonly owner: string; readonly implementation: unknown }>();
  const notes: PackageStatusNote[] = [];
  const skippedEntries: Entry[] = [];
  const started: State[] = [];
  let disposed = false;

  const capabilitiesOf = new Map(ordered.map((entry) => [entry.name, entry.capabilities]));
  const packageTools = createToolRegistry([], { duplicate: "error" });
  const toolEntries = new Map<string, PackageToolEntry>();
  const packageSkills = createSkillRegistry([], { duplicate: "error" });
  const skillOwners = new Map<string, string>();
  // The kernel's own provider is entry zero, so a package registering its id fails as `provider_conflict`.
  const providerEntries = new Map<string, { readonly owner: string; readonly provider: ModelProvider }>([
    [
      BUILTIN_PROVIDER_ID,
      {
        owner: KERNEL_OWNER,
        provider: createBuiltinProvider({ resolveCredential: (ref) => resolveCredentialRef(ref), fetch: options.fetch }),
      },
    ],
  ]);
  const commandEntries = new Map<string, PackageCommandEntry>();
  const disabled = { tools: new Set<string>(), skills: new Set<string>(), packages: new Set<string>() };
  let usesSessionState = false;
  let setupComplete = false;

  const report = (owner: string, hook: string, error: unknown): void => {
    bus.observe("hook.error", {
      type: "hook.error",
      sessionId: "",
      runId: "",
      hook,
      owner,
      error: redactValue(errorToErrorInfo(error, secrets)),
    });
  };

  const note = (owner: string, level: "info" | "warn", message: string): void => {
    const recorded: PackageStatusNote = {
      package: owner,
      level,
      message: redact(String(message)).slice(0, MAX_NOTE_LENGTH),
      at: new Date().toISOString(),
    };
    notes.push(recorded);
    if (notes.length > MAX_STATUS_NOTES) notes.shift();
    // Agent-scoped, like `package.event`: no session exists yet during `setup`. The note is already redacted.
    const event = { type: "package.status", sessionId: "", runId: "", ...recorded } as const;
    bus.observe("package.status", event);
    options.emitAgentEvent?.(event);
  };

  /** Disposes one package: its `onDispose` callbacks (reverse order, a throw is reported), then every registration. */
  const teardown = async (state: State): Promise<void> => {
    const name = state.entry.name;
    for (const fn of state.disposers.splice(0).reverse()) {
      try {
        await fn();
      } catch (error) {
        report(name, "onDispose", error);
      }
    }
    bus.removeOwner(name);
    slots.remove(name);
    for (const [service, provided] of services) if (provided.owner === name) services.delete(service);
    for (const [tool, entry] of toolEntries) {
      if (entry.owner !== name) continue;
      toolEntries.delete(tool);
      packageTools.unregister?.(tool);
    }
    for (const [skill, owner] of skillOwners) {
      if (owner !== name) continue;
      skillOwners.delete(skill);
      packageSkills.unregister?.(skill);
    }
    for (const [id, entry] of providerEntries) if (entry.owner === name) providerEntries.delete(id);
    for (const [command, entry] of commandEntries) if (entry.package === name) commandEntries.delete(command);
  };

  const unwind = async (): Promise<void> => {
    for (const state of [...started].reverse()) await teardown(state);
    started.length = 0;
  };

  const hostUi = options.host?.ui;

  /**
   * A `secret` request (roadmap §2.3): the host captures the value, the kernel stores it at `ref`
   * through the credentials slot, and the package gets `answered` with no value. Fails closed three
   * ways: a non-ref `ref` throws before the host is asked, a slot without `store` answers
   * `unavailable`, and the stored value joins `secrets` so this run's own events and errors mask it.
   */
  const askSecret = async (
    owner: string,
    request: HostUiSecretRequest,
    sessionId: string | undefined,
  ): Promise<HostUiResponse<"secret">> => {
    if (!SECRET_REF.test(request.ref)) {
      throw new PackageLoadError(
        "invalid_secret_ref",
        `host.ui secret ref must be an env: or keyring: ref, not "${request.ref.slice(0, 64)}".`,
        {
          package: owner,
        },
      );
    }
    if (!hostUi) return { status: "unavailable" };
    const assigned = (options.slotAssignments ?? {}) as Partial<Record<SlotName, unknown>>;
    const resolver = slots.resolve("credentials", assigned.credentials as never);
    if (!resolver.store) return { status: "unavailable" };
    const response = await hostUi.request({ ...request, package: owner, sessionId });
    if (response.status !== "answered") return response;
    const value = response.value;
    if (value !== undefined && value !== "") {
      await resolver.store(request.ref, { type: "api_key", value }, { package: owner });
      if (!secrets.includes(value)) secrets.push(value);
    }
    return { status: "answered", value: undefined };
  };

  const hostFor = (owner: string, sessionId?: string): HostPort => {
    const declared = capabilitiesOf.get(owner);
    return {
      ui: {
        async request<K extends HostUiRequestKind>(request: Extract<HostUiRequest, { kind: K }>): Promise<HostUiResponse<K>> {
          if (declared) requireCapability(owner, declared, "host-ui", "host.ui.request");
          if ((request as HostUiRequest).kind === "secret") {
            return askSecret(owner, request as HostUiSecretRequest, sessionId) as unknown as HostUiResponse<K>;
          }
          if ((request as HostUiRequest).kind === "terminal") {
            const env = (request as HostUiTerminalRequest).env;
            for (const [name, value] of Object.entries(env ?? {})) {
              if (typeof value !== "string" || /^(env|keyring):/.test(value)) {
                throw new PackageLoadError("terminal_env_secret", `host.ui terminal env ${name} must be a plain non-secret string, not a credential ref.`, { package: owner });
              }
            }
          }
          if (!hostUi) return { status: "unavailable" };
          // `package` and `sessionId` are kernel-set: a package cannot name another package or session.
          const response = await hostUi.request({ ...request, package: owner, sessionId } as Extract<HostUiRequest, { kind: K }>);
          // The terminal's I/O never reaches a package: only the exit code is forwarded, whatever the host returned.
          if ((request as HostUiRequest).kind === "terminal" && response.status === "answered") {
            const exitCode = (response.value as { exitCode?: unknown } | undefined)?.exitCode;
            if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) return { status: "unavailable" };
            return { status: "answered", value: { exitCode } } as unknown as HostUiResponse<K>;
          }
          return response;
        },
      },
    };
  };

  const registerTool = (owner: string, tool: ToolDefinition, when: ((session: SessionContext) => boolean) | undefined): void => {
    if (setupComplete) {
      throw new PackageLoadError("registration_closed", `Tool ${tool?.name ?? "unknown"} registered after package setup was complete.`, {
        package: owner,
      });
    }
    if (
      typeof tool !== "object" ||
      tool === null ||
      typeof tool.name !== "string" ||
      tool.name.length === 0 ||
      typeof tool.execute !== "function"
    ) {
      throw new TypeError("tools.register requires a tool with a name and an execute function");
    }
    if (when !== undefined && typeof when !== "function") throw new TypeError("tools.register `when` must be a function");
    const taken = RESERVED_TOOL_NAMES.has(tool.name)
      ? "the kernel"
      : (toolEntries.get(tool.name)?.owner ?? (listNames(hostConfig.tools?.add).includes(tool.name) ? "the host" : undefined));
    if (taken) {
      throw new PackageLoadError("tool_conflict", `Tool ${tool.name} is registered by ${owner} but is already taken by ${taken}.`, {
        package: owner,
      });
    }
    packageTools.register(tool);
    toolEntries.set(tool.name, { owner, tool, ...(when ? { when } : {}) });
  };

  const registerSkill = (owner: string, skill: Skill): void => {
    if (typeof skill !== "object" || skill === null || typeof skill.name !== "string" || skill.name.length === 0) {
      throw new TypeError("skills.register requires a skill with a name");
    }
    const taken = skillOwners.get(skill.name) ?? (listNames(hostConfig.skills?.add).includes(skill.name) ? "the host" : undefined);
    if (taken) {
      throw new PackageLoadError("skill_conflict", `Skill ${skill.name} is registered by ${owner} but is already taken by ${taken}.`, {
        package: owner,
      });
    }
    packageSkills.register(skill);
    skillOwners.set(skill.name, owner);
  };

  const registerProvider = (owner: string, provider: ModelProvider): void => {
    if (
      typeof provider !== "object" ||
      provider === null ||
      typeof provider.id !== "string" ||
      provider.id.length === 0 ||
      typeof provider.generate !== "function"
    ) {
      throw new TypeError("providers.register requires a provider with an id and a generate function");
    }
    const existing = providerEntries.get(provider.id);
    if (existing) {
      throw new PackageLoadError("provider_conflict", `Provider ${provider.id} is registered by both ${existing.owner} and ${owner}.`, {
        package: owner,
      });
    }
    providerEntries.set(provider.id, { owner, provider });
  };

  const registerCommand = (owner: string, command: PackageCommand): void => {
    if (
      typeof command !== "object" ||
      command === null ||
      typeof command.name !== "string" ||
      command.name.length === 0 ||
      command.name.length > MAX_COMMAND_NAME ||
      /\s/.test(command.name) ||
      typeof command.description !== "string" ||
      typeof command.run !== "function"
    ) {
      throw new TypeError("commands.register requires a name without whitespace, a description, and a run function");
    }
    // A bad schema fails now (`config_schema_unsupported`), not on the first run of the command.
    if (command.args !== undefined) assertJsonSchemaSupported(command.args);
    const existing = commandEntries.get(command.name);
    if (existing) {
      throw new PackageLoadError("command_conflict", `Command ${command.name} is registered by both ${existing.package} and ${owner}.`, {
        package: owner,
      });
    }
    commandEntries.set(command.name, { name: command.name, description: command.description, package: owner, command });
  };

  /** The credentials slot, resolved on use. A value it returns is redacted from everything this agent raises from then on. */
  const resolveCredentialRef = async (ref: string, ctx: CredentialContext = {}): Promise<Secret | undefined> => {
    const assigned = (options.slotAssignments ?? {}) as Partial<Record<SlotName, unknown>>;
    const resolver = slots.resolve("credentials", assigned.credentials as never);
    const secret = await resolver.resolve(ref, ctx);
    if (secret?.value && !secrets.includes(secret.value)) secrets.push(secret.value);
    return secret;
  };

  /** The agent's one provider resolution, shared by runs, `models.client` and `agent.models.resolve`: the model's provider id picks from the registry (the built-in first, then packages in load order). */
  const resolveProvider = (model: ModelConfig): ModelProvider => {
    const provider = providerEntries.get(model.provider)?.provider;
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
    return provider;
  };

  /**
   * One `models.client` turn with the agent's `retry` policy, the same loop a run turn uses. A failure is
   * retried only before the first event reaches the caller; after that the stream cannot be unsent, so a
   * failure surfaces as a redacted `error` event. Stop reasons land on the closed taxonomy.
   */
  async function* generateWithRetry(model: ModelSpec, request: Omit<ProviderRequest, "model">): AsyncGenerator<ProviderEvent> {
    const retry = mergeRetry(hostConfig.retry, undefined);
    const known = (): readonly string[] => [...secrets, ...((retry?.secrets ?? []) as string[])];
    const open = async (): Promise<{ first: IteratorResult<ProviderEvent>; iterator: AsyncIterator<ProviderEvent> }> => {
      const iterator = resolveProvider(model)
        .generate({ ...request, model })
        [Symbol.asyncIterator]();
      const first = await iterator.next();
      if (!first.done && first.value.type === "error") throw Object.assign(new Error(first.value.error.message), first.value.error);
      return { first, iterator };
    };
    const { first, iterator } = await retryLoop(open, {
      retry,
      sessionId: "",
      runId: "",
      signal: request.signal,
      classify: (error) => ({ info: errorToErrorInfo(error, known()) }),
    });
    const next = (event: ProviderEvent): ProviderEvent => {
      if (event.type === "error") return { ...event, error: redactSecrets(event.error, known()) };
      return event.type === "done" && event.stopReason !== undefined
        ? { ...event, stopReason: normalizeStopReason(event.stopReason) }
        : event;
    };
    try {
      let step = first;
      while (!step.done) {
        yield next(step.value);
        step = await iterator.next();
      }
    } catch (error) {
      yield { type: "error", error: errorToErrorInfo(error, known()) };
    } finally {
      // A caller that stops at `done` must still close the provider stream (an early `return()` skips the loop).
      await iterator.return?.();
    }
  }

  const emitPackageEvent = (owner: string, name: string, data: JsonValue): void => {
    if (typeof name !== "string" || name.length === 0 || name.length > MAX_EVENT_NAME) {
      throw new TypeError(`package event name must be 1-${MAX_EVENT_NAME} characters`);
    }
    const json = toJsonValue(data);
    if ("error" in json) throw new TypeError(`package event data ${json.error.message}`);
    // Outside a run there is no session redactor, so redact with the agent's own.
    bus.observe("package.event", { type: "package.event", sessionId: "", runId: "", package: owner, name, data: redactValue(json.value) });
  };

  const assertReadable = (pkg: string, member: string): void => {
    if (!setupComplete) {
      throw new PackageLoadError("state_not_ready", `Cannot call ${member} during setup.`, { package: pkg });
    }
  };
  const createApi = (state: State): PackageAPI<any> => {
    const { entry } = state;
    const name = entry.name;
    const slotRegistrar = Object.fromEntries(
      SLOT_NAMES.map((slot) => [
        slot,
        {
          provide(implementation: unknown) {
            requireCapability(name, entry.capabilities, `slot:${slot}` as Capability, `slots.${slot}.provide`);
            slots.provide(slot, name, implementation as never);
          },
          get default() {
            return slots.default(slot);
          },
        },
      ]),
    ) as unknown as SlotRegistrar;
    const host = hostFor(name);
    const logAt =
      (level: keyof Logger) =>
      (message: string, data?: Readonly<Record<string, unknown>>): void => {
        options.host?.log?.[level](redact(String(message)), { ...(data === undefined ? {} : redactValue(data)), package: name });
      };
    return {
      name,
      config: deepFreeze(cloneJson(entry.config)),
      configSources: state.entry.configSources,
      packages: {
        instances(names: readonly string[]): readonly PackageInstance[] {
          if (!setupComplete) {
            throw new PackageLoadError("state_not_ready", "Cannot query package instances during setup.", {
              package: name,
            });
          }
          for (const reqName of names) {
            if (reqName === name) {
              throw new PackageLoadError("self_instance", `Package ${name} cannot query its own instance.`, {
                package: name,
              });
            }
            if (disabled.packages.has(reqName)) {
              throw new PackageLoadError("package_disabled", `Package ${reqName} is disabled.`, {
                package: name,
              });
            }
            if (!loaded.some((e) => e.name === reqName)) {
              throw new PackageLoadError("unknown_package", `Package ${reqName} is not loaded.`, {
                package: name,
              });
            }
          }
          const result: PackageInstance[] = [];
          for (const e of loaded) {
            if (names.includes(e.name)) {
              result.push(
                Object.freeze({
                  definition: e.definition,
                  config: e.config,
                  optional: e.optional,
                  ...(e.source ? { source: e.source } : {}),
                }),
              );
            }
          }
          return Object.freeze(result);
        },
      },
      hooks: bus.registrar(name),
      slots: slotRegistrar,
      tools: {
        register: (tool, toolOptions) => registerTool(name, tool, toolOptions?.when),
        list: () => {
          assertReadable(name, "tools.list");
          return Object.freeze((options.registry?.tools() ?? []).map((tool) => Object.freeze({ ...tool })));
        },
      },
      skills: {
        register: (skill) => registerSkill(name, skill),
        list: () => {
          assertReadable(name, "skills.list");
          return Object.freeze((options.registry?.skills() ?? []).map((skill) => Object.freeze({ ...skill })));
        },
        get: (skillName) => {
          assertReadable(name, "skills.get");
          const found = options.registry?.skills().find((skill) => skill.name === skillName);
          return found === undefined ? undefined : Object.freeze({ ...found });
        },
        addDir(path) {
          if (typeof path !== "string" || path.length === 0) throw new TypeError("skills.addDir requires a directory path");
          state.skillDirs.push(path);
        },
      },
      providers: { register: (provider) => registerProvider(name, provider) },
      commands: { register: (command) => registerCommand(name, command) },
      models: {
        client(ref?: ModelRef): ModelClient {
          requireCapability(name, entry.capabilities, "models", "models.client");
          const configured = ref ?? hostConfig.model;
          if (!configured) throw new TypeError("models.client needs a model reference: the agent has none configured");
          const model = parseModelRef(configured);
          return { model, generate: (request) => generateWithRetry(model, request) };
        },
        embeddings(ref?: ModelRef) {
          requireCapability(name, entry.capabilities, "models", "models.embeddings");
          const configured = ref ?? hostConfig.model;
          if (!configured) throw new TypeError("models.embeddings needs a model reference: the agent has none configured");
          const model = parseModelRef(configured);
          const provider = resolveProvider(model);
          if (!modelSupportsEmbeddings(model.capabilities) || !provider.embeddings) {
            throw new EmbeddingsError(
              "unsupported_model",
              `Model ${model.provider}/${model.model} does not declare the embeddings capability`,
            );
          }
          return provider.embeddings();
        },
        decisions(ref?: ModelRef) {
          requireCapability(name, entry.capabilities, "models", "models.decisions");
          const configured = ref ?? hostConfig.model;
          if (!configured) throw new TypeError("models.decisions needs a model reference: the agent has none configured");
          const model = parseModelRef(configured);
          const provider = resolveProvider(model);
          // A string ref carries no capabilities; the adapter then gates its own model. A declared set without
          // the flag fails fast here.
          if (!provider.decisions || (model.capabilities !== undefined && !modelSupportsDecisions(model.capabilities))) {
            throw new DecisionsError(
              "unsupported_model",
              `Model ${model.provider}/${model.model} does not declare the decisions capability`,
            );
          }
          const adapter = provider.decisions();
          return {
            id: adapter.id,
            decide(request) {
              const bound = { ...request, model: model.model };
              assertDecisionRequest(bound, model);
              return adapter.decide(bound);
            },
          };
        },
      },
      credentials: {
        async resolve(ref: string) {
          requireCapability(name, entry.capabilities, "credentials", "credentials.resolve");
          return resolveCredentialRef(ref, { package: name });
        },
      },
      state: {
        session(key, initial) {
          requireCapability(name, entry.capabilities, "session-state", "state.session");
          declareStateKey(state, "session", key);
          usesSessionState = true;
          return createSessionState(name, key, initial);
        },
        log(key) {
          requireCapability(name, entry.capabilities, "session-state", "state.log");
          declareStateKey(state, "log", key);
          usesSessionState = true;
          return createSessionLog(name, key);
        },
        agent(key, initial) {
          declareStateKey(state, "agent", key);
          const held = createAgentState(key, initial);
          state.disposers.push(() => held.reset());
          return held;
        },
      },
      services: {
        provide(service, implementation) {
          const existing = services.get(service);
          if (existing) {
            throw new PackageLoadError("service_conflict", `Service ${service} is provided by both ${existing.owner} and ${name}.`, {
              package: name,
            });
          }
          services.set(service, { owner: name, implementation });
        },
        consume: (service) => services.get(service)?.implementation as never,
        require(service) {
          if (!services.has(service)) {
            throw new PackageLoadError(
              "missing_service",
              `Package ${name} requires service ${service}, which no loaded package provides.`,
              { package: name },
            );
          }
          return services.get(service)?.implementation as never;
        },
      },
      host,
      events: { emit: (event, data) => emitPackageEvent(name, event, data) },
      status: { note: (level, message) => note(name, level, message) },
      log: { debug: logAt("debug"), info: logAt("info"), warn: logAt("warn"), error: logAt("error") },
      onDispose: (fn) => {
        state.disposers.push(fn);
      },
    };
  };

  const failSetup = (entry: Entry, error: unknown): PackageLoadError => {
    if (error instanceof PackageLoadError) return error;
    // The raw cause is not kept: a third-party error can carry a secret in any property.
    const message = redact(error instanceof Error ? error.message : String(error)).slice(0, MAX_NOTE_LENGTH);
    return new PackageLoadError("setup_failed", `Package ${entry.name} setup failed: ${message}`, { package: entry.name });
  };

  /** Reads the directories `skills.addDir` recorded, after `setup` returned. A failure fails this package's setup. */
  const readSkillDirs = async (state: State): Promise<void> => {
    if (state.skillDirs.length === 0) return;
    const read = options.readSkillDir;
    if (!read) throw new TypeError("skills.addDir needs a skill directory reader, and this loader has none");
    for (const directory of state.skillDirs.splice(0)) {
      for (const skill of await read(directory)) registerSkill(state.entry.name, skill);
    }
  };

  /** Removes contributions by id. Runs after every `setup`, so a package cannot re-add one. */
  const applyDisable = (): void => {
    const disable = hostConfig.disable;
    if (!disable) return;
    const unknown = (kind: string, id: string): PackageLoadError =>
      new PackageLoadError("unknown_disable_id", `disable.${kind} names "${id.slice(0, 64)}", which nothing loaded carries.`);
    for (const id of disableIds("tools", disable.tools)) {
      if (toolEntries.delete(id)) packageTools.unregister?.(id);
      else if (listNames(hostConfig.tools?.add).includes(id)) disabled.tools.add(id);
      else throw unknown("tools", id);
    }
    for (const id of disableIds("skills", disable.skills)) {
      if (skillOwners.delete(id)) packageSkills.unregister?.(id);
      else if (listNames(hostConfig.skills?.add).includes(id)) disabled.skills.add(id);
      else throw unknown("skills", id);
    }
    for (const id of disableIds("commands", disable.commands)) {
      if (!commandEntries.delete(id)) throw unknown("commands", id);
    }
    for (const id of disableIds("hooks", disable.hooks)) {
      if (!bus.remove(id)) throw unknown("hooks", id);
    }
    for (const id of disableIds("packages", disable.packages)) {
      const isLoaded = loaded.some((e) => e.name === id);
      const isSkipped = skippedEntries.some((e) => e.name === id);
      if (!isLoaded && !isSkipped) throw unknown("packages", id);
      disabled.packages.add(id);
      for (const [toolName, entry] of [...toolEntries.entries()]) {
        if (entry.owner === id) {
          toolEntries.delete(toolName);
          packageTools.unregister?.(toolName);
        }
      }
      for (const [skillName, owner] of [...skillOwners.entries()]) {
        if (owner === id) {
          skillOwners.delete(skillName);
          packageSkills.unregister?.(skillName);
        }
      }
      for (const [cmdName, entry] of [...commandEntries.entries()]) {
        if (entry.package === id) {
          commandEntries.delete(cmdName);
        }
      }
      bus.removeOwner(id);
    }
  };

  const loaded: Entry[] = [];
  try {
    // The host's own `tools.add` / `skills.add` are validated here, so a duplicate name fails the
    // load closed (the check `createSecureAgent` used to get from `createToolRegistry`).
    createToolRegistry(hostConfig.tools?.add ?? [], { duplicate: "error" });
    createSkillRegistry(hostConfig.skills?.add ?? [], { duplicate: "error" });
    // 6. Run `setup` in order. Packages first, then the inline host package.
    for (const entry of ordered) {
      const state: State = { entry, disposers: [], skillDirs: [], stateKeys: new Set() };
      started.push(state);
      try {
        await entry.definition.setup(createApi(state));
        await readSkillDirs(state);
        loaded.push(entry);
      } catch (error) {
        const failure = failSetup(entry, error);
        if (!entry.optional) throw failure;
        await teardown(state);
        started.splice(started.indexOf(state), 1);
        skippedEntries.push(entry);
        note(entry.name, "warn", `skipped: ${failure.message}`);
      }
    }
    if (options.hostHooks) options.hostHooks(bus.registrar(HOST_OWNER));

    // Required services are checked after every setup, since services are provided during `setup`.
    for (const entry of loaded) {
      for (const service of entry.definition.requires?.services ?? []) {
        if (!services.has(service)) {
          throw new PackageLoadError(
            "missing_service",
            `Package ${entry.name} requires service ${service}, which no loaded package provides.`,
            {
              package: entry.name,
            },
          );
        }
      }
    }

    // 7. Resolve slot ownership, so a conflict fails the load instead of the first run.
    const assignments = (options.slotAssignments ?? {}) as Partial<Record<SlotName, unknown>>;
    for (const slot of SLOT_NAMES) slots.resolve(slot, assignments[slot] as never);

    // 8. Apply `disable`.
    applyDisable();
    setupComplete = true;
  } catch (error) {
    await unwind();
    bus.removeOwner(HOST_OWNER);
    throw error;
  }

  const states = [...started];
  const resolvesCredentials = loaded.some((entry) => entry.capabilities.has("credentials"));
  const capabilities = new Map(loaded.map((entry) => [entry.name, entry.capabilities]));
  const describe = (entry: Entry, status: "loaded" | "skipped"): LoadedPackage => ({
    name: entry.name,
    version: entry.version,
    optional: entry.optional,
    status,
    ...(entry.definition.description === undefined ? {} : { description: entry.definition.description }),
    capabilities: [...entry.capabilities],
    config: entry.config,
    configSources: entry.configSources,
    source: entry.source ? `manifest:${entry.source.scope}` : "code",
  });
  return {
    packages: loaded.map((entry) => describe(entry, "loaded")),
    skippedPackages: skippedEntries.map((entry) => describe(entry, "skipped")),
    capabilities,
    statusNotes: () => [...notes],
    tools: () => [...toolEntries.values()],
    skills: () => packageSkills.list(),
    skillEntries: () => packageSkills.list().map((skill) => ({ owner: skillOwners.get(skill.name) ?? "", skill })),
    provider: (id) => providerEntries.get(id)?.provider,
    providers: () => [...[...providerEntries.values()].map((entry) => ({ owner: entry.owner, provider: entry.provider }))],
    resolveProvider,
    commands: () => [...commandEntries.values()],
    disabled,
    hostFor,
    resolvesCredentials,
    get usesSessionState() {
      return usesSessionState;
    },
    redactor: (base) => (resolvesCredentials ? { redact: <T>(value: T): T => redactSecrets(base?.redact(value) ?? value, secrets) } : base),
    async runCommand(name, args, context) {
      const entry = commandEntries.get(name);
      if (!entry) throw new PackageLoadError("unknown_command", `Unknown command: ${String(name).slice(0, 64)}.`);
      const result = validateJsonSchema(entry.command.args ?? { type: "object" }, args ?? {});
      if (!result.ok) {
        const first = result.errors[0];
        throw new PackageLoadError(
          "command_args_invalid",
          `Command ${name} arguments are invalid: ${first?.path ?? "/"} ${first?.message ?? ""}`.trim(),
          {
            package: entry.package,
            ...(first?.path ? { path: first.path } : {}),
          },
        );
      }
      return entry.command.run(result.value as JsonObject, {
        ...(context.session ? { session: context.session } : {}),
        host: hostFor(entry.package, context.session?.id),
        agent: context.agent,
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      bus.removeOwner(HOST_OWNER);
      for (const state of [...states].reverse()) await teardown(state);
    },
  };
}
