// @arnilo/prism-coding-agent public barrel.
//
// First-party coding tools for the Prism agent harness. Factory functions return Prism
// `ToolDefinition`s that hosts register into a `ToolRegistry` (e.g.
// `createToolRegistry(createCodingTools(cwd))`). No tools are auto-registered — import what you need.

// --- per-tool factories & types ---

export {
  createShellTool,
  createLocalBashOperations,
  getShellConfig,
  killProcessTree,
  waitForChildProcess,
} from "./shell.js";
export type {
  ShellToolOptions,
  ShellConfig,
  BashOperations,
  BashExecOptions,
  BashSpawnContext,
  BashSpawnHook,
} from "./shell.js";

export {
  createReadTool,
  detectSupportedImageMimeType,
  detectSupportedImageMimeTypeFromFile,
  DEFAULT_MAX_IMAGE_BYTES,
} from "./read.js";
export type {
  ReadToolOptions,
  ReadOperations,
  TransformImage,
  TransformImageInput,
} from "./read.js";

export { createWriteTool } from "./write.js";
export type { WriteToolOptions, WriteOperations } from "./write.js";

export { createEditTool } from "./edit.js";
export type { EditToolOptions, EditOperations, EditToolDetails, Edit } from "./edit.js";

// --- generic primitives (re-exported for hosts that want them) ---

export { withFileMutationQueue } from "./file-mutation-queue.js";
export { enforceExecutionPolicy } from "./execution-policy.js";

// --- aggregators ---

import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import { createShellTool } from "./shell.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import type { ShellToolOptions } from "./shell.js";
import type { ReadToolOptions } from "./read.js";
import type { WriteToolOptions } from "./write.js";
import type { EditToolOptions } from "./edit.js";

/** Per-tool options combined for the aggregator factories. */
export interface ToolsOptions {
  /** Shared execution policy applied to every coding tool unless overridden per tool. */
  executionPolicy?: ExecutionPolicy;
  shell?: ShellToolOptions;
  read?: ReadToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
}

function withSharedExecutionPolicy<T extends { executionPolicy?: ExecutionPolicy }>(
  toolOptions: T | undefined,
  shared?: ExecutionPolicy,
): T {
  if (!shared) return (toolOptions ?? {}) as T;
  return { ...(toolOptions ?? {}), executionPolicy: toolOptions?.executionPolicy ?? shared } as T;
}

/**
 * The four coding tools: `shell`, `read`, `write`, `edit`. Register all of them for a coding agent.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  const policy = options?.executionPolicy;
  return [
    createShellTool(cwd, withSharedExecutionPolicy(options?.shell, policy)),
    createReadTool(cwd, withSharedExecutionPolicy(options?.read, policy)),
    createWriteTool(cwd, withSharedExecutionPolicy(options?.write, policy)),
    createEditTool(cwd, withSharedExecutionPolicy(options?.edit, policy)),
  ];
}

/** Read-only subset: `read` only (this package ships no grep/find/ls). */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  return [createReadTool(cwd, options?.read)];
}

/** Every tool this package provides — identical to {@link createCodingTools} for now. */
export function createAllTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[] {
  return createCodingTools(cwd, options);
}
