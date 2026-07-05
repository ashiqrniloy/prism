import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import type {
  Agent,
  AgentDefinition,
  AgentDefinitionResolutionContext,
  ContextProvider,
  DiscoveredContribution,
  ProviderResolver,
  Skill,
  SystemPromptContribution,
  ToolDefinition,
} from "../contracts.js";
import type { ManifestContributionDeclaration } from "../manifests.js";
import { parseSkillFile, splitFrontmatter } from "../contribution-parsing.js";
import { resolveAgentDefinition } from "../agent-definitions.js";
import { assertPermission, isTrusted } from "../security.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import { isPathInsideReal } from "./trust.js";
import { readOptionalFile } from "./contribution-discovery.js";
import { createSkillRegistry } from "../skills.js";
import { isJsonObject } from "../config.js";

/** Options for {@link resolveAgentBundle}. */
export interface ResolveAgentBundleOptions {
  /** File reader. Defaults to `node:fs/promises.readFile`. */
  readonly readFile?: (path: string) => Promise<string>;
  /** Workspace root for the repo-level project prompt (`AGENTS.md`) and repo contributions. */
  readonly workspaceRoot?: string;
  /** Repo-level contributions from {@link discoverContributions}. */
  readonly repoContributions?: readonly DiscoveredContribution[];
  /** Host registries (models, providers, context providers). */
  readonly registries?: AgentDefinitionResolutionContext["registries"];
  /** Provider resolver override. */
  readonly providerSource?: ProviderResolver;
  /** Tool scope override. */
  readonly tools?: AgentDefinitionResolutionContext["tools"];
  /** Skill registry override. */
  readonly skillsRegistry?: AgentDefinitionResolutionContext["skillsRegistry"];
  /** Migration-only: omitted `tools`/`skills` activate every in-scope tool/skill. Defaults to fail-closed. */
  readonly activateAllCapabilities?: AgentDefinitionResolutionContext["activateAllCapabilities"];
  /** Final config overrides applied after the bundle is resolved. */
  readonly overrides?: AgentDefinitionResolutionContext["overrides"];
  /** Trust policy gating the app-config root (`SYSTEM.md`) and workspace root (`AGENTS.md`) independently. */
  readonly trust?: TrustPolicy;
  /** Permission policy asserting each prompt-file read. */
  readonly permission?: PermissionPolicy;
  /** Scope inclusion flags. All sources default to `true`. */
  readonly include?: AgentBundleScopeFlags;
}

/** Which scopes contribute to a {@link resolveAgentBundle} call. */
export interface AgentBundleScopeFlags {
  readonly systemPrompt?: boolean;
  readonly agentPrompt?: boolean;
  readonly repoPrompt?: boolean;
  readonly globalSkills?: boolean;
  readonly agentSkills?: boolean;
  readonly repoSkills?: boolean;
  readonly globalTools?: boolean;
  readonly agentTools?: boolean;
  readonly repoTools?: boolean;
}

const defaultInclude: Required<AgentBundleScopeFlags> = {
  systemPrompt: true,
  agentPrompt: true,
  repoPrompt: true,
  globalSkills: true,
  agentSkills: true,
  repoSkills: true,
  globalTools: true,
  agentTools: true,
  repoTools: true,
};

/** Lightweight envelope describing an app-config agent bundle discovered on disk. */
export interface AgentBundle {
  /** Agent name (from the containing directory or AGENT.md frontmatter, validated later). */
  readonly name: string;
  /** Absolute path to the per-agent `AGENT.md` file. */
  readonly path: string;
  /** Root directory that was scanned. */
  readonly configRoot: string;
  /** Path to the app-global `SYSTEM.md` prompt, if present. */
  readonly systemPromptPath?: string;
  /** Paths to global skills under `<configRoot>/agents/skills/`. */
  readonly globalSkills: readonly string[];
  /** Paths to global tools under `<configRoot>/agents/tools/`. */
  readonly globalTools: readonly string[];
  /** Paths to agent-specific skills under `<agentDir>/skills/`. */
  readonly agentSkills: readonly string[];
  /** Paths to agent-specific tools under `<agentDir>/tools/`. */
  readonly agentTools: readonly string[];
}

/** Options for {@link discoverAgentBundles}. */
export interface DiscoverAgentBundlesOptions {
  /** App configuration root. Scans `<configRoot>/agents/`. */
  readonly configRoot: string;
  readonly trust?: TrustPolicy;
  readonly permission?: PermissionPolicy;
  readonly signal?: AbortSignal;
}

/** Discover app-config agent bundles under `<configRoot>/agents/`.
 *
 *  Returns one {@link AgentBundle} per subdirectory containing an `AGENT.md` file.
 *  Also collects paths to the app-global `SYSTEM.md`, global skills/tools, and
 *  per-agent skills/tools. No file content is parsed here; resolution happens in
 *  {@link resolveAgentBundle}. Trust/permission policies apply to `configRoot`
 *  and its subdirectories; symlinks escaping `configRoot/agents` are excluded.
 */
export async function discoverAgentBundles(
  options: DiscoverAgentBundlesOptions,
): Promise<readonly AgentBundle[]> {
  const { configRoot, trust, permission, signal } = options;
  if (signal?.aborted) throw signal.reason;

  if (trust) {
    const decision = await trust.check({ kind: "project", target: configRoot });
    if (!decision.trusted) return [];
  }

  const agentsDir = join(configRoot, "agents");
  const systemPromptPath = await findSystemPromptPath(agentsDir);
  const globalSkills = await scanSkillPaths(join(agentsDir, "skills"), agentsDir, permission);
  const globalTools = await scanToolPaths(join(agentsDir, "tools"), agentsDir, permission);

  const bundles: AgentBundle[] = [];
  for (const name of await listSubdirs(agentsDir)) {
    if (name === "skills" || name === "tools") continue;
    const agentDir = join(agentsDir, name);
    const agentPath = join(agentDir, "AGENT.md");
    if ((await readOptionalFile(agentPath)) === undefined) continue;
    await assertPermission(permission, { kind: "resource", action: "load", target: agentDir });
    if (!(await isPathInsideReal(agentsDir, agentDir))) continue;

    const agentSkills = await scanSkillPaths(join(agentDir, "skills"), agentsDir, permission);
    const agentTools = await scanToolPaths(join(agentDir, "tools"), agentsDir, permission);
    bundles.push({
      name,
      path: agentPath,
      configRoot,
      systemPromptPath,
      globalSkills,
      globalTools,
      agentSkills,
      agentTools,
    });
  }

  return bundles;
}

async function findSystemPromptPath(agentsDir: string): Promise<string | undefined> {
  const path = join(agentsDir, "SYSTEM.md");
  return (await readOptionalFile(path)) !== undefined ? path : undefined;
}

async function scanSkillPaths(
  dir: string,
  agentsDir: string,
  permission: PermissionPolicy | undefined,
): Promise<readonly string[]> {
  const out: string[] = [];
  for (const name of await listSubdirs(dir)) {
    const path = join(dir, name, "SKILL.md");
    if ((await readOptionalFile(path)) === undefined) continue;
    await assertPermission(permission, { kind: "resource", action: "load", target: join(dir, name) });
    if (!(await isPathInsideReal(agentsDir, path))) continue;
    out.push(path);
  }
  return out;
}

async function scanToolPaths(
  dir: string,
  agentsDir: string,
  permission: PermissionPolicy | undefined,
): Promise<readonly string[]> {
  const out: string[] = [];
  for (const name of await listSubdirs(dir)) {
    const path = join(dir, name, "manifest.json");
    if ((await readOptionalFile(path)) === undefined) continue;
    await assertPermission(permission, { kind: "resource", action: "load", target: join(dir, name) });
    if (!(await isPathInsideReal(agentsDir, path))) continue;
    out.push(path);
  }
  return out;
}

/** Resolve a discovered {@link AgentBundle} into a runnable {@link Agent}.
 *
 *  Builds union tool/skill registries across the included scopes (global,
 *  agent-specific, and repo-level). Duplicate names across included scopes throw
 *  rather than override. System prompts append in fixed order
 *  `SYSTEM.md` → `AGENT.md` → `AGENTS.md` when enabled, before delegating to
 *  {@link resolveAgentDefinition}. No `import()` is performed; descriptor-only
 *  repo tools throw if executed.
 *
 *  The caller controls scope by which registries and flags it passes. Missing
 *  dependencies fail closed at resolution time. Each prompt file is read at
 *  most once per call; resolution is one-shot, so no cross-call cache is kept
 *  (ponytail: add memoization only if a host resolves the same bundle repeatedly). */
export async function resolveAgentBundle(
  bundle: AgentBundle,
  options: ResolveAgentBundleOptions,
): Promise<Agent> {
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"));
  const text = await read(bundle.path);
  const { front } = splitFrontmatter(text, bundle.path);

  const include = { ...defaultInclude, ...(options.include ?? {}) };

  const skillSources = await buildSkillSources(bundle, options, read, include);
  const skills = unionSkills(skillSources);

  const toolSources = buildToolSources(bundle, options, include);
  const tools = unionTools(toolSources);

  const systemPrompts = await buildSystemPrompts(bundle, options, read, text, include);

  const rawName = String(front.get("name") ?? "").trim() || parentDirName(bundle.path);
  if (!NAME_RE.test(rawName)) {
    throw new Error(`Invalid agent name in ${bundle.path}: ${JSON.stringify(rawName)}`);
  }

  const def: AgentDefinition = {
    name: rawName.replace(/\s+/g, "-"),
    description: getString(front, "description"),
    model: getString(front, "model"),
    tools: getStringList(front, "tools"),
    skills: getStringList(front, "skills"),
    context: getStringList(front, "context"),
    instructions: getString(front, "instructions"),
    ...(systemPrompts.length > 0 ? { systemPrompt: systemPrompts } : {}),
    metadata: collectMetadata(front),
  };

  // ponytail: SKILL.md context names are resolved against the host context-provider registry.
  resolveSkillContexts(skills, options.registries?.contextProviders);

  return resolveAgentDefinition(def, {
    registries: options.registries,
    providerSource: options.providerSource,
    tools: tools.length > 0 ? tools : options.tools,
    skillsRegistry: skills.length > 0 ? createSkillRegistry(skills) : options.skillsRegistry,
    activateAllCapabilities: options.activateAllCapabilities,
    overrides: options.overrides,
  });
}

async function buildSkillSources(
  bundle: AgentBundle,
  options: ResolveAgentBundleOptions,
  read: (path: string) => Promise<string>,
  include: Required<AgentBundleScopeFlags>,
): Promise<readonly { scope: string; skills: readonly Skill[] }[]> {
  const out: { scope: string; skills: readonly Skill[] }[] = [];
  if (include.globalSkills) {
    out.push({ scope: "global", skills: await parseSkillPaths(bundle.globalSkills, read) });
  }
  if (include.agentSkills) {
    out.push({ scope: "agent", skills: await parseSkillPaths(bundle.agentSkills, read) });
  }
  if (include.repoSkills && options.repoContributions) {
    const skills = options.repoContributions
      .filter((c): c is DiscoveredContribution & { kind: "skill"; skill: Skill } => c.kind === "skill" && c.skill !== undefined)
      .map((c) => c.skill);
    out.push({ scope: "repo", skills });
  }
  return out;
}

function buildToolSources(
  bundle: AgentBundle,
  options: ResolveAgentBundleOptions,
  include: Required<AgentBundleScopeFlags>,
): readonly { scope: string; tools: readonly ToolDefinition[] }[] {
  const out: { scope: string; tools: readonly ToolDefinition[] }[] = [];
  if (include.globalTools) {
    out.push({ scope: "global", tools: bundle.globalTools.map((path) => toolDescriptorFromPath(path)) });
  }
  if (include.agentTools) {
    out.push({ scope: "agent", tools: bundle.agentTools.map((path) => toolDescriptorFromPath(path)) });
  }
  if (include.repoTools && options.repoContributions) {
    const tools = options.repoContributions
      .filter((c): c is DiscoveredContribution & { kind: "tool"; declaration: ManifestContributionDeclaration } => c.kind === "tool" && c.declaration !== undefined)
      .map((c) => toolDescriptorFromDeclaration(c.declaration));
    out.push({ scope: "repo", tools });
  }
  return out;
}

async function buildSystemPrompts(
  bundle: AgentBundle,
  options: ResolveAgentBundleOptions,
  read: (path: string) => Promise<string>,
  agentText: string,
  include: Required<AgentBundleScopeFlags>,
): Promise<readonly SystemPromptContribution[]> {
  const out: SystemPromptContribution[] = [];
  if (include.systemPrompt && bundle.systemPromptPath) {
    // ponytail: trust-gate the app-config root independently from the workspace root. SYSTEM.md is
    // app-supplied, so an untrusted configRoot contributes nothing (fail-closed, no throw).
    if (await isTrusted(options.trust, { kind: "project", target: bundle.systemPromptPath })) {
      await assertPermission(options.permission, { kind: "resource", action: "load", target: bundle.systemPromptPath });
      const text = await readOptional(read, bundle.systemPromptPath);
      if (text !== undefined) {
        out.push({
          id: "agent-system",
          source: "user",
          mode: "append",
          text,
        });
      }
    }
  }
  if (include.agentPrompt) {
    const text = bodyAsInstructions(agentText, bundle.path);
    if (text) {
      out.push({
        id: "agent-prompt",
        source: "package",
        mode: "append",
        text,
      });
    }
  }
  if (include.repoPrompt && options.workspaceRoot) {
    const repoPath = join(options.workspaceRoot, "AGENTS.md");
    // ponytail: trust-gate the workspace root independently; untrusted AGENTS.md is skipped silently.
    if (await isTrusted(options.trust, { kind: "project", target: repoPath })) {
      await assertPermission(options.permission, { kind: "resource", action: "load", target: repoPath });
      const text = await readOptional(read, repoPath);
      if (text !== undefined) {
        out.push({
          id: "repo-project-prompt",
          source: "app",
          mode: "append",
          text,
        });
      }
    }
  }
  return out;
}

async function parseSkillPaths(paths: readonly string[], read: (path: string) => Promise<string>): Promise<readonly Skill[]> {
  const out: Skill[] = [];
  for (const path of paths) {
    const text = await read(path);
    out.push(parseSkillFile(text, path));
  }
  return out;
}

function unionSkills(sources: readonly { scope: string; skills: readonly Skill[] }[]): readonly Skill[] {
  const seen = new Map<string, string>();
  const out: Skill[] = [];
  for (const { scope, skills } of sources) {
    for (const skill of skills) {
      if (seen.has(skill.name)) {
        throw new Error(`Duplicate skill name across scopes: ${skill.name} (found in ${scope} and ${seen.get(skill.name)})`);
      }
      seen.set(skill.name, scope);
      out.push(skill);
    }
  }
  return out;
}

function unionTools(sources: readonly { scope: string; tools: readonly ToolDefinition[] }[]): readonly ToolDefinition[] {
  const seen = new Map<string, string>();
  const out: ToolDefinition[] = [];
  for (const { scope, tools } of sources) {
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        throw new Error(`Duplicate tool name across scopes: ${tool.name} (found in ${scope} and ${seen.get(tool.name)})`);
      }
      seen.set(tool.name, scope);
      out.push(tool);
    }
  }
  return out;
}

function toolDescriptorFromPath(path: string): ToolDefinition {
  const name = parentDirName(path);
  return toolDescriptor(name);
}

function toolDescriptorFromDeclaration(declaration: ManifestContributionDeclaration): ToolDefinition {
  return toolDescriptor(declaration.name);
}

function toolDescriptor(name: string): ToolDefinition {
  return {
    name,
    execute: () => {
      throw new Error(`Discovered tool ${name} requires host execution`);
    },
  };
}

function resolveSkillContexts(skills: readonly Skill[], contextProviders: { resolve(name: string): ContextProvider } | undefined): void {
  if (!contextProviders) return;
  for (const skill of skills) {
    const names = skill.metadata?.context;
    if (!Array.isArray(names)) continue;
    (skill as { context?: ContextProvider[] }).context = names.map((name) => contextProviders.resolve(String(name)));
  }
}

function collectMetadata(front: ReadonlyMap<string, unknown>): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of front) {
    if (key !== "name" && key !== "description" && key !== "model" && key !== "tools" && key !== "skills" && key !== "context" && key !== "instructions") {
      metadata[key] = value;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function getString(front: ReadonlyMap<string, unknown>, key: string): string | undefined {
  const value = front.get(key);
  if (typeof value === "string") return value;
  return undefined;
}

function getStringList(front: ReadonlyMap<string, unknown>, key: string): readonly string[] | undefined {
  const value = front.get(key);
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return undefined;
}

function bodyAsInstructions(text: string, path: string): string | undefined {
  const { body } = splitFrontmatter(text, path);
  const trimmed = body.replace(/^\n+/, "").trimEnd();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function listSubdirs(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir);
    const out: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry);
      try {
        if ((await stat(path)).isDirectory()) out.push(entry);
      } catch {
        // ignore stat errors for individual entries
      }
    }
    return out;
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

async function readOptional(read: (path: string) => Promise<string>, path: string): Promise<string | undefined> {
  try {
    return await read(path);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
}

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

function parentDirName(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1] ?? "";
}

/** Parse a `CONTEXT.md` into a static {@link ContextProvider}. The markdown
 *  body becomes the context block content; frontmatter `name` overrides the
 *  directory name. */
export function parseContextFile(text: string, path: string): ContextProvider {
  const { front, body } = splitFrontmatter(text, path);
  const rawName = String(front.get("name") ?? "").trim() || parentDirName(path);
  if (!NAME_RE.test(rawName)) {
    throw new Error(`Invalid context provider name in ${path}: ${JSON.stringify(rawName)}`);
  }
  const name = rawName.replace(/\s+/g, "-");
  const title = String(front.get("title") ?? name);
  return {
    name,
    resolve: () => [{ title, content: body.replace(/^\n+/, "").trimEnd() }],
  };
}

/** Parse a `TOOL.md` into a descriptor-only {@link ToolDefinition}. The
 *  executable behavior is host-owned; calling `execute` throws. */
export function parseToolFile(text: string, path: string): ToolDefinition {
  const { front, body } = splitFrontmatter(text, path);
  const rawName = String(front.get("name") ?? "").trim() || parentDirName(path);
  if (!NAME_RE.test(rawName)) {
    throw new Error(`Invalid tool name in ${path}: ${JSON.stringify(rawName)}`);
  }
  const name = rawName.replace(/\s+/g, "-");
  const description = String(front.get("description") ?? "").trim() || body.replace(/^\n+/, "").slice(0, 80).trim();
  return {
    name,
    ...(description ? { description } : {}),
    execute: () => {
      throw new Error(`Discovered tool ${name} requires host execution`);
    },
  };
}
