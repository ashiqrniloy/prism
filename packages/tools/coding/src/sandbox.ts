/**
 * Config-selected sandbox backend for the shell and file operations.
 *
 * `none` (default) runs locally. `native` builds the in-repo `unshare` backend. `e2b` is reached
 * only through `createE2BSandbox`, which imports the optional `e2b` peer dynamically. `docker`
 * needs a host-provided digest-pinned image and runner, which a JSON config cannot carry, so it
 * fails closed. Any backend that cannot be built yields a warning and no `shell` registration —
 * never a throw and never a silent unsandboxed shell.
 */
import { resolve } from "node:path";
import type { ToolDefinition } from "@arnilo/prism";
import type { ProcessSandboxBackend } from "./agent/process/types.js";
import type { RepositoryLimitOptions } from "./agent/repository/types.js";
import { createE2BSandbox } from "./security/e2b-sandbox.js";
import { createNativeSandbox } from "./security/native-sandbox.js";
import type { SandboxAdapter } from "./security/sandbox.js";
import { createSandboxCodingComposition, createSandboxReadOnlyComposition } from "./security/sandbox-coding-operations.js";

export type CodingSandboxKind = "none" | "native" | "docker" | "e2b";

export interface SelectCodingSandboxOptions {
  readonly root: string;
  readonly repository?: RepositoryLimitOptions;
  readonly readOnly: boolean;
}

export interface SelectedCodingSandbox {
  /** Sandbox-backed tools, or absent when the backend could not be built. */
  readonly tools?: readonly ToolDefinition[];
  /** The cwd the tools operate in (`/workspace` for container backends, the host root for native). */
  readonly toolRoot: string;
  /**
   * The same adapter when it can start a long-running process (plan 189 Task 9). Absent means
   * `background` stays out of the `shell` schema and `shell_output` is not registered — the
   * native backend implements one-shot exec only.
   */
  readonly processes?: ProcessSandboxBackend;
  readonly warnings: readonly string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function buildAdapter(kind: Exclude<CodingSandboxKind, "none">, root: string): Promise<SandboxAdapter> {
  if (kind === "native") return createNativeSandbox({ root: resolve(root) });
  if (kind === "e2b") return createE2BSandbox({});
  throw new Error('sandbox "docker" needs a host-provided digest-pinned image and docker runner');
}

/** Build the selected backend. Never throws: a failure becomes a warning and no tools. */
export async function selectCodingSandbox(
  kind: Exclude<CodingSandboxKind, "none">,
  options: SelectCodingSandboxOptions,
): Promise<SelectedCodingSandbox> {
  let adapter: SandboxAdapter;
  try {
    adapter = await buildAdapter(kind, options.root);
  } catch (error) {
    return { toolRoot: resolve(options.root), warnings: [`sandbox "${kind}" unavailable: ${message(error)}; shell is not registered`] };
  }
  // Native's sandbox root IS the host workspace; container backends observe `/workspace`.
  const workspaceRoot = kind === "native" ? resolve(options.root) : undefined;
  try {
    const composition = options.readOnly
      ? createSandboxReadOnlyComposition(options.root, {
          workspaceMode: "sandbox",
          sandbox: adapter,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          repository: options.repository,
        })
      : createSandboxCodingComposition(options.root, {
          workspaceMode: "sandbox",
          sandbox: adapter,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          repository: options.repository,
        });
    const processes =
      typeof (adapter as ProcessSandboxBackend).startProcess === "function" ? (adapter as ProcessSandboxBackend) : undefined;
    return {
      tools: composition.tools,
      toolRoot: workspaceRoot ?? "/workspace",
      ...(processes !== undefined ? { processes } : {}),
      warnings: [...composition.composition.warnings],
    };
  } catch (error) {
    return {
      toolRoot: resolve(options.root),
      warnings: [`sandbox "${kind}" could not be wired: ${message(error)}; shell is not registered`],
    };
  }
}
