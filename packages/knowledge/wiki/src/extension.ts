import { join, resolve } from "node:path";
import { definePackage, type JsonObject, type ModelClient, type PackageAPI, type PackageInstance } from "@arnilo/prism";
import { MemoryValidationError, type MemoryWorkerLimitOptions, resolveMemoryWorkerLimits } from "@arnilo/prism-memory-system/core";
import type { WebFetchService } from "@arnilo/prism-tools/web";
import manifest from "../../package.json" with { type: "json" };
import { createWikiConsolidateCommand } from "./commands/consolidate.js";
import { createWikiIngestCommand } from "./commands/ingest.js";
import { createWikiLintCommand } from "./commands/lint.js";
import { createWikiStatusCommand } from "./commands/status.js";
import { createCurator, reportJson } from "./consolidate/curator.js";
import type { WikiPassReport } from "./consolidate/pass.js";
import { WIKI_TRIGGERS, type WikiTrigger } from "./consolidate/triggers.js";
import { createWikiPointer, WIKI_CONTEXT_HOOK_ID } from "./context.js";
import { MAX_BIND_THRESHOLD } from "./ontology/bind.js";
import { type LtmPort, MEMORY_LTM_SERVICE } from "./ontology/ltm.js";
import { createWikiOntology } from "./ontology/port.js";
import { DEFAULT_MAX_CLAIMS_RENDERED, MAX_CLAIMS_RENDERED_LIMIT, resolveMaxClaimsRendered } from "./ontology/render.js";
import { createMarkdownWikiStore, createMemoryWikiStore } from "./store.js";
import { createWikiIngestTool } from "./tools/ingest.js";
import { createWikiReadTool, createWikiSearchTool } from "./tools/knowledge.js";
import type { WikiExtensionOptions, WikiIngestFetch, WikiIngestUrlHookInput } from "./types.js";

/** The `web.fetch` service the wiki consumes for `url` ingest. The wiki never fetches on its own. */
const WEB_FETCH_SERVICE = "web.fetch";

/** Concept-pass tuning. `model` is a model ref, never a secret. */
export interface WikiConsolidateConfig {
  /** Model for the concept pass. Defaults to the agent's configured model. */
  readonly model?: string;
  /** A bound subject with this many unconsolidated notes, or this many unbound notes sharing a keyword, is due. Default 5. */
  readonly minNotes?: number;
  /** Notes read and used together in this many answering turns are due (read-time consolidation). Default 2. */
  readonly minCoReads?: number;
  /** Which policies start a pass. Default all three. `repair` cannot be removed. */
  readonly triggers?: readonly WikiTrigger[];
  /** Check for due work at most once per this many completed turns. Default 5. */
  readonly minIntervalTurns?: number;
  /** Subjects consolidated per pass. Default 8. */
  readonly maxSubjectsPerPass?: number;
  /** Claims a concept may hold after an edit. Default 40. */
  readonly maxClaimsPerConcept?: number;
  /** Output token cap for one concept call. */
  readonly maxOutputTokens?: number;
  /** The memory worker-loop limits (`@arnilo/prism-memory-system/core`), same shape and hard caps. */
  readonly workerLimits?: MemoryWorkerLimitOptions;
}

/** Source-ingest caps. Both can only be lowered: the defaults are the hard caps. */
export interface WikiIngestConfig {
  readonly maxInputBytes?: number;
  readonly maxExtractBytes?: number;
}

/** `wiki.search` tuning. */
export interface WikiSearchConfig {
  /** Claims one concept hit shows, chosen by term overlap with the query. Default 8, in [1,32]. */
  readonly maxClaimsRendered?: number;
}

/** JSON config for `@arnilo/prism-knowledge/wiki`; `setup` applies the defaults below. */
export interface WikiConfig {
  /** Where the wiki keeps its store and stages sources. Default `<workspaceRoot>/.prism/wiki`. */
  readonly root?: string;
  /** `markdown` (default) under `root`, or `memory` for a wiki that lives one process. */
  readonly store?: "markdown" | "memory";
  readonly consolidate?: WikiConsolidateConfig;
  readonly ingest?: WikiIngestConfig;
  readonly search?: WikiSearchConfig;
  /** Matched tokens of one subject name that bind evidence to that subject. Default 2, in [1,8]. */
  readonly bindThreshold?: number;
  /** Add the passive concept pointer to `context.build`. Default true. */
  readonly pointer?: boolean;
  /** Workspace root for `path` ingest sources. Defaults to the process working directory. */
  readonly workspaceRoot?: string;
}

/** {@link WikiConfig} with every default applied, so `setup` reads one shape. */
interface ResolvedWikiConfig {
  readonly consolidate: {
    readonly model?: string;
    readonly minNotes: number;
    readonly minCoReads: number;
    readonly triggers?: readonly WikiTrigger[];
    readonly minIntervalTurns: number;
    readonly maxSubjectsPerPass: number;
    readonly maxClaimsPerConcept: number;
    readonly maxOutputTokens?: number;
    readonly workerLimits?: MemoryWorkerLimitOptions;
  };
  readonly ingest: WikiIngestConfig;
  readonly workspaceRoot: string;
  readonly root: string;
  readonly store: "markdown" | "memory";
  readonly maxClaimsRendered: number;
  readonly bindThreshold?: number;
  readonly pointer: boolean;
}

const WIKI_MAX_INPUT_BYTES = 32 * 1024 * 1024;
const WIKI_MAX_EXTRACT_BYTES = 2 * 1024 * 1024;

function resolveWikiConfig(config: WikiConfig | undefined, workspaceRoot: string): ResolvedWikiConfig {
  const consolidate = config?.consolidate;
  return {
    consolidate: {
      ...(consolidate?.model === undefined ? {} : { model: consolidate.model }),
      minNotes: consolidate?.minNotes ?? 5,
      minCoReads: consolidate?.minCoReads ?? 2,
      ...(consolidate?.triggers === undefined ? {} : { triggers: consolidate.triggers }),
      minIntervalTurns: consolidate?.minIntervalTurns ?? 5,
      maxSubjectsPerPass: consolidate?.maxSubjectsPerPass ?? 8,
      maxClaimsPerConcept: consolidate?.maxClaimsPerConcept ?? 40,
      ...(consolidate?.maxOutputTokens === undefined ? {} : { maxOutputTokens: consolidate.maxOutputTokens }),
      ...(consolidate?.workerLimits === undefined ? {} : { workerLimits: consolidate.workerLimits }),
    },
    ingest: config?.ingest ?? {},
    workspaceRoot: config?.workspaceRoot ?? workspaceRoot,
    root: resolve(config?.root ?? join(config?.workspaceRoot ?? workspaceRoot, ".prism", "wiki")),
    store: config?.store ?? "markdown",
    maxClaimsRendered: resolveMaxClaimsRendered(config?.search?.maxClaimsRendered),
    ...(config?.bindThreshold === undefined ? {} : { bindThreshold: config.bindThreshold }),
    pointer: config?.pointer ?? true,
  };
}

/**
 * Maps the `web.fetch` service onto the wiki's fetch seam.
 *
 * The service is resolved per call: a package that provides `web.fetch` may load after this one, so a
 * setup-time lookup would miss it. A missing service fails the `url` ingest closed with a named error.
 */
function createWebFetchHook(prism: PackageAPI<WikiConfig>): (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null> {
  return async ({ url }) => {
    const service = prism.services.consume<WebFetchService>(WEB_FETCH_SERVICE);
    if (!service) {
      throw new MemoryValidationError(
        `ingest url requires the ${WEB_FETCH_SERVICE} service — no loaded package provides it, and the wiki package never fetches itself`,
      );
    }
    const document = await service.fetch(url);
    return { text: document.markdown, filename: filenameFromUrl(url) };
  };
}

/** Staged filename for a fetched URL: the pathname's extension wins (`doc.pdf`), else `source.md`. */
function filenameFromUrl(url: string): string | undefined {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return base && /\.[A-Za-z0-9]+$/.test(base) ? base.slice(0, 128) : undefined;
  } catch {
    return undefined;
  }
}

export const definition = definePackage<WikiConfig>({
  name: "@arnilo/prism-knowledge/wiki",
  version: manifest.version,
  description:
    "The wiki: concepts, claims and sources in their own store, consolidated from cited evidence; reads memory read-only when installed.",
  // No required service: the wiki runs on its own sources. Long-term memory, when installed, is read through the
  // read-only `memory.ltm` service, resolved per call so the order of the packages does not matter.
  requires: { api: 1 },
  capabilities: ["models", "background", "session-state"],
  config: {
    type: "object",
    additionalProperties: false,
    properties: {
      root: { type: "string", minLength: 1 },
      store: { type: "string", enum: ["markdown", "memory"], default: "markdown" },
      search: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxClaimsRendered: { type: "integer", minimum: 1, maximum: MAX_CLAIMS_RENDERED_LIMIT, default: DEFAULT_MAX_CLAIMS_RENDERED },
        },
      },
      bindThreshold: { type: "integer", minimum: 1, maximum: MAX_BIND_THRESHOLD },
      pointer: { type: "boolean", default: true },
      consolidate: {
        type: "object",
        additionalProperties: false,
        properties: {
          model: { type: "string", minLength: 1 },
          minNotes: { type: "integer", minimum: 1, maximum: 100, default: 5 },
          minCoReads: { type: "integer", minimum: 1, maximum: 20, default: 2 },
          triggers: { type: "array", items: { type: "string", enum: [...WIKI_TRIGGERS] }, maxItems: WIKI_TRIGGERS.length },
          minIntervalTurns: { type: "integer", minimum: 1, maximum: 1000, default: 5 },
          maxSubjectsPerPass: { type: "integer", minimum: 1, maximum: 32, default: 8 },
          maxClaimsPerConcept: { type: "integer", minimum: 1, maximum: 200, default: 40 },
          maxOutputTokens: { type: "integer", minimum: 256, maximum: 16384 },
          workerLimits: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              [
                "maxTurns",
                "maxToolCallsPerTurn",
                "maxToolCalls",
                "maxArgumentBytes",
                "maxResultBytes",
                "maxMessageBytes",
                "maxTaskStateBytes",
                "maxErrorBytes",
              ].map((name) => [name, { type: "integer", minimum: 1 }]),
            ),
          },
        },
      },
      ingest: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxInputBytes: { type: "integer", minimum: 1, maximum: WIKI_MAX_INPUT_BYTES },
          maxExtractBytes: { type: "integer", minimum: 1, maximum: WIKI_MAX_EXTRACT_BYTES },
        },
      },
      workspaceRoot: { type: "string" },
    },
  },
  setup(prism) {
    const config = resolveWikiConfig(prism.config, process.cwd());
    // The wiki's own store. Long-term memory is resolved per call: it may be listed after this package, or absent.
    const store = config.store === "memory" ? createMemoryWikiStore() : createMarkdownWikiStore({ root: config.root });
    const ontology = createWikiOntology({
      store,
      ltm: () => prism.services.consume<LtmPort>(MEMORY_LTM_SERVICE),
      ...(config.store === "markdown" ? { sourceRoot: config.root } : {}),
      ...(config.bindThreshold === undefined ? {} : { bindThreshold: config.bindThreshold }),
    });
    const port = () => ontology;

    const bound: WikiExtensionOptions = {
      workspaceRoot: config.workspaceRoot,
      ...config.ingest,
      port,
      fetchUrl: createWebFetchHook(prism),
    };
    const limits = resolveMemoryWorkerLimits(config.consolidate.workerLimits);
    const last = prism.state.session<JsonObject>("wiki.last", {});
    const curator = createCurator({
      port,
      client: () => withOutputBudget(prism, config.consolidate.model, config.consolidate.maxOutputTokens),
      config: {
        minNotes: config.consolidate.minNotes,
        minCoReads: config.consolidate.minCoReads,
        maxSubjectsPerPass: config.consolidate.maxSubjectsPerPass,
        maxClaimsPerConcept: config.consolidate.maxClaimsPerConcept,
        minIntervalTurns: config.consolidate.minIntervalTurns,
        ...(config.consolidate.triggers === undefined ? {} : { triggers: config.consolidate.triggers }),
        limits,
      },
      onError: (error) => prism.status.note("warn", `wiki: concept pass failed: ${error instanceof Error ? error.name : "error"}`),
      async onPass(report, session) {
        if (report.rejected.trust > 0)
          prism.status.note("warn", `wiki: ${report.rejected.trust} concept edit(s) refused by the trust scan`);
        prism.events.emit("wiki.consolidated", reportJson(report));
        if (session !== undefined) await last.set(session, reportJson(report));
      },
    });
    prism.tools.register(createWikiIngestTool(bound));
    prism.tools.register(createWikiSearchTool({ port, maxClaimsRendered: config.maxClaimsRendered }));
    prism.tools.register(createWikiReadTool({ port, maxClaimsRendered: config.maxClaimsRendered }));
    prism.commands.register(
      createWikiStatusCommand(port, (session) => {
        const live = curator.last();
        if (live !== undefined || session === undefined) return live;
        // A restored session: the last pass its branch recorded. Display only, so an unreadable value is no value.
        try {
          const saved = last.get(session);
          return typeof saved.at === "string" && typeof saved.modelCalls === "number" ? (saved as unknown as WikiPassReport) : undefined;
        } catch {
          return undefined;
        }
      }),
    );
    prism.commands.register(createWikiConsolidateCommand(curator));
    prism.commands.register(
      createWikiLintCommand(port, { maxClaimsPerConcept: config.consolidate.maxClaimsPerConcept, passStarts: curator.passStarts }),
    );
    prism.commands.register(createWikiIngestCommand(bound));
    // Checked when a session opens and every `minIntervalTurns` turns, in the background; a quiet check makes no model call.
    prism.hooks.on("session.opened", (_event, context) => {
      if (context.session) curator.opened(context.session);
    });
    prism.hooks.on("turn.completed", (_event, context) => {
      if (context.session) curator.turn(context.session);
    });
    const pointer = createWikiPointer({ port, root: resolve(config.workspaceRoot) });
    prism.hooks.on("session.closed", (_event, context) => {
      curator.closed(context.sessionId);
      pointer.forget(context.sessionId);
    });
    if (config.pointer) {
      prism.hooks.on("context.build", (draft, context) => pointer.build(draft, context), { id: WIKI_CONTEXT_HOOK_ID, priority: -1_200 });
      prism.hooks.on("tool.started", (event, context) => {
        pointer.touched(context.sessionId, { name: event.call.name, arguments: event.call.arguments as Record<string, unknown> });
      });
    }
    if (prism.services.consume<WebFetchService>(WEB_FETCH_SERVICE) === undefined) {
      prism.status.note("warn", `wiki: no ${WEB_FETCH_SERVICE} service; wiki_ingest url inputs fail closed until one is provided`);
    }
  },
});

/**
 * The curator's model, with `parameters.maxTokens` when the host set an output budget, capped by the model's own
 * limit (the rule memory's extractor and compaction use). No budget means the host's client, untouched.
 */
function withOutputBudget(prism: PackageAPI<WikiConfig>, ref: string | undefined, maxTokens: number | undefined): ModelClient {
  const base = prism.models.client(ref);
  if (maxTokens === undefined) return base;
  const declared = base.model.limits?.maxOutputTokens;
  const cap = Number.isSafeInteger(declared) && (declared as number) > 0 ? Math.min(maxTokens, declared as number) : maxTokens;
  return prism.models.client({ ...base.model, parameters: { ...base.model.parameters, maxTokens: cap } });
}

/** The package with config baked in, for `packages: [wiki({ root: "./wiki", consolidate: { model } })]`. */
export function wiki(config?: WikiConfig): PackageInstance {
  return definition(config);
}
