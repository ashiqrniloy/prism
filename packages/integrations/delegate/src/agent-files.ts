import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type JsonValue, parseAgentFile } from "@arnilo/prism";
import type { DelegateChildConfig, DelegateConfig } from "./config.js";

/**
 * Claude Code tool names → the tools this repo registers (plan 189's final names). Frozen and the only
 * translation: a subagent file may name a tool, never a package. `Task`, `WebFetch` and the rest map to nothing.
 */
export const AGENT_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Read: "read",
  Write: "write",
  Edit: "edit",
  Grep: "grep",
  Glob: "glob",
  Bash: "shell",
});

/** Claude Code model aliases; like `inherit`, they mean the parent session's model. */
const MODEL_ALIASES = new Set(["inherit", "sonnet", "opus", "haiku", "fable"]);

/** The two directory conventions, in precedence order: `.agents` wins over `.claude`. */
const AGENT_DIRS = [".agents/agents", ".claude/agents"] as const;

export interface AgentFileNote {
  readonly level: "info" | "warn";
  readonly text: string;
}

export interface ResolvedAgentChildren {
  readonly children: Readonly<Record<string, DelegateChildConfig>>;
  readonly notes: readonly AgentFileNote[];
}

/** `tools:` is either a comma string or a YAML list; anything else is not a tool declaration. */
function declaredTools(value: JsonValue | undefined): readonly string[] | undefined {
  if (typeof value === "string") return value.split(",").map((name) => name.trim()).filter(Boolean);
  if (!Array.isArray(value)) return undefined;
  return value.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean);
}

/** One parsed file as a child, or `undefined` when the file selects no tool this delegate knows. */
function fileChild(
  declaration: ReturnType<typeof parseAgentFile>,
  path: string,
  inherit: readonly string[],
  notes: AgentFileNote[],
): DelegateChildConfig | undefined {
  const requested = declaredTools(declaration.metadata?.tools);
  let only: readonly string[] | undefined;
  if (requested !== undefined) {
    const mapped: string[] = [];
    const unmapped: string[] = [];
    for (const name of requested) {
      const tool = AGENT_TOOL_NAMES[name];
      if (tool === undefined) unmapped.push(name);
      else if (!mapped.includes(tool)) mapped.push(tool);
    }
    if (mapped.length === 0) {
      notes.push({
        level: "warn",
        text: `Agent file ${path} lists only tools this delegate cannot map (${unmapped.join(", ")}), so ${declaration.name} was skipped.`,
      });
      return undefined;
    }
    if (unmapped.length > 0)
      notes.push({ level: "info", text: `Agent file ${path}: dropped unmapped tool${unmapped.length === 1 ? "" : "s"} ${unmapped.join(", ")}.` });
    only = mapped;
  }
  // A ref the parent can resolve is `provider/model`; a bare alias or bare id is the parent's model, which
  // is what Claude Code's `inherit` means and the only safe reading of a name without a provider.
  const declared = typeof declaration.metadata?.model === "string" ? declaration.metadata.model.trim() : "";
  let model: string | undefined;
  if (declared.length > 0 && !MODEL_ALIASES.has(declared)) {
    if (declared.includes("/")) model = declared;
    else
      notes.push({
        level: "info",
        text: `Agent file ${path}: model ${JSON.stringify(declared)} is not a "provider/model" ref, so ${declaration.name} uses the parent's model.`,
      });
  }
  const description = declaration.description?.trim();
  const instructions = declaration.instructions.trim();
  return {
    inherit,
    ...(description === undefined || description.length === 0 ? {} : { description }),
    ...(instructions.length === 0 ? {} : { instructions: declaration.instructions }),
    ...(model === undefined ? {} : { model }),
    ...(only === undefined ? {} : { tools: { only } }),
  };
}

/** `readdir` failures other than "no such directory" are worth one note; an absent directory is the normal case. */
function readDirectory(dir: string, notes: AgentFileNote[]): readonly string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith(".md") && (entry.isFile() || entry.isSymbolicLink()))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") notes.push({ level: "warn", text: `Agent directory ${dir} could not be read: ${String(error)}` });
    return [];
  }
}

/**
 * The configured children plus the ones defined by files under `agentsRoot`, in that precedence:
 * a configured child wins, then `.agents/agents`, then `.claude/agents`. A file cannot choose a package:
 * every file child inherits `defaultInherit`, narrowed by its own `tools` list.
 */
export function resolveAgentChildren(config: DelegateConfig): ResolvedAgentChildren {
  const configured = config.children ?? {};
  const children: Record<string, DelegateChildConfig> = { ...configured };
  if (config.agentsRoot === undefined) return { children, notes: [] };
  const source = resolve(config.agentsRoot);
  const inherit = config.defaultInherit;
  if (inherit === undefined)
    throw new Error("defaultInherit is required when agentsRoot is set: an agent file cannot choose which packages its child inherits");
  const notes: AgentFileNote[] = [];
  for (const dir of AGENT_DIRS) {
    const root = join(source, dir);
    for (const file of readDirectory(root, notes)) {
      const path = join(root, file);
      let declaration: ReturnType<typeof parseAgentFile>;
      try {
        declaration = parseAgentFile(readFileSync(path, "utf8"), path);
      } catch (error) {
        notes.push({ level: "warn", text: `Agent file ${path} was skipped: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      if (Object.hasOwn(children, declaration.name)) {
        notes.push({
          level: "info",
          text: `Agent file ${path} defines ${declaration.name}, which is already defined ${Object.hasOwn(configured, declaration.name) ? "in config" : "by another file"}; the earlier child wins.`,
        });
        continue;
      }
      const child = fileChild(declaration, path, inherit, notes);
      if (child !== undefined) children[declaration.name] = child;
    }
  }
  return { children, notes };
}
