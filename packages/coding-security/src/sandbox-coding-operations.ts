/**
 * One construction path for coding tools with an explicit workspace mode.
 *
 * `workspaceMode` is required. Sandbox shell + host FS is fail-closed unless
 * `allowMixedWorkspaceWiring` is set. Sandbox mode needs agreeing FS/repo
 * backends (host-supplied custom ops, or DisposableSandbox auto-wire).
 *
 * Git/check stay opt-in: `createGitTools(composition.workspaceRoot, {
 *   execFile: sandbox.execFile.bind(sandbox), commitIdentity, checks?
 * })` so runners share the same tree/cwd. Not folded into coding tools.
 */
import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import {
  createCodingTools,
  createReadOnlyTools,
  type EditOperations,
  type EditToolOptions,
  type ListToolOptions,
  type ReadOperations,
  type ReadToolOptions,
  type SearchToolOptions,
  type ShellToolOptions,
  type ToolsOptions,
  type WriteOperations,
  type WriteToolOptions,
  type RepositoryLimitOptions,
  type RepositoryOperations,
} from "@arnilo/prism-coding-agent";
import {
  createSandboxBashOperations,
  type DisposableSandbox,
  type SandboxAdapter,
  type SandboxExportMetadata,
} from "./sandbox.js";
import {
  createSandboxFilesystemOperations,
  createSandboxRepositoryOperations,
} from "./sandbox-fs-operations.js";

export type WorkspaceMode = "host" | "sandbox";

export interface SandboxCodingComposition {
  readonly workspaceMode: WorkspaceMode;
  readonly containmentClaim: boolean;
  readonly mixedWiringAllowed: boolean;
  readonly warnings: readonly string[];
  readonly workspaceRoot: string;
  readonly treeIdentity?: Pick<SandboxExportMetadata, "sha256" | "entryCount" | "byteCount">;
}

export interface SandboxCodingCompositionResult {
  readonly tools: readonly ToolDefinition[];
  readonly composition: SandboxCodingComposition;
}

export interface SandboxCodingToolsOptions {
  readonly workspaceMode: WorkspaceMode;
  /** Required for `workspaceMode: "sandbox"`. Optional in host mode (preferred: omit). */
  readonly sandbox?: SandboxAdapter;
  /**
   * Escape hatch: allow sandbox shell paired with host-local FS/list/search backends.
   * Surfaces warnings on composition; forces `containmentClaim: false`.
   */
  readonly allowMixedWorkspaceWiring?: boolean;
  /** Sandbox tree root for mode `"sandbox"` (default `/workspace`). */
  readonly workspaceRoot?: string;
  readonly executionPolicy?: ExecutionPolicy;
  readonly repository?: RepositoryLimitOptions & { operations?: RepositoryOperations };
  readonly shell?: Omit<ShellToolOptions, "operations">;
  readonly read?: ReadToolOptions;
  readonly write?: WriteToolOptions;
  readonly edit?: EditToolOptions;
  readonly list?: ListToolOptions;
  readonly search?: SearchToolOptions;
}

export class SandboxCodingCompositionError extends Error {
  readonly code = "ERR_PRISM_SANDBOX_CODING_COMPOSITION";
  constructor(message: string) {
    super(message);
    this.name = "SandboxCodingCompositionError";
  }
}

const DEFAULT_SANDBOX_WORKSPACE_ROOT = "/workspace";
const MIXED_WIRING_WARNING =
  "mixed workspace wiring: sandbox shell with host filesystem backends; containment not claimed";

function isDisposableSandbox(sandbox: SandboxAdapter): sandbox is DisposableSandbox {
  const candidate = sandbox as DisposableSandbox;
  return typeof candidate.execFile === "function" && typeof candidate.close === "function";
}

function treeIdentityFromSandbox(
  sandbox: SandboxAdapter | undefined,
): Pick<SandboxExportMetadata, "sha256" | "entryCount" | "byteCount"> | undefined {
  if (!sandbox || !isDisposableSandbox(sandbox)) return undefined;
  const id = sandbox.importIdentity ?? sandbox.lastExportIdentity;
  if (!id) return undefined;
  return { sha256: id.sha256, entryCount: id.entryCount, byteCount: id.byteCount };
}

function hasCustomOperations(
  options: SandboxCodingToolsOptions,
  kind: "full" | "readonly",
): boolean {
  const repoOps = options.repository?.operations ?? options.list?.operations ?? options.search?.operations;
  const readOk = options.read?.operations !== undefined;
  const repoOk = repoOps !== undefined;
  if (kind === "readonly") return readOk && repoOk;
  return (
    readOk &&
    options.write?.operations !== undefined &&
    options.edit?.operations !== undefined &&
    repoOk
  );
}

/**
 * Auto-wire DisposableSandbox execFile backends for sandbox mode.
 */
function tryAutoWireSandboxTreeOperations(
  sandbox: DisposableSandbox,
  workspaceRoot: string,
  repositoryLimits?: RepositoryLimitOptions,
): {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  repository: RepositoryOperations;
} {
  const fs = createSandboxFilesystemOperations(sandbox, { workspaceRoot });
  const repository = createSandboxRepositoryOperations(sandbox, {
    workspaceRoot,
    limits: repositoryLimits,
  });
  return {
    read: fs.read,
    write: fs.write,
    edit: fs.edit,
    repository,
  };
}

function requireWorkspaceMode(options: SandboxCodingToolsOptions): WorkspaceMode {
  const mode = options.workspaceMode;
  if (mode !== "host" && mode !== "sandbox") {
    throw new SandboxCodingCompositionError(
      'workspaceMode is required and must be "host" or "sandbox"',
    );
  }
  return mode;
}

function resolveComposition(
  cwd: string,
  options: SandboxCodingToolsOptions,
  kind: "full" | "readonly",
): { toolsOptions: ToolsOptions; composition: SandboxCodingComposition; toolCwd: string } {
  const workspaceMode = requireWorkspaceMode(options);
  const mixedWiringAllowed = options.allowMixedWorkspaceWiring === true;
  const warnings: string[] = [];
  const sandbox = options.sandbox;

  if (workspaceMode === "host") {
    const workspaceRoot = cwd;
    const sandboxShell = sandbox !== undefined && kind === "full";
    if (sandboxShell && !mixedWiringAllowed) {
      throw new SandboxCodingCompositionError(
        "host mode with sandbox shell uses host filesystem backends (mixed wiring); " +
          "set allowMixedWorkspaceWiring: true or omit sandbox for local shell",
      );
    }
    if (sandboxShell) warnings.push(MIXED_WIRING_WARNING);

    const toolsOptions: ToolsOptions = {
      executionPolicy: options.executionPolicy,
      repository: options.repository,
      shell: sandboxShell
        ? { ...options.shell, operations: createSandboxBashOperations(sandbox) }
        : options.shell,
      read: options.read,
      write: options.write,
      edit: options.edit,
      list: options.list,
      search: options.search,
    };

    return {
      toolsOptions,
      toolCwd: cwd,
      composition: {
        workspaceMode,
        containmentClaim: false,
        mixedWiringAllowed,
        warnings,
        workspaceRoot,
      },
    };
  }

  // sandbox mode
  if (!sandbox) {
    throw new SandboxCodingCompositionError('workspaceMode "sandbox" requires options.sandbox');
  }

  const workspaceRoot = options.workspaceRoot ?? DEFAULT_SANDBOX_WORKSPACE_ROOT;
  let readOps = options.read?.operations;
  let writeOps = options.write?.operations;
  let editOps = options.edit?.operations;
  let repoOps = options.repository?.operations ?? options.list?.operations ?? options.search?.operations;
  let backendsBound = hasCustomOperations(options, kind);

  if (!backendsBound) {
    if (mixedWiringAllowed) {
      // Explicit split-brain: sandbox shell + host-local FS defaults.
      warnings.push(MIXED_WIRING_WARNING);
    } else if (!isDisposableSandbox(sandbox)) {
      throw new SandboxCodingCompositionError(
        'workspaceMode "sandbox" requires DisposableSandbox (execFile) for auto-wire, ' +
          "custom read/write/edit/repository operations, or allowMixedWorkspaceWiring: true",
      );
    } else {
      const auto = tryAutoWireSandboxTreeOperations(sandbox, workspaceRoot, options.repository);
      readOps = auto.read;
      writeOps = auto.write;
      editOps = auto.edit;
      repoOps = auto.repository;
      backendsBound = true;
    }
  }

  const toolsOptions: ToolsOptions = {
    executionPolicy: options.executionPolicy,
    repository: {
      ...options.repository,
      ...(repoOps ? { operations: repoOps } : {}),
    },
    shell: {
      ...options.shell,
      operations: createSandboxBashOperations(sandbox),
    },
    read: { ...options.read, ...(readOps ? { operations: readOps } : {}) },
    write: { ...options.write, ...(writeOps ? { operations: writeOps } : {}) },
    edit: { ...options.edit, ...(editOps ? { operations: editOps } : {}) },
    list: options.list,
    search: options.search,
  };

  const containmentClaim = backendsBound && !mixedWiringAllowed && warnings.length === 0;
  // Bound sandbox backends observe the container tree — tools must resolve under workspaceRoot.
  const toolCwd = backendsBound ? workspaceRoot : cwd;
  const treeIdentity = treeIdentityFromSandbox(sandbox);

  return {
    toolsOptions,
    toolCwd,
    composition: {
      workspaceMode,
      containmentClaim,
      mixedWiringAllowed,
      warnings,
      workspaceRoot,
      ...(treeIdentity ? { treeIdentity } : {}),
    },
  };
}

/** Authoritative construction path: tools plus composition metadata. */
export function createSandboxCodingComposition(
  cwd: string,
  options: SandboxCodingToolsOptions,
): SandboxCodingCompositionResult {
  const { toolsOptions, composition, toolCwd } = resolveComposition(cwd, options, "full");
  return {
    tools: createCodingTools(toolCwd, toolsOptions),
    composition,
  };
}

/** Read-only construction path with the same workspace-mode contract. */
export function createSandboxReadOnlyComposition(
  cwd: string,
  options: SandboxCodingToolsOptions,
): SandboxCodingCompositionResult {
  const { toolsOptions, composition, toolCwd } = resolveComposition(cwd, options, "readonly");
  return {
    tools: createReadOnlyTools(toolCwd, toolsOptions),
    composition,
  };
}

/** Full coding set; returns tools only (compat wrapper). */
export function createSandboxCodingTools(
  cwd: string,
  options: SandboxCodingToolsOptions,
): readonly ToolDefinition[] {
  return createSandboxCodingComposition(cwd, options).tools;
}

/** Read-only coding set; returns tools only (compat wrapper). */
export function createSandboxReadOnlyTools(
  cwd: string,
  options: SandboxCodingToolsOptions,
): readonly ToolDefinition[] {
  return createSandboxReadOnlyComposition(cwd, options).tools;
}
