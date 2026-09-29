import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "@arnilo/prism";
import { PrismCodeModuleError } from "./errors.js";

export interface ToolModuleLoadOptions {
  readonly workspaceRoot?: string;
  readonly allowList?: readonly string[];
}

function isToolDefinition(value: unknown): value is ToolDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.description === "string" &&
    typeof candidate.execute === "function"
  );
}

function extractToolsFromValue(value: unknown, specifier: string, exportName?: string): ToolDefinition[] {
  if (isToolDefinition(value)) {
    return [value];
  }
  if (typeof value === "function") {
    try {
      const result = (value as () => unknown)();
      return extractToolsFromValue(result, specifier, exportName);
    } catch (error) {
      throw new PrismCodeModuleError(
        `factory in "${specifier}" threw during invocation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (Array.isArray(value)) {
    const tools: ToolDefinition[] = [];
    for (const item of value) {
      if (isToolDefinition(item)) {
        tools.push(item);
      } else {
        throw new PrismCodeModuleError(`array in "${specifier}" contains an element that is not a valid ToolDefinition`);
      }
    }
    return tools;
  }
  const target = exportName ? `export "${exportName}" in "${specifier}"` : `module "${specifier}"`;
  throw new PrismCodeModuleError(`${target} does not export a valid ToolDefinition or ToolDefinition[]`);
}

export async function importToolModule(specifier: string, baseDir: string, options: ToolModuleLoadOptions = {}): Promise<ToolDefinition[]> {
  if (specifier.includes("\0")) {
    throw new PrismCodeModuleError(`invalid module specifier: ${specifier}`);
  }

  const hashIdx = specifier.indexOf("#");
  const filePart = hashIdx === -1 ? specifier : specifier.slice(0, hashIdx);
  const exportName = hashIdx === -1 ? undefined : specifier.slice(hashIdx + 1);

  const workspaceRoot = options.workspaceRoot ?? baseDir;
  const envAllowList = (process.env.PRISM_TOOL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowList = [...(options.allowList ?? []), ...envAllowList];

  const isRelative = filePart.startsWith("./") || filePart.startsWith("../");
  let importUrl: string;

  if (isRelative) {
    const resolvedPath = resolve(baseDir, filePart);
    let realTarget: string;
    try {
      realTarget = await realpath(resolvedPath);
    } catch {
      throw new PrismCodeModuleError(`module "${specifier}" does not exist at ${resolvedPath}`);
    }

    let realRoot: string;
    try {
      realRoot = await realpath(workspaceRoot);
    } catch {
      realRoot = workspaceRoot;
    }

    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      throw new PrismCodeModuleError(`module "${specifier}" escapes the allowed workspace root: ${realTarget}`);
    }
    importUrl = pathToFileURL(realTarget).href;
  } else {
    // Absolute path or bare package specifier
    const allowed =
      allowList.includes(specifier) ||
      allowList.includes(filePart) ||
      (isAbsolute(filePart) && allowList.some((prefix) => filePart.startsWith(prefix)));

    if (!allowed) {
      throw new PrismCodeModuleError(`module "${specifier}" is not in allowedModules or PRISM_TOOL_ALLOWLIST`);
    }

    if (isAbsolute(filePart)) {
      let realTarget: string;
      try {
        realTarget = await realpath(filePart);
      } catch {
        throw new PrismCodeModuleError(`module "${specifier}" does not exist at ${filePart}`);
      }
      importUrl = pathToFileURL(realTarget).href;
    } else {
      importUrl = filePart;
    }
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(importUrl)) as Record<string, unknown>;
  } catch (error) {
    throw new PrismCodeModuleError(`module "${specifier}" failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (exportName) {
    if (!(exportName in mod)) {
      throw new PrismCodeModuleError(`module "${specifier}" has no export named "${exportName}"`);
    }
    return extractToolsFromValue(mod[exportName], specifier, exportName);
  }

  // No export hash specified: check mod.default, mod.tools, or named tool exports
  if (mod.default !== undefined) {
    try {
      return extractToolsFromValue(mod.default, specifier);
    } catch {
      // Fall through to check other exports
    }
  }

  if (Array.isArray(mod.tools)) {
    return extractToolsFromValue(mod.tools, specifier, "tools");
  }

  const collected: ToolDefinition[] = [];
  for (const [key, val] of Object.entries(mod)) {
    if (key === "default") continue;
    if (isToolDefinition(val)) {
      collected.push(val);
    }
  }

  if (collected.length > 0) {
    return collected;
  }

  throw new PrismCodeModuleError(
    `module "${specifier}" must export a default ToolDefinition, a .tools array, or named ToolDefinition exports`,
  );
}

export async function loadToolModules(
  specifiers: readonly string[],
  baseDir: string,
  options: ToolModuleLoadOptions = {},
): Promise<ToolDefinition[]> {
  const result: ToolDefinition[] = [];
  for (const specifier of specifiers) {
    const tools = await importToolModule(specifier, baseDir, options);
    result.push(...tools);
  }
  return result;
}

export async function loadReplacementToolModules(
  replacements: Readonly<Record<string, string>>,
  baseDir: string,
  options: ToolModuleLoadOptions = {},
): Promise<Record<string, ToolDefinition>> {
  const result: Record<string, ToolDefinition> = {};
  for (const [targetName, specifier] of Object.entries(replacements)) {
    const tools = await importToolModule(specifier, baseDir, options);
    if (tools.length === 0) {
      throw new PrismCodeModuleError(`replacement specifier "${specifier}" for tool "${targetName}" produced zero tools`);
    }
    // Match tool with targetName, or use the single loaded tool with targetName
    let matched = tools.find((t) => t.name === targetName);
    if (!matched) {
      if (tools.length === 1) {
        // Adapt single tool to target name if needed
        matched = { ...tools[0], name: targetName };
      } else {
        throw new PrismCodeModuleError(
          `replacement specifier "${specifier}" for tool "${targetName}" produced multiple tools with no match for "${targetName}"`,
        );
      }
    }
    result[targetName] = matched;
  }
  return result;
}
