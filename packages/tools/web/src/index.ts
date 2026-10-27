/**
 * `@arnilo/prism-tools-web` — the first-party web search and fetch tools as a package.
 *
 * The default export registers `web_search`, `web_fetch`, and (through the named `createWebTools`
 * factory) `web_extract`, each declaring `effects: ["network"]`. The backend is selected by config:
 *
 * - `brave` / `exa`: a search key (ref-only) plus a fetch backend (`native` by default, or Firecrawl).
 * - `firecrawl`: fetch and extract only.
 * - `native`: keyless fetch only, on the kernel's DNS-pinned request with a host-side redirect loop.
 * - `obscura`: a host-installed binary; no key.
 *
 * A missing key ref or a missing Obscura binary registers nothing and writes a `warn` status note.
 * When a fetch backend is configured the package also provides the `web.fetch` service.
 *
 * The 0.12 factory names (`createBraveSearch`, `createExaSearch`, `createFirecrawlFetch`,
 * `createFirecrawlExtractor`, `createWebTools`, `createObscuraWebTools`, `connectObscuraCdp`,
 * `createObscuraMcpTools`) stay exported for hosts that build tool lists by hand.
 *
 * ```ts
 * import toolsWeb from "@arnilo/prism-tools-web";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [toolsWeb({ backend: "brave", apiKey: "env:BRAVE_API_KEY", fetch: { backend: "firecrawl", apiKey: "env:FIRECRAWL_API_KEY" } })],
 * });
 * ```
 */
import manifest from "../package.json" with { type: "json" };
import {
  assertSsrfAllowedUrl,
  definePackage,
  type JsonObject,
  type JsonSchema,
  type PackageInstance,
  type Secret,
  type ToolDefinition,
  type ToolArgumentValidator,
  validateJsonSchema,
} from "@arnilo/prism";

import { createBraveSearch } from "./brave.js";
import { createFetchCache, resolveFetchCache, withFetchCache } from "./cache.js";
import { createKagiSearch } from "./kagi.js";
import { createPromptFetch, DEFAULT_PROMPT_INPUT_CHARS, DEFAULT_PROMPT_OUTPUT_TOKENS, withOutputBudget } from "./prompt-fetch.js";
import { createSearxngSearch } from "./searxng.js";
import { createTavilySearch } from "./tavily.js";
import { createDomainPolicy, type DomainPolicy } from "./domains.js";
import { type ToolsWebConfig, toolsWebConfigSchema } from "./config.js";
import { createExaSearch } from "./exa.js";
import { createFirecrawlExtractor, createFirecrawlFetch } from "./firecrawl.js";
import { createNativeFetch } from "./native/fetch.js";
import { OBSCURA_GUARDED_VERSION, probeObscuraVersion } from "./obscura/cli.js";
import { resolveObscuraCommand } from "./obscura/process.js";
import { resolveObscuraWebLimits } from "./obscura/limits.js";
import { createObscuraPageFetcher, createObscuraWebTools } from "./obscura/web.js";
import { createWebTools } from "./tools.js";
import { resolveWebLimits } from "./limits.js";
import type { PromptFetch, WebCredentialSource, WebFetchAdapter, WebFetchService, WebSearchAdapter } from "./types.js";

// The moved 0.12 surface keeps its names, now behind one entry point.
export * from "./brave.js";
export * from "./cache.js";
export * from "./prompt-fetch.js";
export * from "./searxng.js";
export * from "./tavily.js";
export * from "./kagi.js";
export * from "./domains.js";
export * from "./exa.js";
export * from "./firecrawl.js";
export * from "./limits.js";
export * from "./native/fetch.js";
export * from "./normalize.js";
export * from "./obscura/index.js";
export * from "./tools.js";
export * from "./transport.js";
export * from "./types.js";
export type {
  ToolsWebBackend,
  ToolsWebCacheConfig,
  ToolsWebConfig,
  ToolsWebDomainsConfig,
  ToolsWebFetchConfig,
  ToolsWebObscuraConfig,
  ToolsWebPromptConfig,
  ToolsWebSearxngConfig,
} from "./config.js";
export { toolsWebConfigSchema } from "./config.js";
import type { ToolsWebBackend } from "./config.js";

const BACKENDS: readonly ToolsWebConfig["backend"][] = [
  "brave",
  "exa",
  "firecrawl",
  "native",
  "obscura",
  "searxng",
  "tavily",
  "kagi",
];
/** Identifies the package on every native fetch; config `fetch.userAgent` replaces it. */
const DEFAULT_USER_AGENT = `Prism-Web-Fetch/${manifest.version} (+https://github.com/ashiqrniloy/prism)`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One validator, no second implementation: the package validates extraction against the kernel's subset. */
const schemaValidator: ToolArgumentValidator = {
  validate: (schema, value) => validateJsonSchema(schema as JsonSchema, value),
};

/** Compiles the schema now, so an unsupported subset fails setup instead of the first extraction. */
function checkExtractSchema(schema: JsonObject): JsonObject {
  try {
    validateJsonSchema(schema as JsonSchema, {});
    return schema;
  } catch (error) {
    throw new Error(`prism-tools-web: extract.schema is not supported: ${errorMessage(error)}`);
  }
}

/** `web_extract` over the configured schema, or nothing when the config asks for no extraction. */
function extractAdapter(
  config: ToolsWebConfig["extract"],
  credentials: WebCredentialSource,
  limits: ReturnType<typeof resolveWebLimits>,
  validateUrl: (url: URL) => void,
) {
  if (config === undefined) return undefined;
  const schema = checkExtractSchema(config.schema);
  try {
    return createFirecrawlExtractor({ credentials, limits, validateUrl, schema, validator: schemaValidator });
  } catch (error) {
    throw new Error(`prism-tools-web: extract.schema is not supported: ${errorMessage(error)}`);
  }
}

/** `fetch.userAgent` over the package's own name, keyless: no credential source is involved. */
function nativeFetch(config: ToolsWebConfig, limits: ReturnType<typeof resolveWebLimits>, domains?: DomainPolicy): WebFetchAdapter {
  return createNativeFetch({
    userAgent: config.fetch?.userAgent ?? DEFAULT_USER_AGENT,
    limits,
    ...(domains === undefined ? {} : { domains }),
  });
}

/** The `web.fetch` service, with the host domain policy enforced before the adapter runs. */
function fetchService(fetch: WebFetchAdapter, domains: DomainPolicy | undefined): WebFetchService {
  return guardService({ fetch: (url, options) => fetch.fetch(url, options) }, domains);
}

/** Same guard for a service that is not built from a single adapter (Obscura's page fetcher). */
function guardService(service: WebFetchService, domains: DomainPolicy | undefined): WebFetchService {
  if (domains === undefined) return service;
  return {
    fetch: (url, options) => {
      domains.assert(url);
      return service.fetch(url, options);
    },
  };
}

/** A credential source over a single resolved secret, for the 0.12 adapters. */
function secretSource(secret: Secret): WebCredentialSource {
  return { resolve: () => secret };
}

const definition = definePackage<ToolsWebConfig>({
  name: "@arnilo/prism-tools-web",
  version: manifest.version,
  description: "Web search and fetch tools with declared network effects, ref-only keys, and a web.fetch service.",
  requires: { api: 1 },
  // `models` is declared statically (capabilities are not per-config); `models.client` is only called
  // when `fetch.prompt` is configured.
  capabilities: ["credentials", "models"],
  config: toolsWebConfigSchema,
  setup: async (prism) => {
    const backend = prism.config.backend;
    if (backend === undefined || !BACKENDS.includes(backend)) {
      throw new Error("prism-tools-web: config needs backend (one of brave, exa, firecrawl, native, obscura)");
    }

    let limits: ReturnType<typeof resolveWebLimits>;
    try {
      limits = resolveWebLimits(prism.config.limits);
    } catch (error) {
      throw new Error(`prism-tools-web: invalid limits config: ${errorMessage(error)}`);
    }

    let domains: DomainPolicy | undefined;
    if (prism.config.domains !== undefined) {
      try {
        domains = createDomainPolicy(prism.config.domains);
      } catch (error) {
        throw new Error(`prism-tools-web: invalid domains config: ${errorMessage(error)}`);
      }
    }

    // One cache for the whole package: `prism.state.agent` keeps it in process memory for the
    // agent's lifetime, and the session hook drops a closed session's pages.
    let cacheConfig: ReturnType<typeof resolveFetchCache>;
    try {
      cacheConfig = resolveFetchCache(prism.config.cache);
    } catch (error) {
      throw new Error(`prism-tools-web: invalid cache config: ${errorMessage(error)}`);
    }
    const cache = prism.state.agent("fetchCache", createFetchCache(cacheConfig)).get();
    prism.hooks.on("session.closed", (event) => cache.dropSession(event.sessionId));

    // Opt-in question answering: the host picks the model, so a bad ref is a warning, not a failed load.
    let prompt: PromptFetch | undefined;
    const promptConfig = prism.config.fetch?.prompt;
    if (promptConfig !== undefined) {
      const maxInputChars = promptConfig.maxInputChars ?? DEFAULT_PROMPT_INPUT_CHARS;
      const maxOutputTokens = promptConfig.maxOutputTokens ?? DEFAULT_PROMPT_OUTPUT_TOKENS;
      try {
        const resolved = prism.models.client(promptConfig.model).model;
        prompt = createPromptFetch(prism.models.client(withOutputBudget(resolved, maxOutputTokens)), { maxInputChars });
      } catch (error) {
        prism.status.note("warn", `fetch.prompt: model could not be resolved (${errorMessage(error)}); web_fetch has no prompt argument`);
      }
    }

    const tools: ToolDefinition[] = [];
    let service: WebFetchService | undefined;
    const toolOptions = {
      ...(domains === undefined ? {} : { domains }),
      cache,
      ...(prompt === undefined ? {} : { prompt }),
    };

    const validateUrl = (url: URL): void => assertSsrfAllowedUrl(url.toString());
    /** Every search backend shares one fetch/extract wiring; only the search adapter differs. */
    const registerSearch = async (name: ToolsWebBackend, search: WebSearchAdapter): Promise<void> => {
      const fetchBackend = prism.config.fetch?.backend ?? "native";
      let fetchAdapter: WebFetchAdapter | undefined;
      let extract: ReturnType<typeof createFirecrawlExtractor> | undefined;
      if (fetchBackend === "native") {
        fetchAdapter = nativeFetch(prism.config, limits, domains);
        // Extraction is a Firecrawl endpoint: without its key the rest of the package still works.
        if (prism.config.extract !== undefined)
          prism.status.note("warn", `${name}: extract needs fetch backend firecrawl with an apiKey ref; skipping web_extract`);
      } else if (fetchBackend === "firecrawl") {
        const fetchRef = prism.config.fetch?.apiKey;
        const fetchSecret = typeof fetchRef === "string" && fetchRef.length > 0 ? await prism.credentials.resolve(fetchRef) : undefined;
        if (fetchSecret === undefined) {
          prism.status.note("warn", `${name}: fetch backend firecrawl needs an apiKey ref; registering web_search only`);
          if (prism.config.extract !== undefined)
            prism.status.note("warn", `${name}: extract needs the firecrawl fetch apiKey ref; skipping web_extract`);
        } else {
          fetchAdapter = createFirecrawlFetch({ credentials: secretSource(fetchSecret), limits, validateUrl });
          extract = extractAdapter(prism.config.extract, secretSource(fetchSecret), limits, validateUrl);
        }
      } else if (prism.config.extract !== undefined) {
        prism.status.note("warn", `${name}: extract needs fetch backend firecrawl with an apiKey ref; skipping web_extract`);
      }
      tools.push(
        ...createWebTools({
          search,
          ...(fetchAdapter === undefined ? {} : { fetch: fetchAdapter }),
          ...(extract === undefined ? {} : { extract }),
          ...toolOptions,
        }),
      );
      if (fetchAdapter !== undefined) service = fetchService(fetchAdapter, domains);
    };

    if (backend === "native") {
      const fetch = nativeFetch(prism.config, limits, domains);
      tools.push(...createWebTools({ fetch, ...toolOptions }));
      service = fetchService(fetch, domains);
    } else if (backend === "obscura") {
      const binary = prism.config.obscura?.binary ?? "obscura";
      const command = resolveObscuraCommand(binary);
      if (command === undefined) {
        prism.status.note("warn", `obscura: binary ${JSON.stringify(binary)} is not an executable file`);
        return;
      }
      let obscuraLimits: ReturnType<typeof resolveObscuraWebLimits> | undefined;
      try {
        obscuraLimits = prism.config.obscura?.limits === undefined ? undefined : resolveObscuraWebLimits(prism.config.obscura.limits);
      } catch (error) {
        throw new Error(`prism-tools-web: invalid limits config: ${errorMessage(error)}`);
      }
      const bounds = obscuraLimits === undefined ? {} : { limits: obscuraLimits };
      const nativeTools = prism.config.obscura?.nativeTools ?? true;
      // Older Obscura clients validate literal hosts per hop but resolve DNS separately, so a redirect
      // to a public-looking name that resolves private slips through. Gate the page path on the first
      // release that re-resolves every hop, and fail closed when the version is unknown.
      const probe = await probeObscuraVersion({ command });
      const fetchTools = probe.guarded;
      if (!fetchTools) {
        prism.status.note(
          "warn",
          `obscura: version ${probe.version ?? "unverified"} lacks the per-hop private-network guard (needs ${OBSCURA_GUARDED_VERSION}+); registering web_search only and serving web_fetch from the native backend`,
        );
      }
      tools.push(
        ...createObscuraWebTools({
          command,
          nativeTools,
          fetchTools,
          ...bounds,
          cache,
          ...(prompt === undefined ? {} : { prompt }),
          ...(domains === undefined ? {} : { domains }),
        }).tools,
      );
      if (fetchTools) {
        // The same page path the web_fetch tool uses, so wiki and RAG URL ingestion work with Obscura.
        service = guardService(createObscuraPageFetcher({ command, ...bounds }), domains);
      } else {
        const fetch = nativeFetch(prism.config, limits, domains);
        tools.push(...createWebTools({ fetch, ...toolOptions }));
        service = fetchService(fetch, domains);
      }
    } else if (backend === "searxng") {
      const origin = prism.config.searxng?.origin;
      if (typeof origin !== "string" || origin.length === 0) {
        prism.status.note("warn", "searxng: searxng.origin is required");
        return;
      }
      // The key is optional; an instance behind an authenticating proxy may need one.
      let credentials: WebCredentialSource | undefined;
      const keyRef = prism.config.apiKey;
      if (typeof keyRef === "string" && keyRef.length > 0) {
        const secret = await prism.credentials.resolve(keyRef);
        if (secret === undefined) {
          prism.status.note("warn", `searxng: apiKey ref ${JSON.stringify(keyRef)} did not resolve`);
          return;
        }
        credentials = secretSource(secret);
      }
      const search = createSearxngSearch({
        origin,
        allowLoopback: prism.config.searxng?.allowLoopback === true,
        ...(credentials === undefined ? {} : { credentials }),
        limits,
      });
      await registerSearch(backend, search);
    } else if (backend !== "firecrawl") {
      const apiKeyRef = prism.config.apiKey;
      if (typeof apiKeyRef !== "string" || apiKeyRef.length === 0) {
        prism.status.note("warn", `${backend}: apiKey ref is required`);
        return;
      }
      const secret = await prism.credentials.resolve(apiKeyRef);
      if (secret === undefined) {
        prism.status.note("warn", `${backend}: apiKey ref ${JSON.stringify(apiKeyRef)} did not resolve`);
        return;
      }
      const credentials = secretSource(secret);
      const search =
        backend === "brave"
          ? createBraveSearch({ credentials, limits })
          : backend === "exa"
            ? createExaSearch({ credentials, limits })
            : backend === "tavily"
              ? createTavilySearch({ credentials, limits })
              : createKagiSearch({ credentials, limits });
      await registerSearch(backend, search);
    } else {
      const apiKeyRef = prism.config.apiKey;
      if (typeof apiKeyRef !== "string" || apiKeyRef.length === 0) {
        prism.status.note("warn", `${backend}: apiKey ref is required`);
        return;
      }
      const secret = await prism.credentials.resolve(apiKeyRef);
      if (secret === undefined) {
        prism.status.note("warn", `${backend}: apiKey ref ${JSON.stringify(apiKeyRef)} did not resolve`);
        return;
      }
      const credentials = secretSource(secret);
      const fetch = createFirecrawlFetch({ credentials, limits, validateUrl });
      const extract = extractAdapter(prism.config.extract, credentials, limits, validateUrl);
      tools.push(...createWebTools({ fetch, ...(extract === undefined ? {} : { extract }), ...toolOptions }));
      service = fetchService(fetch, domains);
    }

    for (const tool of tools) prism.tools.register(tool);
    if (service !== undefined) prism.services.provide("web.fetch", withFetchCache(guardService(service, domains), cache));
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsWeb}. */
export default definition;

/** The package with config baked in, for `packages: [toolsWeb({ backend })]`. */
export function toolsWeb(config: ToolsWebConfig): PackageInstance {
  return definition(config);
}
