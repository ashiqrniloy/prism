import { statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { assertSsrfAllowedUrl, type CredentialResolver, type ToolDefinition } from "@arnilo/prism";
import { createBraveSearch, createFirecrawlFetch, createWebTools } from "@arnilo/prism-web-tools";
import { createObscuraWebTools } from "@arnilo/prism-web-tools/obscura";
import type { PrismCodeConfig, PrismCodeWebConfig } from "./config.js";
import type { PrismCodeCredentialManager } from "./credentials.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebBackendMode = "obscura" | "brave" | "off";

export interface WebToolResolution {
  readonly mode: WebBackendMode;
  readonly enabled: boolean;
  readonly tools: readonly ToolDefinition[];
  readonly toolNames: readonly string[];
  /** Visible setup/unavailable diagnostics; never a silent invocation failure. */
  readonly notes: readonly string[];
  /** Diagnostic for /tools and doctor even when an implicit default stays silent at startup. */
  readonly unavailableReason?: string;
}

// ---------------------------------------------------------------------------
// Executable resolution (trusted absolute paths only)
// ---------------------------------------------------------------------------

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    return process.platform === "win32" || (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Resolves a command name against absolute PATH entries only; relative dirs are never trusted. */
export function resolveInstalledCommand(name: string): string | undefined {
  if (!name || name.includes("/") || name.includes("\\")) return undefined;
  const pathExt = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidates = pathExt.length > 0 ? pathExt.map((ext) => join(dir, `${name}${ext.toLowerCase()}`)) : [join(dir, name)];
    for (const candidate of candidates) {
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Absolute configured path must be a real executable; a bare name is resolved from PATH. */
export function resolveExecutablePath(command: string): string | undefined {
  if (isAbsolute(command)) return isExecutableFile(command) ? command : undefined;
  return resolveInstalledCommand(command);
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export function resolveWebMode(web: PrismCodeWebConfig | undefined): WebBackendMode {
  if (web === undefined) return "obscura";
  if (typeof web === "string") return web;
  return web.mode ?? "obscura";
}

function webCredentialResolver(manager: PrismCodeCredentialManager, provider: string): CredentialResolver {
  return {
    resolve: async () => {
      const value = await manager.getApiKey(provider);
      return value ? { type: "api_key", value } : undefined;
    },
  };
}

function resolution(mode: WebBackendMode, tools: readonly ToolDefinition[], notes: readonly string[] = []): WebToolResolution {
  return { mode, enabled: tools.length > 0, tools, toolNames: tools.map((t) => t.name), notes };
}

/**
 * Resolves the single selected web plane for Prism Code.
 *
 * - `obscura` (auto when installed): standard `web_search`/`web_fetch` through a host-installed
 *   absolute binary; native CLI tools only on explicit opt-in. A missing implicit default stays
 *   silent at startup but retains the reason for diagnostics; an explicit selection warns.
 * - `brave`: Brave search plus Firecrawl fetch; a missing fetch backend registers
 *   `web_search` only and is reported — Brave is never mislabeled as a fetcher.
 * - `off`: no web tools.
 */
export async function resolveWebTools(config: PrismCodeConfig, credentials: PrismCodeCredentialManager): Promise<WebToolResolution> {
  const mode = resolveWebMode(config.web);
  if (mode === "off") return resolution("off", []);

  if (mode === "brave") {
    const notes: string[] = [];
    const search = createBraveSearch({ credentials: webCredentialResolver(credentials, "brave") });
    const fetchBackend = typeof config.web === "object" ? (config.web.fetchBackend ?? "firecrawl") : "firecrawl";
    let fetch: ReturnType<typeof createFirecrawlFetch> | undefined;
    if (fetchBackend === "off") {
      notes.push('web mode brave: fetchBackend "off" — web_search only, no fetch backend.');
    } else if (await credentials.hasCredentials("firecrawl")) {
      fetch = createFirecrawlFetch({
        credentials: webCredentialResolver(credentials, "firecrawl"),
        validateUrl: (url) => assertSsrfAllowedUrl(url.toString()),
      });
    } else {
      notes.push("web mode brave: web_fetch needs a Firecrawl backend (set FIRECRAWL_API_KEY or store a firecrawl credential).");
    }
    return resolution("brave", createWebTools({ search, ...(fetch ? { fetch } : {}) }), notes);
  }

  const configured = typeof config.web === "object" ? config.web.command : undefined;
  const command = configured ? resolveExecutablePath(configured) : resolveInstalledCommand("obscura");
  if (!command) {
    const reason = configured
      ? `configured Obscura binary is not an executable file: ${configured}`
      : "Obscura binary not found on PATH. Install Obscura or set web.command to its absolute path; web_search/web_fetch stay disabled.";
    const explicit =
      config.web === "obscura" || (typeof config.web === "object" && (config.web.mode === "obscura" || config.web.command !== undefined));
    return { ...resolution(explicit ? "obscura" : "off", [], explicit ? [reason] : []), unavailableReason: reason };
  }

  const nativeTools = typeof config.web === "object" && config.web.nativeTools === true;
  const { tools } = createObscuraWebTools({ command, nativeTools });
  return resolution("obscura", tools);
}
