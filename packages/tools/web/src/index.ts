/**
 * `@arnilo/prism-tools-web` — the first-party web search and fetch tools as a package.
 *
 * The default export registers `web_search`, `web_fetch`, and (through the named `createWebTools`
 * factory) `web_extract`, each declaring `effects: ["network"]`. The backend is selected by config:
 *
 * - `brave` / `exa`: a search key (ref-only) plus an optional Firecrawl `fetch` backend.
 * - `firecrawl`: fetch and extract only.
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
import { assertSsrfAllowedUrl, definePackage, type PackageInstance, type Secret, type ToolDefinition } from "@arnilo/prism";

import { createBraveSearch } from "./brave.js";
import { type ToolsWebConfig, toolsWebConfigSchema } from "./config.js";
import { createExaSearch } from "./exa.js";
import { createFirecrawlFetch } from "./firecrawl.js";
import { resolveObscuraCommand } from "./obscura/process.js";
import { createObscuraWebTools } from "./obscura/web.js";
import { createWebTools } from "./tools.js";
import { resolveWebLimits } from "./limits.js";
import type { WebCredentialSource, WebFetchAdapter, WebFetchService } from "./types.js";

// The moved 0.12 surface keeps its names, now behind one entry point.
export * from "./brave.js";
export * from "./exa.js";
export * from "./firecrawl.js";
export * from "./limits.js";
export * from "./normalize.js";
export * from "./obscura/index.js";
export * from "./tools.js";
export * from "./transport.js";
export * from "./types.js";
export type {
  ToolsWebBackend,
  ToolsWebConfig,
  ToolsWebFetchConfig,
  ToolsWebObscuraConfig,
} from "./config.js";
export { toolsWebConfigSchema } from "./config.js";

const BACKENDS: readonly ToolsWebConfig["backend"][] = ["brave", "exa", "firecrawl", "obscura"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  capabilities: ["credentials"],
  config: toolsWebConfigSchema,
  setup: async (prism) => {
    const backend = prism.config.backend;
    if (backend === undefined || !BACKENDS.includes(backend)) {
      throw new Error("prism-tools-web: config needs backend (one of brave, exa, firecrawl, obscura)");
    }

    let limits: ReturnType<typeof resolveWebLimits>;
    try {
      limits = resolveWebLimits(prism.config.limits);
    } catch (error) {
      throw new Error(`prism-tools-web: invalid limits config: ${errorMessage(error)}`);
    }

    const tools: ToolDefinition[] = [];
    let fetchService: WebFetchService | undefined;

    if (backend === "obscura") {
      const binary = prism.config.obscura?.binary ?? "obscura";
      const command = resolveObscuraCommand(binary);
      if (command === undefined) {
        prism.status.note("warn", `obscura: binary ${JSON.stringify(binary)} is not an executable file`);
        return;
      }
      const nativeTools = prism.config.obscura?.nativeTools ?? true;
      tools.push(...createObscuraWebTools({ command, nativeTools }).tools);
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
      const validateUrl = (url: URL): void => assertSsrfAllowedUrl(url.toString());

      if (backend === "brave" || backend === "exa") {
        const search = backend === "brave" ? createBraveSearch({ credentials, limits }) : createExaSearch({ credentials, limits });
        const fetchBackend = prism.config.fetch?.backend ?? "firecrawl";
        let fetch: WebFetchAdapter | undefined;
        if (fetchBackend === "firecrawl") {
          const fetchRef = prism.config.fetch?.apiKey;
          const fetchSecret = typeof fetchRef === "string" && fetchRef.length > 0 ? await prism.credentials.resolve(fetchRef) : undefined;
          if (fetchSecret === undefined) {
            prism.status.note("warn", `${backend}: fetch backend firecrawl needs an apiKey ref; registering web_search only`);
          } else {
            fetch = createFirecrawlFetch({ credentials: secretSource(fetchSecret), limits, validateUrl });
          }
        }
        tools.push(...createWebTools({ search, ...(fetch === undefined ? {} : { fetch }) }));
        if (fetch !== undefined) fetchService = { fetch: (url, options) => fetch.fetch(url, options) };
      } else {
        const fetch = createFirecrawlFetch({ credentials, limits, validateUrl });
        tools.push(...createWebTools({ fetch }));
        fetchService = { fetch: (url, options) => fetch.fetch(url, options) };
      }
    }

    for (const tool of tools) prism.tools.register(tool);
    if (fetchService !== undefined) prism.services.provide("web.fetch", fetchService);
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsWeb}. */
export default definition;

/** The package with config baked in, for `packages: [toolsWeb({ backend })]`. */
export function toolsWeb(config: ToolsWebConfig): PackageInstance {
  return definition(config);
}
