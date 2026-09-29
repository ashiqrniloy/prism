import type { CommandDefinition, InstructionInjector, Skill, ToolDefinition } from "@arnilo/prism";
import { activateKernel, assertSsrfAllowedUrl, createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, type WikiIngestFetch, type WikiIngestUrlHookInput } from "@arnilo/prism-memory/wiki";
import type { PrismCodeConfig, PrismCodeWikiConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikiSettings {
  readonly enabled: boolean;
  readonly workspaceRoot?: string;
  readonly autoDeploySkills: boolean;
}

export interface WikiContributions {
  readonly enabled: boolean;
  readonly workspaceRoot?: string;
  readonly autoDeploySkills: boolean;
  readonly tools: readonly ToolDefinition[];
  readonly skills: readonly Skill[];
  readonly commands: readonly CommandDefinition[];
  readonly instructionInjectors: readonly InstructionInjector[];
  /** SSRF-checked host fetch hook handed to the wiki; absent when no web_fetch backend exists. */
  readonly fetchUrl?: (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null>;
}

const WIKI_FETCH_TOOL_NAME = "web_fetch";
const WIKI_INGEST_HOOK_ID = "wiki-ingest";

// ---------------------------------------------------------------------------
// Enablement (default off; wiki disabled is truly inert)
// ---------------------------------------------------------------------------

export function resolveWikiSettings(wiki: PrismCodeWikiConfig | undefined): WikiSettings {
  if (wiki === undefined || wiki === false || wiki === "off") {
    return { enabled: false, autoDeploySkills: false };
  }
  if (wiki === true || wiki === "on") {
    return { enabled: true, autoDeploySkills: false };
  }
  return {
    enabled: wiki.enabled !== false,
    autoDeploySkills: wiki.autoDeploySkills === true,
    ...(wiki.workspaceRoot ? { workspaceRoot: wiki.workspaceRoot } : {}),
  };
}

// ---------------------------------------------------------------------------
// Host fetch hook
// ---------------------------------------------------------------------------

function filenameFromUrl(url: string): string | undefined {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return base && /\.[A-Za-z0-9]+$/.test(base) ? base.slice(0, 128) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reuses the selected web plane's `web_fetch` tool as the wiki's host fetch hook.
 * Absent web tools ⇒ absent hook ⇒ `/wiki-ingest url=...` fails closed (wiki never fetches).
 */
export function createWikiFetchHook(
  webTools: readonly ToolDefinition[],
): ((input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null>) | undefined {
  const fetchTool = webTools.find((tool) => tool.name === WIKI_FETCH_TOOL_NAME);
  if (!fetchTool) return undefined;

  return async ({ url }) => {
    try {
      assertSsrfAllowedUrl(url);
    } catch {
      throw new Error(`wiki ingest URL rejected: not a public HTTP(S) target`);
    }
    const result = await fetchTool.execute(
      { url },
      { sessionId: WIKI_INGEST_HOOK_ID, runId: WIKI_INGEST_HOOK_ID, toolCallId: WIKI_INGEST_HOOK_ID },
    );
    if (result.error) {
      throw new Error(`web_fetch failed: ${result.error.message}`);
    }
    const value = result.value as { markdown?: unknown } | undefined;
    if (!value || typeof value.markdown !== "string") return null;
    const filename = filenameFromUrl(url);
    return { text: value.markdown, ...(filename ? { filename } : {}) };
  };
}

// ---------------------------------------------------------------------------
// Extension contributions
// ---------------------------------------------------------------------------

const DISABLED: WikiContributions = {
  enabled: false,
  autoDeploySkills: false,
  tools: [],
  skills: [],
  commands: [],
  instructionInjectors: [],
};

/**
 * Loads `createWikiExtension` into an extension kernel and returns its inert
 * contributions. Nothing is registered or written when wiki is disabled, and skill
 * auto-deploy requires the explicit `wiki.autoDeploySkills` opt-in.
 */
export async function resolveWikiContributions(
  config: PrismCodeConfig,
  options: { readonly webTools?: readonly ToolDefinition[] } = {},
): Promise<WikiContributions> {
  const settings = resolveWikiSettings(config.wiki);
  if (!settings.enabled) return DISABLED;

  const workspaceRoot = settings.workspaceRoot ?? config.cwd;
  const fetchUrl = createWikiFetchHook(options.webTools ?? []);
  const extension = createWikiExtension({
    workspaceRoot,
    autoDeploySkills: settings.autoDeploySkills,
    ...(fetchUrl ? { fetchUrl } : {}),
  });

  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([extension]);
  const activated = activateKernel(kernel);

  return {
    enabled: true,
    workspaceRoot,
    autoDeploySkills: settings.autoDeploySkills,
    tools: activated.tools,
    skills: activated.skills,
    commands: activated.commands,
    instructionInjectors: activated.instructionInjectors,
    ...(fetchUrl ? { fetchUrl } : {}),
  };
}
