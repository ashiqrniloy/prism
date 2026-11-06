/**
 * `@arnilo/prism-tools-browser` — the first-party browser automation tools as a package.
 *
 * The default export registers the six exclusive model-facing tools from `createBrowserTools`
 * (`browser_open`, `browser_snapshot`, `browser_act`, `browser_close`, `browser_evaluate`,
 * `browser_observe`), each declaring its `effects` for the host approval hook. `playwright-core`
 * is imported dynamically in `setup` and used to launch the run-owned browser; when it is missing
 * (or the launch fails) the package registers nothing and writes a `warn` status note. The
 * manager and the launched browser are closed in `onDispose`.
 *
 * Egress is fail-closed: without a `containedProxy` attestation every external request is denied,
 * and `allowOrigins` narrows navigation to an explicit origin allowlist. Blocked schemes, loopback,
 * private, link-local, and ULA destinations are denied inside the manager, so they hold under any
 * approval mode.
 *
 * ```ts
 * import toolsBrowser from "@arnilo/prism-tools-browser";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({ model, packages: [toolsBrowser({ headless: true, allowOrigins: ["https://example.com"] })] });
 * ```
 */
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };
import { definePackage, type PackageInstance, type ToolDefinition } from "@arnilo/prism";

import { type ToolsBrowserConfig, toolsBrowserConfigSchema } from "./config.js";
import { createBrowserManager } from "./manager.js";
import type { BrowserNetworkPolicy } from "./network.js";
import { createBrowserTools } from "./tools.js";
import type { PlaywrightBrowser } from "./types.js";

// The moved 0.12 surface keeps its names, now behind one entry point.
export * from "./browser.js";
export type { ToolsBrowserConfig, ToolsBrowserProxyConfig } from "./config.js";
export { toolsBrowserConfigSchema } from "./config.js";

/** The subset of `playwright-core` the package uses; kept structural so the peer stays optional. */
interface PlaywrightChromium {
  launch(options: { readonly headless?: boolean; readonly executablePath?: string; readonly channel?: string }): Promise<PlaywrightBrowser>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalize `allowOrigins` entries to origins and deny every other origin. */
function originPolicy(allowOrigins: readonly string[]): BrowserNetworkPolicy["validateUrl"] {
  const allowed = new Set(
    allowOrigins.map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin;
      }
    }),
  );
  return (url: URL): boolean => allowed.has(url.origin);
}

function networkPolicyOf(config: ToolsBrowserConfig): BrowserNetworkPolicy {
  const policy: BrowserNetworkPolicy = {
    ...(config.containedProxy !== undefined ? { containedProxyAttestation: config.containedProxy } : {}),
    ...(config.allowLoopback === true ? { allowLoopback: true } : {}),
    ...(config.allowPrivateHosts === true ? { allowPrivateHosts: true } : {}),
  };
  if (config.allowOrigins !== undefined && config.allowOrigins.length > 0) {
    return { ...policy, validateUrl: originPolicy(config.allowOrigins) };
  }
  return policy;
}

const definition = definePackage<ToolsBrowserConfig>({
  name: "@arnilo/prism-tools-browser",
  version: manifest.version,
  description: "Six exclusive browser tools over Playwright with declared effects, fail-closed egress policy, and artifact quarantine.",
  requires: { api: 1 },
  config: toolsBrowserConfigSchema,
  setup: async (prism) => {
    // Registered first: `requiresTools` hides the skill when playwright-core is missing or the launch fails.
    prism.skills.addDir(fileURLToPath(new URL("../skills", import.meta.url)));
    let chromium: PlaywrightChromium;
    try {
      ({ chromium } = (await import("playwright-core")) as unknown as { chromium: PlaywrightChromium });
    } catch (error) {
      prism.status.note("warn", `browser: playwright-core is not installed (${errorMessage(error)})`);
      return;
    }

    const launchOptions: { headless: boolean; executablePath?: string; channel?: string } = {
      headless: prism.config.headless ?? true,
    };
    if (prism.config.executablePath !== undefined) launchOptions.executablePath = prism.config.executablePath;
    if (prism.config.channel !== undefined) launchOptions.channel = prism.config.channel;

    let browser: PlaywrightBrowser;
    try {
      browser = await chromium.launch(launchOptions);
    } catch (error) {
      prism.status.note("warn", `browser: launch failed (${errorMessage(error)})`);
      return;
    }

    const uploadRoots = prism.config.uploadRoots;
    const quarantine = prism.config.quarantine;
    const manager = createBrowserManager({
      browser,
      networkPolicy: networkPolicyOf(prism.config),
      cdp: { mode: prism.config.cdp ?? "auto" },
      ...(uploadRoots !== undefined && uploadRoots.length > 0 ? { uploads: { roots: uploadRoots } } : {}),
      ...(quarantine !== undefined ? { downloads: { quarantine } } : {}),
    });
    const tools: readonly ToolDefinition[] = createBrowserTools({ manager });
    for (const tool of tools) prism.tools.register(tool);

    prism.onDispose(async () => {
      await manager.close();
      await browser.close?.();
    });
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsBrowser}. */
export default definition;

/** The package with config baked in, for `packages: [toolsBrowser({ headless })]`. */
export function toolsBrowser(config: ToolsBrowserConfig = {}): PackageInstance {
  return definition(config);
}
