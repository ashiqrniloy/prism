/**
 * One construction path that wires coding tools to a host-owned sandbox adapter.
 *
 * Shell delegates through `createSandboxBashOperations`. Filesystem tools
 * (`read`/`write`/`edit`/`repo_list`/`repo_search`) keep the supplied host `cwd`
 * and local/custom operation backends — the Docker reference keeps workspace
 * mutations inside the container until export, so hosts that need FS tools to
 * observe container state must supply custom operations or a shared mount.
 */
import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import {
  createCodingTools,
  createReadOnlyTools,
  type EditToolOptions,
  type ListToolOptions,
  type ReadToolOptions,
  type SearchToolOptions,
  type ShellToolOptions,
  type ToolsOptions,
  type WriteToolOptions,
  type RepositoryLimitOptions,
  type RepositoryOperations,
} from "@arnilo/prism-coding-agent";
import { createSandboxBashOperations, type SandboxAdapter } from "./sandbox.js";

export interface SandboxCodingToolsOptions {
  readonly sandbox: SandboxAdapter;
  readonly executionPolicy?: ExecutionPolicy;
  readonly repository?: RepositoryLimitOptions & { operations?: RepositoryOperations };
  /** Shell options excluding `operations` (always wired to the sandbox adapter). */
  readonly shell?: Omit<ShellToolOptions, "operations">;
  readonly read?: ReadToolOptions;
  readonly write?: WriteToolOptions;
  readonly edit?: EditToolOptions;
  readonly list?: ListToolOptions;
  readonly search?: SearchToolOptions;
}

function toToolsOptions(options: SandboxCodingToolsOptions): ToolsOptions {
  return {
    executionPolicy: options.executionPolicy,
    repository: options.repository,
    shell: {
      ...options.shell,
      operations: createSandboxBashOperations(options.sandbox),
    },
    read: options.read,
    write: options.write,
    edit: options.edit,
    list: options.list,
    search: options.search,
  };
}

/** Full coding set with shell operations delegated to `options.sandbox`. */
export function createSandboxCodingTools(
  cwd: string,
  options: SandboxCodingToolsOptions,
): readonly ToolDefinition[] {
  return createCodingTools(cwd, toToolsOptions(options));
}

/** Read-only coding set (`read`/`repo_list`/`repo_search`) sharing repository options. */
export function createSandboxReadOnlyTools(
  cwd: string,
  options: SandboxCodingToolsOptions,
): readonly ToolDefinition[] {
  return createReadOnlyTools(cwd, toToolsOptions(options));
}
