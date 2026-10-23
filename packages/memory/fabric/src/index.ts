/**
 * `@arnilo/prism-memory-fabric` — working, semantic, and scoped memory as a package (plan 158 Task 4).
 *
 * The package owns the 0.12 memory fabric (typed notes, consolidation, the linker/evolution workers,
 * the scoped policy layer) and adds the package surface the roadmap §2.9 row asks for: the
 * `memory.*` tools, a `context.build` block, and per-session state.
 *
 * Cost: working memory makes no model call and no embedding call. Semantic memory makes one
 * embedding call per write and per recall through the `embeddings` service another package provides
 * (install `@arnilo/prism-memory-rag`). The opt-in workers add embedding calls on writes; they make
 * no model call. Every tool call and worker runs only for a session where the fabric is enabled.
 *
 * ```ts
 * import memoryFabric from "@arnilo/prism-memory-fabric";
 * import memoryRag from "@arnilo/prism-memory-rag";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai/gpt-5",
 *   packages: [memoryRag({ embeddings: { model: "openai/text-embedding-3-small" } }), memoryFabric({ semantic: true })],
 * });
 * ```
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  definePackage,
  type JsonObject,
  type JsonSchema,
  type PackageAPI,
  type PackageCommand,
  type PackageCommandContext,
  type PackageInstance,
  type Secret,
  type SessionContext,
  type SessionState,
} from "@arnilo/prism";
import {
  createMemoryVectorStore,
  type Embedder,
  type Memory,
  MemoryValidationError,
  type MemoryVectorRecord,
  type VectorStore,
  type WorkingMemoryStore,
} from "@arnilo/prism-memory-core";
import manifest from "../package.json" with { type: "json" };
import {
  type MemoryFabricConfig,
  memoryFabricConfigSchema,
  type ResolvedLifecycleConfig,
  type ResolvedMemoryFabricConfig,
  resolveMemoryFabricConfig,
} from "./config.js";
import { ConsolidationExtractionError } from "./consolidation/extract.js";
import { hasNewObservationalMaterial } from "./consolidation/pass.js";
import { createFabricCitationTracker, createFabricContext } from "./context.js";
import { createMemoryFabric } from "./create.js";
import { createFabricCore } from "./delivery/core.js";
import { createFabricCues } from "./delivery/cues.js";
import { createFabricTeam, type FabricTeam, type FabricTeamApproval } from "./delivery/team.js";
import { createFabricDirectory } from "./directory.js";
import { createExchangeArchive, type ExchangeArchive, exchangePairs } from "./exchanges.js";
import { createFabricFileJail } from "./files.js";
import { createScopeClock, readScopeClockState, SCOPE_CLOCK_COUNTER } from "./lifecycle/clock.js";
import { citationEvidence } from "./lifecycle/evidence.js";
import { createFabricLifecycle, describeNote, type FabricLifecycle, inspectNote, normalizeNoteStatus } from "./lifecycle/index.js";
import { createMemory } from "./memory.js";
import { exportMemoryOkf, importMemoryOkf } from "./okf-bundle.js";
import { readPromoteState } from "./promote.js";
import { reconcileFabricFiles } from "./reconcile.js";
import { renderProjectFile } from "./scope/identity.js";
import { createTouchedPathTracker, type TouchedPathTracker } from "./scope/touched-paths.js";
import { createScopedMemoryPolicy } from "./scoped/policy.js";
import { createMemoryFabricTools } from "./tools.js";
import {
  type CreateMemoryFabricOptions,
  type MemoryFabric,
  type MemoryFabricRecallOptions,
  type MemoryFabricRecallResult,
  parseMemoryNoteMetadata,
} from "./types.js";
import { createMemoryWorkingStore } from "./working-memory.js";

export {
  type MemoryFabricConfig,
  type MemoryFabricCoreConfig,
  type MemoryFabricCuesConfig,
  type MemoryFabricExchangesConfig,
  type MemoryFabricInjectConfig,
  type MemoryFabricLifecycleConfig,
  type MemoryFabricMarkdownStoreConfig,
  type MemoryFabricPostgresStoreConfig,
  type MemoryFabricProjectScopeConfig,
  type MemoryFabricScopedConfig,
  type MemoryFabricScopesConfig,
  type MemoryFabricTeamConfig,
  type MemoryFabricToolsConfig,
  memoryFabricConfigSchema,
  memoryFabricLifecycleSchema,
  type ResolvedFabricCoreOptions,
  type ResolvedFabricExchangesOptions,
  type ResolvedFabricScope,
  type ResolvedFabricTeamOptions,
  type ResolvedLifecycleConfig,
  type ResolvedMemoryFabricConfig,
  resolveLifecycleConfig,
  resolveMemoryFabricConfig,
} from "./config.js";
export { type MemoryConformanceStores, runMemoryConformance } from "./conformance.js";
// The moved 0.12 library surface (fabric, scoped policy, memory, working memory, conformance).
export * from "./exports.js";
export { createMemory } from "./memory.js";
export { type ProjectIdentity, projectResourceId, resolveProjectIdentity } from "./scope/identity.js";
export * from "./scoped/index.js";
export { createMemoryWorkingStore, type MemoryWorkingStoreOptions, validateWorkingValue } from "./working-memory.js";

const FABRIC_ENABLED_KEY = "fabric.enabled";
const TOUCHED_PATHS_KEY = "fabric.touchedPaths";
const CUES_STATE_KEY = "fabric.cues";
const PROMOTE_STATE_KEY = "fabric.promote";
const EXCHANGE_STATE_KEY = "fabric.exchanges";
const SCOPE_CLOCK_KEY = "fabric.clock";
const FABRIC_CONTEXT_HOOK_ID = "memory-fabric:context.build";

export const packageName = "@arnilo/prism-memory-fabric";

const definition = definePackage<MemoryFabricConfig>({
  name: "@arnilo/prism-memory-fabric",
  version: manifest.version,
  description: "Working, semantic, and scoped memory: the memory.* tools, a context block, and per-session state.",
  requires: { api: 1 },
  capabilities: ["session-state", "credentials", "models", "background", "host-ui"],
  config: memoryFabricConfigSchema,
  setup: async (prism) => {
    const config = resolveMemoryFabricConfig(prism.config);
    if (config.scopeWarning !== undefined) prism.status.note("warn", config.scopeWarning);
    const enabled = prism.state.session<boolean>(FABRIC_ENABLED_KEY, config.enabled);
    // Touched files arm a `path` note's prior. In memory per session; written once per turn on change.
    const touchedState = prism.state.session<JsonObject>(TOUCHED_PATHS_KEY, { paths: [] });
    const touchedTrackers = new Map<string, TouchedPathTracker>();
    const touchedFor = (session: SessionContext): TouchedPathTracker => {
      let tracker = touchedTrackers.get(session.id);
      if (tracker === undefined) {
        tracker = createTouchedPathTracker({
          root: config.scopes.project?.root ?? config.tools.root ?? process.cwd(),
          store: { get: () => touchedState.get(session), set: (value) => touchedState.set(session, { paths: [...value.paths] }) },
        });
        touchedTrackers.set(session.id, tracker);
      }
      return tracker;
    };
    const touchedPathsFor = (sessionId: string): readonly string[] => touchedTrackers.get(sessionId)?.paths() ?? [];

    // The `embeddings` service is consumed lazily: the providing package (for example
    // `@arnilo/prism-memory-rag`) may load after this one, so availability is a per-call question.
    const embeddingsService = (): Embedder | undefined => prism.services.consume<Embedder>("embeddings");
    // Indexed notes are always available; the retrieval mode alone decides whether an embedder is used.
    const indexedNotes = (): boolean => config.semantic;
    const embedder: Embedder | undefined =
      config.semantic && config.retrieval === "hybrid" ? createServiceEmbedder(embeddingsService) : undefined;
    if (config.retrieval === "hybrid" && !embeddingsService()) {
      prism.status.note(
        "warn",
        "memory-fabric: retrieval hybrid needs an embeddings service (for example @arnilo/prism-memory-rag); using lexical",
      );
    }

    const sqliteFile =
      config.store !== "memory" && "sqlite" in config.store && config.tools.root
        ? relative(resolve(config.tools.root), config.store.sqlite.path).split(sep).join("/")
        : undefined;
    // The markdown store's own tree is never mirrored as `file` notes or listed by the file reconcile.
    const notesRel =
      typeof config.store === "object" && "markdown" in config.store && config.tools.root
        ? relative(resolve(config.tools.root), config.store.markdown.dir).split(sep).join("/")
        : undefined;
    const stores = await resolveStore(prism, config);
    if (!stores) return;
    const { vectorStore, workingStore } = stores;
    if (stores.close) {
      const close = stores.close;
      prism.onDispose(() => close());
    }

    // One Memory per active scope over the shared stores; active is narrowest first (project, agent, user).
    const memories = config.scopes.active.map((scope) => ({
      level: scope.level,
      memory: createMemory({
        tenantId: config.scopes.tenantId,
        resourceId: scope.resourceId,
        threadId: config.scopes.threadId,
        ...(embedder === undefined ? {} : { embedder }),
        vectorStore,
        workingStore,
        ...(config.limits === undefined ? {} : { limits: config.limits }),
        ...(config.workingMemoryTemplate === undefined ? {} : { workingMemoryTemplate: config.workingMemoryTemplate }),
      }),
    }));
    const memory = memories[0]!.memory;
    // A project this process did not bind is opened over the same stores on demand, so a nightly
    // `memory:maintain` can widen across every project of this tenant (plan 188.4 Further Action 2).
    const openScope = ({ resourceId }: { readonly resourceId: string }) =>
      createMemory({
        tenantId: config.scopes.tenantId,
        resourceId,
        threadId: config.scopes.threadId,
        ...(embedder === undefined ? {} : { embedder }),
        vectorStore,
        workingStore,
        ...(config.limits === undefined ? {} : { limits: config.limits }),
        ...(config.workingMemoryTemplate === undefined ? {} : { workingMemoryTemplate: config.workingMemoryTemplate }),
      });
    // The scope ordinal this process ranks against; the tick below refreshes it once per session.
    let sessionClock = 0;
    const fabricOptions: CreateMemoryFabricOptions = {
      memory,
      scopes: memories,
      promote: config.promote,
      promoteRoot: config.scopes.project?.root ?? config.tools.root ?? process.cwd(),
      exchanges: { enabled: config.exchanges.enabled },
      // The repository rules need a real root, not the cwd fallback `promoteRoot` uses for derivability.
      repositoryRules:
        config.scopes.active.some((scope) => scope.level === "project") &&
        (config.scopes.project?.root !== undefined || config.tools.root !== undefined),
      resolveModelClient: (model) => prism.models.client(model),
      onDeciderFailure: () => prism.status.note("warn", "memory-fabric: consolidation decision failed; preserving both notes"),
      notify: (message) => prism.status.note("warn", message),
      ...(config.consolidate === undefined ? {} : { consolidate: config.consolidate }),
      ...(config.linker === undefined ? {} : { linker: config.linker }),
      ...(config.evolution === undefined ? {} : { evolution: config.evolution }),
      ...(config.passive === undefined ? {} : { passive: config.passive }),
      ...(config.workerLimits === undefined ? {} : { workerLimits: config.workerLimits }),
      scopePriors: config.scopes.priors,
      touchedPaths: touchedPathsFor,
      lifecycle: config.lifecycle,
      clock: () => sessionClock,
      openScope,
    };
    // The team store: a checked-in `.prism/memory/` the fabric recalls as scope `team`. Its derived
    // index lives under tools.root, so the repository holds notes only (plan 188.5 Task 3).
    const teamProject = config.scopes.project;
    let team: FabricTeam | undefined;
    if (config.team && config.semantic && teamProject !== undefined && config.tools.root !== undefined) {
      if (existsSync(config.team.dir) && vectorStore.scanMetadata !== undefined) {
        team = await createFabricTeam({
          options: config.team,
          index: join(config.tools.root, ".team-index", `${teamProject.resourceId.split("--").at(-1)}.sqlite`),
        });
        prism.onDispose(() => team?.close());
        if (team.quarantined > 0) {
          prism.status.note("warn", `memory-fabric: ${team.quarantined} team note(s) quarantined by the trust scan`);
        }
      }
    } else if (config.team && config.tools.root === undefined) {
      prism.status.note("warn", "memory-fabric: team memory needs tools.root for its index; team store is off");
    }
    const fabric = createMemoryFabric({
      ...fabricOptions,
      vectorStore,
      ...(team === undefined ? {} : { readOnlyScopes: [{ level: "team" as const, memory: team.memory }] }),
    });
    // `project.md` records the identity and every root this checkout has been seen at. The markdown
    // store holds the file; the other stores keep the identity only in config.
    if (config.scopes.project !== undefined && stores.updateResourceFile !== undefined) {
      const project = config.scopes.project;
      await stores.updateResourceFile({ tenantId: config.scopes.tenantId, resourceId: project.resourceId }, "project.md", (current) =>
        renderProjectFile(project, current),
      );
    }
    const lifecycle = createFabricLifecycle(memory);
    // The scope clock measures decay and archival in sessions worked, not calendar days (plan 188.4).
    const scopeClock =
      vectorStore.scopeCounter === undefined ? undefined : createScopeClock(vectorStore.scopeCounter, config.scopes.tenantId);
    const scopeClockState = prism.state.session<JsonObject>(SCOPE_CLOCK_KEY, { counted: [] });
    const activeResourceIds = config.scopes.active.map((scope) => scope.resourceId);
    if (scopeClock === undefined) {
      prism.status.note("info", "memory-fabric: the store has no scopeCounter; the scope clock stays at 0");
    }
    let warnedClock = false;
    // One ordinal serves the whole process: every session ticks the same active resources, so two
    // concurrent sessions differ by one and the newest value is the closer estimate.
    const clockResourceId = activeResourceIds[0]!;
    const tickScopeClock = async (session: SessionContext, signal?: AbortSignal): Promise<void> => {
      if (scopeClock === undefined) return;
      const counted = readScopeClockState(scopeClockState.get(session)).counted;
      const options = signal === undefined ? {} : { signal };
      try {
        if (!activeResourceIds.every((resourceId) => counted.includes(resourceId))) {
          const ticked = await scopeClock.tick(counted, activeResourceIds, options);
          await scopeClockState.set(session, { counted: [...ticked.counted] });
        }
        sessionClock = await scopeClock.read(clockResourceId, options);
      } catch (error) {
        // A failed counter write never blocks the turn: recall and writes stay unaffected.
        if (!warnedClock) {
          warnedClock = true;
          prism.status.note("warn", `memory-fabric: scope clock write failed (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    };
    // Per-session evidence cursors: the last entry a turn credited, so no correction counts twice.
    const evidenceCursor = new Map<string, string>();
    const helpedNotes = new Map<string, Set<string>>();
    const promoteState = prism.state.session<JsonObject>(PROMOTE_STATE_KEY, { refused: 0 });
    // Turns since the last background pass, per session. In memory: a restored session starts at 0,
    // and the `session.opened` catch-up covers whatever the previous process missed.
    const turnsSincePass = new Map<string, number>();
    const recordPass = async (session: SessionContext, result: Awaited<ReturnType<MemoryFabric["consolidate"]>>): Promise<void> => {
      const state = readPromoteState(promoteState.get(session));
      if (result.report !== undefined) {
        await promoteState.set(session, {
          ...(result.cursor === undefined ? (state.cursor === undefined ? {} : { cursor: state.cursor }) : { cursor: result.cursor }),
          last: result.report as unknown as JsonObject,
          refused: state.refused,
        });
        if (result.report.rejected.trust > 0) {
          prism.status.note("warn", `memory-fabric: ${result.report.rejected.trust} consolidated note(s) refused by the trust scan`);
        }
      }
    };
    const consolidateNow = async (session: SessionContext, signal?: AbortSignal): Promise<void> => {
      const state = readPromoteState(promoteState.get(session));
      const result = await fabric.consolidate(session, {
        ...(signal === undefined ? {} : { signal }),
        ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
      });
      await recordPass(session, result);
    };

    // The directory is recomputed only after a write bumped the memory's version; the startup reconcile
    // writes through the store directly, so it invalidates by hand.
    const directory = config.directory
      ? {
          options: config.directory,
          source: createFabricDirectory({
            memory,
            memories,
            ...(config.tools.root
              ? {
                  files: createFabricFileJail(
                    config.tools.root,
                    config.tools.maxFileBytes === undefined ? {} : { maxFileBytes: config.tools.maxFileBytes },
                  ),
                  exclude: (path: string) => sqliteFile !== undefined && (path === sqliteFile || path.startsWith(`${sqliteFile}-`)),
                }
              : {}),
          }),
        }
      : undefined;

    // The pinned core: top notes by storage strength, in the prefix and stable between rebuilds. It
    // needs the store's metadata scan; without one it is off and says why once.
    const core =
      config.core && vectorStore.scanMetadata !== undefined
        ? createFabricCore({
            options: config.core,
            scanMetadata: vectorStore.scanMetadata.bind(vectorStore),
            scopes: memories.filter(
              (binding): binding is { readonly level: "user" | "project"; readonly memory: Memory } =>
                binding.level === "user" || binding.level === "project",
            ),
            storageWeights: config.lifecycle.storageWeights,
            ...(stores.writeDerivedFile === undefined
              ? {}
              : { writeFile: (scope, content) => stores.writeDerivedFile!(scope, "core.md", content) }),
            notify: (message) => prism.status.note("warn", message),
          })
        : undefined;
    if (config.core && vectorStore.scanMetadata === undefined) {
      prism.status.note("info", "memory-fabric: the store has no scanMetadata; core memory is off");
    }

    // Path cues: a path-scoped note shows once, when a file tool touches a matching file. It needs
    // the project scope (path notes live there) and the store's metadata scan; `semantic: false`
    // means no indexed notes exist, so there is nothing to cue.
    const cueState = prism.state.session<JsonObject>(CUES_STATE_KEY, { injected: [] });
    const projectMemory = memories.find((binding) => binding.level === "project")?.memory;
    const cues =
      config.cues && config.semantic && vectorStore.scanMetadata !== undefined && projectMemory !== undefined
        ? createFabricCues({
            memory: projectMemory,
            options: config.cues,
            scanMetadata: vectorStore.scanMetadata.bind(vectorStore),
            state: {
              get: (session) => cueState.get(session),
              set: (session, value) => cueState.set(session, { injected: [...value.injected] }),
            },
            storageWeights: config.lifecycle.storageWeights,
            decay: config.lifecycle.decay,
            clock: () => sessionClock,
          })
        : undefined;

    // Defer until every package has provided its services; disposal drains the pass before closing stores.
    let reconcile: Promise<void> | undefined;
    if (config.tools.root && config.semantic) {
      const controller = new AbortController();
      reconcile = (async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (controller.signal.aborted) return;
        const deadline = setTimeout(() => controller.abort(), memory.limits.rebuildMs);
        try {
          await reconcileFabricFiles({
            memory,
            vectorStore,
            root: config.tools.root!,
            maxFileBytes: config.tools.maxFileBytes,
            sqlitePath: [
              ...(config.store !== "memory" && "sqlite" in config.store ? [config.store.sqlite.path] : []),
              // The team index sits under tools.root; never mirror its SQLite file as a `file` note.
              ...(team === undefined ? [] : [team.index]),
            ],
            ...(notesRel === undefined ? {} : { notesDir: notesRel }),
            signal: controller.signal,
          });
        } catch {
          prism.status.note("warn", "memory-fabric: startup file reconcile incomplete");
        } finally {
          clearTimeout(deadline);
          directory?.source.invalidate();
        }
      })();
      prism.onDispose(async () => {
        controller.abort();
        await reconcile;
      });
    }

    // The scoped policy layer replaces the plain recall when configured, so its activation floor,
    // decay, and abstention stay enforced on every `memory.recall` result.
    const recall =
      config.scoped === undefined
        ? fabric.recall
        : scopedRecall(
            config,
            memory,
            fabric,
            () => sessionClock,
            (ignored) =>
              prism.status.note(
                "warn",
                `memory-fabric: ignored lifecycle fields on ${ignored} older scoped ledger row(s); the note lifecycle is authoritative`,
              ),
          );

    /** `memory.read` by id looks in every active scope, narrowest first, through each scope's own read filters. */
    const readNotesAcrossScopes = async (ids: readonly string[], signal?: AbortSignal): Promise<readonly MemoryVectorRecord[]> => {
      const found = new Map<string, MemoryVectorRecord>();
      for (const binding of memories) {
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length === 0) break;
        for (const record of await binding.memory.get(missing, signal === undefined ? {} : { signal })) {
          if (!found.has(record.id)) found.set(record.id, record);
        }
      }
      return [...found.values()];
    };

    // The exchange archive (plan 188.9 Task 7): verbatim turns in the scope resolved at setup. Off by
    // default; the write runs in the background and makes no model or embedding call.
    const exchangeState = prism.state.session<JsonObject>(EXCHANGE_STATE_KEY, { archived: 0 });
    const exchangeArchive = config.exchanges.enabled
      ? createExchangeArchive({
          remember: fabric.remember,
          exists: async (id) => (await readNotesAcrossScopes([id])).length > 0,
          maxTextChars: memory.limits.maxEntryTextChars,
          scope: config.exchanges.scope,
        })
      : undefined;

    // --- tools: `when` gates visibility and callability per session (the kernel blocks hidden calls).
    // `memory.recall` additionally needs the embeddings service, which may arrive after this package.
    const tracker = createFabricCitationTracker();
    const tools = createMemoryFabricTools({
      memory,
      remember: fabric.remember,
      recall,
      forget: fabric.forget,
      isIndexedNotesAvailable: indexedNotes,
      tracker,
      readNotes: readNotesAcrossScopes,
      scopeLevel: memories[0]!.level,
      ...(directory ? { directory } : {}),
      lifecycle: {
        verify: (id, signal) => lifecycle.verify(id, signal === undefined ? {} : { signal }),
      },
      touchedPaths: touchedPathsFor,
    })(config.tools);
    for (const tool of tools) {
      prism.tools.register(tool, { when: (session) => enabled.get(session) });
    }

    const projection = createFabricContext(
      memory,
      recall,
      config.semantic ? config.inject : false,
      {},
      directory,
      tracker,
      touchedPathsFor,
      core,
      cues,
    );
    let warnedFloor = false;
    prism.hooks.on(
      "context.build",
      async (draft, context) => {
        await reconcile;
        if (!context.session || !enabled.get(context.session)) return undefined;
        // First context.build of the session ticks each active scope once; session state carries it across a restore.
        await tickScopeClock(context.session);
        if (config.inject && config.retrieval === "hybrid" && !warnedFloor) {
          warnedFloor = true;
          prism.status.note(
            "info",
            `memory-fabric: embedder ${embeddingsService()?.id ?? "unknown"} uses provisional cosine floor ${config.inject.minSimilarity ?? 0.35}; calibration pending Task 14`,
          );
        }
        return projection.build(draft, context);
      },
      { id: FABRIC_CONTEXT_HOOK_ID, priority: -1_100 },
    );
    prism.hooks.on("message.delta", (event, context) => projection.observe(event.content, context));
    prism.hooks.on("tool.started", (event, context) => {
      const session = context.session;
      if (!session || !enabled.get(session)) return;
      touchedFor(session).record({ name: event.call.name, arguments: event.call.arguments });
    });
    // A completed turn is archived once the reply is on the branch (`message.completed` fires after
    // the append; `turn.completed` fires inside the provider round, before it). Tool rounds are not
    // exchanges, so an assistant message carrying a `tool_call` is skipped.
    prism.hooks.on("message.completed", (event, context) => {
      const session = context.session;
      if (exchangeArchive === undefined || !session || !enabled.get(session)) return;
      const message = event.message;
      if (message.role !== "assistant" || message.content.some((block) => block.type === "tool_call")) return;
      const replyText = message.content.some((block) => block.type === "text" && block.text.trim().length > 0);
      if (!replyText) return;
      session.background("fabric.exchange", async (signal) => {
        const entries = await session.entries();
        const text = message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n")
          .trim();
        // The entry id is not in the event; match the persisted message by id, then by its text. A mock
        // or provider that omits a message id still archives the reply that just completed.
        const assistant =
          (message.id === undefined
            ? undefined
            : entries.find((entry) => entry.message !== undefined && entry.message.id === message.id)) ??
          [...entries].reverse().find((entry) => entry.message?.role === "assistant" && messageTextMatches(entry.message, text));
        const pair = assistant === undefined ? undefined : exchangePairs(entries).find((item) => item.assistant.id === assistant.id);
        if (pair === undefined) return;
        const report = await exchangeArchive.pair(pair, { sessionId: session.id, signal });
        if (report.refused.trust + report.refused.secret > 0) {
          prism.status.note(
            "warn",
            `memory-fabric: ${report.refused.trust + report.refused.secret} exchange(s) refused by the trust scan or redactor; not archived`,
          );
        }
        if (report.archived > 0) {
          const state = readExchangeState(exchangeState.get(session));
          await exchangeState.set(session, { cursor: pair.assistant.id, archived: state.archived + report.archived });
        }
      });
    });
    prism.hooks.on("session.closed", (_event, context) => {
      touchedTrackers.delete(context.sessionId);
      turnsSincePass.delete(context.sessionId);
      evidenceCursor.delete(context.sessionId);
      helpedNotes.delete(context.sessionId);
      cues?.forget(context.sessionId);
      tracker.clear?.(context.sessionId);
    });
    prism.hooks.on("session.opened", async (event, context) => {
      const session = context.session;
      if (!session || event.restored !== true || !enabled.get(session) || !config.promote.enabled) return;
      const state = readPromoteState(promoteState.get(session));
      if (!hasNewObservationalMaterial(await session.entries(), state.cursor)) return;
      turnsSincePass.set(session.id, 0);
      session.background("fabric.consolidate", (signal) => consolidateNow(session, signal));
    });
    prism.hooks.on("turn.completed", async (_event, context) => {
      const session = context.session;
      if (!session || !enabled.get(session)) return;
      if (config.promote.enabled) {
        const turns = (turnsSincePass.get(session.id) ?? 0) + 1;
        turnsSincePass.set(session.id, turns);
        if (turns >= config.promote.minTurnsBetween) {
          const state = readPromoteState(promoteState.get(session));
          // A turn with no new OM material starts no task and makes no model call.
          if (hasNewObservationalMaterial(await session.entries(), state.cursor)) {
            turnsSincePass.set(session.id, 0);
            session.background("fabric.consolidate", (signal) => consolidateNow(session, signal));
          }
        }
      }
      const touched = touchedFor(session);
      if (touched.dirty()) session.background("fabric.touched-paths", () => touched.flush());
      // One lifecycle task per turn: citations are uses, outcome tags are helpful evidence, and a user
      // correction that cites a note is harmful evidence (plan 188.4 Task 1).
      const ids = projection.cited(context);
      const retrievals = tracker.takeRetrievals(session.id);
      const entries = await session.entries();
      const helped = helpedNotes.get(session.id) ?? new Set<string>();
      helpedNotes.set(session.id, helped);
      const evidence = citationEvidence({
        entries,
        ...(evidenceCursor.get(session.id) === undefined ? {} : { cursor: evidenceCursor.get(session.id)! }),
        cited: ids,
        helped,
      });
      for (const id of evidence.helpful) helped.add(id);
      if (evidence.cursor !== undefined) evidenceCursor.set(session.id, evidence.cursor);
      session.background("fabric.lifecycle", async (signal) => {
        if (ids.length) await memory.touch(ids, { signal });
        await lifecycle.recordUses(session.id, ids, {
          clock: sessionClock,
          verifyAfterSessions: config.lifecycle.verifyAfterSessions,
          signal,
        });
        await lifecycle.recordRetrievals(retrievals, { signal });
        await lifecycle.recordEvidence(evidence, { signal });
      });
    });

    // --- command: toggle this session's fabric without touching another session's state.
    prism.commands.register(createMemoryCommand(enabled));
    prism.commands.register(createMemoryConsolidateCommand(fabric, promoteState));
    prism.commands.register(createMemoryStatusCommand(lifecycle, promoteState, team));
    if (team !== undefined) {
      const ui = () => prism.host.ui;
      prism.commands.register(createMemoryShareCommand(team, memory, ui));
    }
    prism.commands.register(
      createMemoryLifecycleCommand({
        memories: memories.map((binding) => binding.memory),
        store: vectorStore,
        clock: () => sessionClock,
        lifecycle: config.lifecycle,
      }),
    );
    prism.commands.register(createMemoryArchiveCommand(exchangeArchive, exchangeState, (message) => prism.status.note("warn", message)));
    prism.commands.register(createMemoryMaintainCommand(fabric));
    prism.commands.register(createMemoryReindexCommand(stores.reindex));
    const bundle = {
      memory,
      stores: { vectorStore, workingStore },
      embedder,
      root: config.tools.root,
      notesDir: notesRel === undefined ? undefined : resolve(config.tools.root!, notesRel),
      refresh: () => {
        directory?.source.invalidate();
        core?.invalidate();
        cues?.invalidate();
      },
    };
    prism.commands.register(createMemoryExportCommand(bundle));
    prism.commands.register(createMemoryImportCommand(bundle));
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link memoryFabric}. */
export default definition;

/** The package with config baked in, for `packages: [memoryFabric({ ... })]`. */
export function memoryFabric(config: MemoryFabricConfig): PackageInstance {
  return definition(config);
}

/**
 * An `Embedder` that resolves another package's `embeddings` service on each call, so a provider
 * loaded after this package is still visible. Fails closed when the service never arrives.
 */
function createServiceEmbedder(consume: () => Embedder | undefined): Embedder {
  const required = (): Embedder => {
    const embedder = consume();
    if (!embedder) throw new MemoryValidationError("memory-fabric: no package provides the embeddings service");
    return embedder;
  };
  return {
    get id(): string {
      return consume()?.id ?? "prism-fabric-pending";
    },
    get dimensions(): number {
      return consume()?.dimensions ?? 0;
    },
    available: () => consume() !== undefined,
    embed: (texts, options) => required().embed(texts, options),
  };
}

/** The stores `resolveStore` returns: always a vector and working store, optionally closable and reindexable. */
interface ResolvedFabricStores {
  readonly vectorStore: VectorStore;
  readonly workingStore: WorkingMemoryStore;
  readonly close?: () => void | Promise<void>;
  readonly reindex?: FabricReindex;
  /** Present on the markdown store: creates or updates a resource-level OKF file under its lock. */
  readonly updateResourceFile?: (
    scope: { readonly tenantId: string; readonly resourceId: string },
    name: string,
    update: (current: string | undefined) => string,
  ) => Promise<void>;
  /** Present on the markdown store: writes a derived file, logging a human edit it overwrites. */
  readonly writeDerivedFile?: (
    scope: { readonly tenantId: string; readonly resourceId: string },
    name: string,
    body: string,
  ) => Promise<void>;
}

/** The configured vector store. Postgres resolves the connection ref and loads `pg` only when configured. */
async function resolveStore(
  prism: PackageAPI<MemoryFabricConfig>,
  config: ResolvedMemoryFabricConfig,
): Promise<ResolvedFabricStores | undefined> {
  if (config.store === "memory") {
    prism.status.note("warn", "memory-fabric: no durable store configured; memory is lost when the process exits");
    return { vectorStore: createMemoryVectorStore(), workingStore: createMemoryWorkingStore() };
  }
  if ("markdown" in config.store) {
    const jail = createFabricFileJail(config.tools.root!);
    const dir = config.store.markdown.dir;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await jail.resolve(dir);
    const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
    const stores = await createMarkdownMemoryStores({
      root: dir,
      ...(config.limits === undefined ? {} : { limits: config.limits }),
    });
    return {
      vectorStore: stores.vectorStore,
      workingStore: stores.workingStore,
      close: () => stores.close(),
      updateResourceFile: (scope, name, update) => stores.updateResourceFile(scope, name, update),
      writeDerivedFile: (scope, name, body) => stores.writeDerivedFile(scope, name, body),
      reindex: (options: FabricReindexOptions): Promise<MarkdownReconcileCounts> =>
        options.full ? stores.rebuild({ signal: options.signal }) : stores.reconcile({ signal: options.signal }),
    };
  }
  if ("sqlite" in config.store) {
    const jail = createFabricFileJail(config.tools.root!);
    const path = await jail.resolve(config.store.sqlite.path);
    await mkdir(dirname(path), { recursive: true });
    await jail.resolve(path);
    const { createSqliteMemoryStores } = await import("@arnilo/prism-memory-core/sqlite");
    return createSqliteMemoryStores({ path });
  }
  const postgres = config.store.postgres;
  if (!postgres?.connection) {
    prism.status.note("warn", "memory-fabric: store.postgres needs a connection ref; no store registered");
    return undefined;
  }
  const secret: Secret | undefined = await prism.credentials.resolve(postgres.connection);
  if (!secret) {
    prism.status.note("warn", `memory-fabric: connection ref ${JSON.stringify(postgres.connection)} did not resolve`);
    return undefined;
  }
  const { createPostgresMemoryStores, createPostgresVectorStore } = await import("@arnilo/prism-memory-core/postgres");
  const stores = await createPostgresMemoryStores({
    connectionString: secret.value,
    ...(postgres.schema === undefined ? {} : { schema: postgres.schema }),
    ...(config.limits?.maxWorkingMemoryBytes === undefined ? {} : { maxWorkingMemoryBytes: config.limits.maxWorkingMemoryBytes }),
  });
  // Preserve the existing custom vector table while sharing the durable working store and pool.
  if (postgres.table) {
    try {
      const vectorStore = await createPostgresVectorStore({ pool: stores.pool, schema: stores.schema, table: postgres.table });
      return { ...stores, vectorStore };
    } catch (error) {
      await stores.close();
      throw error;
    }
  }
  return stores;
}

/** The scoped read policy as the `memory.recall` implementation. */
function scopedRecall(
  config: ResolvedMemoryFabricConfig,
  memory: Memory,
  fabric: MemoryFabric,
  clock: () => number,
  note: (ignored: number) => void,
): (query: string, options?: MemoryFabricRecallOptions) => Promise<MemoryFabricRecallResult> {
  const policy = createScopedMemoryPolicy({
    memory,
    fabric,
    scopeRoot: config.scoped?.scopeRoot as string,
    ...(config.scoped?.policy === undefined ? {} : { policy: config.scoped.policy }),
    // Archive proposals use the lifecycle's own rule and the scope clock the fabric already ticks.
    clock,
    archive: config.lifecycle.archive,
    onLegacyLedger: note,
  });
  return async (query, options) => {
    const result = await policy.recall(query, options);
    return { hits: result.hits, explain: result.explain };
  };
}

/** What `memory:reindex` needs from the markdown store, structurally the store's reconcile report. */
interface MarkdownReconcileCounts {
  readonly indexed: number;
  readonly removed: number;
  readonly malformed: number;
  readonly complete: boolean;
}

interface FabricReindexOptions {
  readonly full?: boolean;
  readonly signal?: AbortSignal;
}

/** The markdown store's `reconcile`/`rebuild`, or undefined for a store that keeps its own index. */
type FabricReindex = (options: FabricReindexOptions) => Promise<MarkdownReconcileCounts>;

function createMemoryReindexCommand(reindex: FabricReindex | undefined): PackageCommand {
  const args: JsonSchema = { type: "object", additionalProperties: false, properties: { full: { type: "boolean" } } };
  return {
    name: "memory:reindex",
    description:
      "Reindex the markdown memory store from its files; pass full to re-read every note. Reports indexed, removed, and malformed counts.",
    args,
    async run(rawArgs: JsonObject): Promise<JsonObject> {
      if (!reindex) {
        return {
          ok: false,
          reason: "no_file_index",
          text: "This store keeps its own index; memory:reindex applies to the markdown store (the default when tools.root is set).",
        };
      }
      const report = await reindex({ full: rawArgs.full === true });
      return {
        ok: true,
        ...report,
        text: `Reindexed ${report.indexed} note(s), removed ${report.removed}, ${report.malformed} malformed${report.complete ? "" : " (partial pass; run memory:reindex again to continue)"}.`,
      };
    },
  };
}

/** What `memory:export` and `memory:import` need: the memory, its stores, and the jail root (both refuse without one). */
interface OkfBundleDeps {
  readonly memory: Memory;
  readonly stores: { readonly vectorStore: VectorStore; readonly workingStore: WorkingMemoryStore };
  readonly embedder: Embedder | undefined;
  readonly root: string | undefined;
  /** The live markdown tree, which a bundle must not overlap. */
  readonly notesDir: string | undefined;
  readonly refresh: () => void;
}

/** Resolves a bundle directory inside `tools.root`, or says why not. */
async function resolveBundleDir(deps: OkfBundleDeps, raw: unknown): Promise<{ dir: string } | { reason: string; text: string }> {
  if (!deps.root) return { reason: "no_root", text: "OKF export and import need tools.root; the bundle directory resolves inside it." };
  if (typeof raw !== "string" || raw.trim().length === 0)
    return { reason: "bad_dir", text: "dir must be a non-empty path inside tools.root." };
  let dir: string;
  try {
    dir = await createFabricFileJail(deps.root).resolve(raw);
  } catch (error) {
    return { reason: "outside_root", text: error instanceof Error ? error.message : "dir is outside tools.root." };
  }
  const notes = deps.notesDir;
  if (notes !== undefined && (dir === notes || dir.startsWith(notes + sep) || notes.startsWith(dir + sep))) {
    return { reason: "overlaps_store", text: "dir must not overlap the live notes directory." };
  }
  return { dir };
}

function createMemoryExportCommand(deps: OkfBundleDeps): PackageCommand {
  const args: JsonSchema = { type: "object", additionalProperties: false, required: ["dir"], properties: { dir: { type: "string" } } };
  return {
    name: "memory:export",
    description:
      "Export this memory's notes, working memory, and tombstones to an OKF markdown bundle inside tools.root. Embeddings are not written.",
    args,
    async run(rawArgs: JsonObject): Promise<JsonObject> {
      const target = await resolveBundleDir(deps, rawArgs.dir);
      if ("reason" in target) return { ok: false, ...target };
      const result = await exportMemoryOkf(deps.memory, { dir: target.dir, stores: deps.stores });
      return { ok: true, ...result, text: `Exported ${result.notes} note(s) and ${result.invalidations} tombstone(s).` };
    },
  };
}

function createMemoryImportCommand(deps: OkfBundleDeps): PackageCommand {
  const args: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["dir"],
    properties: { dir: { type: "string" }, mode: { enum: ["merge", "replace"] } },
  };
  return {
    name: "memory:import",
    description:
      "Import an OKF markdown bundle from tools.root (mode merge or replace; default merge). Imported notes are marked import and trust-scanned; legal holds survive.",
    args,
    async run(rawArgs: JsonObject): Promise<JsonObject> {
      const target = await resolveBundleDir(deps, rawArgs.dir);
      if ("reason" in target) return { ok: false, ...target };
      const result = await importMemoryOkf(deps.memory, {
        dir: target.dir,
        stores: deps.stores,
        mode: rawArgs.mode === "replace" ? "replace" : "merge",
        ...(deps.embedder === undefined || deps.embedder.available?.() === false ? {} : { embedder: deps.embedder }),
      });
      deps.refresh();
      return {
        ok: true,
        ...result,
        text: `Imported ${result.imported} note(s) (${result.flagged} flagged as candidates), removed ${result.removed}, ${result.held} held.`,
      };
    },
  };
}

/** Whether a persisted assistant message is the one the event reported (id-less providers fall back here). */
function messageTextMatches(
  message: NonNullable<Awaited<ReturnType<SessionContext["entries"]>>[number]["message"]>,
  text: string,
): boolean {
  return (
    message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim() === text
  );
}

/** The exchange archive's per-session state: where the back-fill stopped, and how much it wrote. */
function readExchangeState(raw: JsonObject | undefined): { readonly cursor?: string; readonly archived: number } {
  const cursor = typeof raw?.cursor === "string" && raw.cursor.length > 0 ? raw.cursor : undefined;
  const archived = typeof raw?.archived === "number" && Number.isSafeInteger(raw.archived) ? raw.archived : 0;
  return { ...(cursor === undefined ? {} : { cursor }), archived };
}

function createMemoryArchiveCommand(
  archive: ExchangeArchive | undefined,
  state: SessionState<JsonObject>,
  note: (message: string) => void,
): PackageCommand {
  const args: JsonSchema = { type: "object", additionalProperties: false, properties: {} };
  return {
    name: "memory:archive",
    description:
      "Back-fill every completed exchange of this session into the exchange archive: one verbatim note per user turn plus the assistant reply that followed it, skipping tool rounds. Idempotent; reports archived, skipped and parts.",
    args,
    async run(_args: JsonObject, context: PackageCommandContext): Promise<JsonObject> {
      if (archive === undefined) {
        return { ok: false, reason: "disabled", text: "The exchange archive is off: set exchanges in the fabric config to enable it." };
      }
      const session = context.session;
      if (!session) return { ok: false, reason: "no_session", text: "memory:archive needs a session: run it against one." };
      const before = readExchangeState(state.get(session));
      const report = await archive.entries(await session.entries(), {
        sessionId: session.id,
        ...(before.cursor === undefined ? {} : { cursor: before.cursor }),
      });
      if (report.cursor !== undefined && (report.archived > 0 || report.cursor !== before.cursor)) {
        await state.set(session, {
          ...(report.cursor === undefined ? {} : { cursor: report.cursor }),
          archived: before.archived + report.archived,
        });
      }
      const refused = report.refused.trust + report.refused.secret;
      if (refused > 0) note(`memory-fabric: ${refused} exchange(s) refused by the trust scan or redactor; not archived`);
      return {
        ok: true,
        ...report,
        // This session's total, including the turns the background hook archived before this back-fill.
        totalArchived: before.archived + report.archived,
        text: `Archived ${report.archived} exchange(s) as ${report.parts} note(s); ${report.skipped} skipped (already archived, a tool round, or refused)${refused > 0 ? `; ${refused} refused` : ""}.`,
      };
    },
  };
}

function createMemoryConsolidateCommand(fabric: MemoryFabric, promoteState: SessionState<JsonObject>): PackageCommand {
  const args: JsonSchema = { type: "object", additionalProperties: false, properties: {} };
  return {
    name: "memory:consolidate",
    description:
      "Run one consolidation pass now over the session tail (one extractor call; no-op when promote is off). The host calls it before session.close().",
    args,
    async run(_args: JsonObject, context: PackageCommandContext): Promise<JsonObject> {
      const session = context.session;
      if (!session) return { ok: false, reason: "no_session", text: "memory:consolidate needs a session: run it against one." };
      const state = readPromoteState(promoteState.get(session));
      try {
        const result = await fabric.consolidate(session, {
          ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
        });
        if (result.report === undefined || !result.ran) {
          // A failed extraction also records its report, so the failure is visible to `memory:status`.
          if (result.reason === "failed" && result.report !== undefined)
            await promoteState.set(session, {
              ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
              last: result.report as unknown as JsonObject,
              refused: state.refused,
            });
          return {
            ok: false,
            reason: result.reason === "failed" ? "extraction_failed" : (result.reason ?? "empty"),
            ...(result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode }),
            ...(result.report === undefined ? {} : { failures: result.report.failures ?? {}, modelCalls: result.report.modelCalls }),
            text:
              result.reason === "disabled"
                ? "Consolidation is off: set promote in the fabric config to enable it."
                : result.reason === "failed"
                  ? `Consolidation failed (${result.reasonCode ?? "model_call_failed"}); nothing was written and the material is kept for the next pass.`
                  : "Nothing new to consolidate in this session.",
          };
        }
        const report = result.report;
        await promoteState.set(session, {
          ...(result.cursor === undefined ? (state.cursor === undefined ? {} : { cursor: state.cursor }) : { cursor: result.cursor }),
          last: report as unknown as JsonObject,
          refused: state.refused,
        });
        return {
          ok: true,
          ...report,
          text: `Consolidated ${report.candidates} candidate(s): ${report.accepted} accepted, ${report.written} written, ${report.updated} updated, ${report.exceptions} exception(s), ${report.retired} retired, ${report.modelCalls} model call(s)${report.correctionCalls ? ` (${report.correctionCalls} correction)` : ""}.`,
        };
      } catch (error) {
        return {
          ok: false,
          reason: "extraction_failed",
          ...(error instanceof ConsolidationExtractionError
            ? { reasonCode: error.reasonCode, modelCalls: error.modelCalls, corrections: error.correctionCalls }
            : {}),
          text: error instanceof Error ? error.message : "consolidation failed",
        };
      }
    },
  };
}

/** The failed pass's reason and output limit, so `memory:status` does not drop them. */
function failureText(report: import("./promote.js").FabricConsolidationReport): string {
  const reasons = Object.entries(report.failures ?? {})
    .map(([code, count]) => `${code} ${count}`)
    .join(", ");
  if (reasons.length === 0 && (report.outputLimited ?? 0) === 0) return "";
  return ` Failed extraction: ${reasons || "none"}${report.outputLimited === undefined ? "" : `; ${report.outputLimited} call(s) stopped on the output limit`}.`;
}

function createMemoryMaintainCommand(fabric: MemoryFabric): PackageCommand {
  const args: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: { scope: { type: "string", minLength: 1 } },
  };
  return {
    name: "memory:maintain",
    description:
      "Run one lifecycle maintenance pass: archive, capacity, scope widening and narrowing. Pass scope to maintain one resource only (that pass skips widening). Reports counts.",
    args,
    async run(rawArgs: JsonObject): Promise<JsonObject> {
      try {
        const report = await fabric.maintain({ ...(typeof rawArgs.scope === "string" ? { scope: rawArgs.scope } : {}) });
        return {
          ok: true,
          ...report,
          overBudget: report.overBudget.map((scope) => ({ ...scope })),
          text: `Maintained memory: archived ${report.archived}, merged ${report.merged}, ${report.episodesMerged} episode cluster(s), evicted ${report.evicted}, widened ${report.widened}, superseded ${report.superseded}${report.overBudget.length === 0 ? "" : `; ${report.overBudget.length} scope(s) still over budget`}.`,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: reason.startsWith("maintenance requires") ? "no_scan" : "failed", text: reason };
      }
    },
  };
}

function createMemoryStatusCommand(lifecycle: FabricLifecycle, promoteState: SessionState<JsonObject>, team?: FabricTeam): PackageCommand {
  const args: JsonSchema = { type: "object", additionalProperties: false, properties: {} };
  return {
    name: "memory:status",
    description: "Count fabric notes by lifecycle status and reflections refused by the trust scan.",
    args,
    async run(_args: JsonObject, context: PackageCommandContext): Promise<JsonObject> {
      const counts = await lifecycle.census();
      const teamCounts = team === undefined ? undefined : await team.census();
      const state = context.session ? readPromoteState(promoteState.get(context.session)) : undefined;
      const refused = state?.refused ?? 0;
      const last = state?.last;
      const teamText =
        teamCounts === undefined
          ? ""
          : ` Team store: ${teamCounts.verified} verified, ${teamCounts.candidate} candidate${teamCounts.archived ? `, ${teamCounts.archived} archived` : ""}${teamCounts.quarantined ? ` (${teamCounts.quarantined} quarantined)` : ""}.`;
      return {
        ok: true,
        ...counts,
        refused,
        ...(teamCounts === undefined ? {} : { team: { ...teamCounts } }),
        ...(last === undefined ? {} : { last: last as unknown as JsonObject }),
        text: `Fabric notes: ${counts.candidate} candidate, ${counts.verified} verified, ${counts.archived} archived${counts.reconsolidate ? `, ${counts.reconsolidate} reconsolidate` : ""}; ${refused} note(s) refused.${teamText}${last === undefined ? "" : ` Last pass: ${last.candidates} candidate(s), ${last.accepted} accepted, ${last.written} written, ${last.updated} updated, ${last.exceptions} exception(s), ${last.retired} retired, ${last.modelCalls} model call(s); rejected score ${last.rejected.score}, ephemeral ${last.rejected.ephemeral}, derivable ${last.rejected.derivable}, trust ${last.rejected.trust}, secret ${last.rejected.secret}.${failureText(last)}`}`,
      };
    },
  };
}

/**
 * `memory:share` (plan 188.5 Task 3): move one verified private project note into the team store. The
 * person sees the note and the target path through `host.ui` first; a host with no UI fails closed.
 */
function createMemoryShareCommand(team: FabricTeam, source: Memory, ui: () => PackageAPI["host"]["ui"]): PackageCommand {
  const args: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", pattern: "^[0-9a-f]{12}$" } },
  };
  return {
    name: "memory:share",
    description:
      "Share one verified project note into the checked-in team store (team.dir). Shows the note and the target path for approval first; the commit stays yours.",
    args,
    async run(raw: JsonObject, _context: PackageCommandContext): Promise<JsonObject> {
      const approve = async (request: { title: string; detail: string }): Promise<FabricTeamApproval> => {
        const host = ui();
        if (!host) return "unavailable";
        try {
          const answer = await host.request({ kind: "confirm", title: request.title, detail: request.detail });
          if (answer.status === "answered") return answer.value ? "approved" : "denied";
          return answer.status === "unavailable" ? "unavailable" : "denied";
        } catch {
          return "unavailable";
        }
      };
      const result = await team.share({ id: raw.id as string, source, approve });
      return result.ok
        ? { ...result, text: `Shared note ${result.id} into the team store at ${result.path}. Review and commit it yourself.` }
        : { ...result, text: result.text };
    },
  };
}

/**
 * `memory:lifecycle` (plan 188.4 Further Action 4): one line per note — S, R, use log size, and the
 * archive and widening gates that refused it. `memory:status` counts; this explains.
 */
function createMemoryLifecycleCommand(options: {
  readonly memories: readonly Memory[];
  readonly store?: VectorStore;
  readonly clock?: () => number;
  readonly lifecycle?: ResolvedLifecycleConfig;
}): PackageCommand {
  const args: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", pattern: "^[0-9a-f]{12}$" },
      key: { type: "string", minLength: 1, maxLength: 64 },
      includeArchived: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  };
  const SCAN_PAGE = 500;
  return {
    name: "memory:lifecycle",
    description: "Explain one note's lifecycle: storage and retrieval strength, use log, archive and widening gates.",
    args,
    async run(raw: JsonObject, _context: PackageCommandContext): Promise<JsonObject> {
      const scanMetadata = options.store?.scanMetadata;
      if (scanMetadata === undefined) {
        return { ok: false, reason: "no_scan", text: "memory:lifecycle needs a store with scanMetadata." };
      }
      const id = typeof raw.id === "string" ? raw.id : undefined;
      const key = typeof raw.key === "string" ? raw.key : undefined;
      const includeArchived = raw.includeArchived === true;
      const limit = typeof raw.limit === "number" && Number.isSafeInteger(raw.limit) && raw.limit > 0 ? Math.min(raw.limit, 100) : 20;
      const views: ReturnType<typeof inspectNote>[] = [];
      for (const memory of options.memories) {
        const counter = options.store?.scopeCounter;
        let clock = options.clock?.() ?? 0;
        if (counter !== undefined) {
          const value = await counter.get({
            tenantId: memory.scope.tenantId,
            resourceId: memory.scope.resourceId,
            name: SCOPE_CLOCK_COUNTER,
          });
          if (Number.isSafeInteger(value) && value >= 0) clock = value;
        }
        let cursor: string | undefined;
        do {
          const page = await scanMetadata({
            scope: { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId },
            limit: SCAN_PAGE,
            ...(cursor === undefined ? {} : { cursor }),
          });
          for (const row of page.rows) {
            const metadata = parseMemoryNoteMetadata(row.metadata);
            if (metadata === undefined) continue;
            const status = normalizeNoteStatus(row.metadata?.status as string | undefined, "verified");
            if (!includeArchived && status === "archived") continue;
            if (id !== undefined && row.id !== id) continue;
            if (key !== undefined && metadata.key !== key) continue;
            views.push(
              inspectNote({
                id: row.id,
                metadata,
                status,
                clock,
                ...(options.lifecycle === undefined
                  ? {}
                  : {
                      archive: options.lifecycle.archive,
                      decay: options.lifecycle.decay,
                      storageWeights: options.lifecycle.storageWeights,
                    }),
              }),
            );
          }
          cursor = page.nextCursor;
        } while (cursor !== undefined);
      }
      views.sort((left, right) => right.retrieval - left.retrieval || right.storage - left.storage || (left.id < right.id ? -1 : 1));
      const total = views.length;
      const shown = views.slice(0, limit);
      const header = total === 0 ? "No note matches." : `${shown.length} of ${total} note(s), most retrievable first:`;
      return {
        ok: true,
        total,
        notes: shown as unknown as JsonObject[],
        text: [header, ...shown.map((view) => describeNote(view))].join("\n"),
      };
    },
  };
}

function createMemoryCommand(enabled: SessionState<boolean>): PackageCommand {
  const args: JsonSchema = { type: "object", additionalProperties: false, properties: {} };
  return {
    name: "memory",
    description: "Toggle fabric memory for this session.",
    args,
    async run(_args: JsonObject, context: PackageCommandContext): Promise<JsonObject> {
      const session = context.session;
      if (!session) return { ok: false, reason: "no_session", text: "memory needs a session: run it against one." };
      const next = !enabled.get(session);
      await enabled.set(session, next);
      return { ok: true, enabled: next, text: `Fabric memory ${next ? "on" : "off"} for this session.` };
    },
  };
}
