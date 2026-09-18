import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createWorkTools } from "../connectors/tools.js";
import type { WorkToolsOptions } from "../connectors/types.js";
import type { DocumentReader } from "../document-reader/index.js";
import { createOfficeTools, type OfficeToolsOptions } from "../tools/office.js";
import type { WorkSandboxFilesystem } from "../tools/filesystem.js";

const TOKEN_ENV = /^(M365_|GOOGLE_)/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOFFICE = /(^|\/)soffice(\.bin)?$/;
const CAPABILITY_KEYS = [
  "workspaceCoherent",
  "filesystemIsolated",
  "networkIsolated",
  "processIsolated",
  "privilegeIsolated",
  "egressRestricted",
] as const;

const EMPTY_CAPABILITIES: WorkSandboxCapabilities = Object.freeze({
  workspaceCoherent: false,
  filesystemIsolated: false,
  networkIsolated: false,
  processIsolated: false,
  privilegeIsolated: false,
  egressRestricted: false,
});

/** Default container env: no token names. Host may add non-token keys via `env`. */
export const DEFAULT_WORK_SANDBOX_ENV: Readonly<Record<string, string>> = Object.freeze({});

export class WorkSandboxError extends Error {
  readonly code = "ERR_PRISM_WORK_SANDBOX";
  constructor(message: string) {
    super(message);
    this.name = "WorkSandboxError";
  }
}

export interface WorkSandboxCapabilities {
  readonly workspaceCoherent: boolean;
  readonly filesystemIsolated: boolean;
  readonly networkIsolated: boolean;
  readonly processIsolated: boolean;
  readonly privilegeIsolated: boolean;
  readonly egressRestricted: boolean;
}

export interface WorkSandboxExecFileRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
  readonly onData?: (chunk: Uint8Array) => void;
}

/** Duck-typed `DisposableSandbox` plus optional filesystem. Host injects; this package does not import coding-tools. */
export interface WorkSandbox {
  readonly capabilities?: Readonly<WorkSandboxCapabilities>;
  readonly root?: string;
  execFile(request: WorkSandboxExecFileRequest): Promise<{ exitCode: number | null }>;
  readFile?(path: string, options: { readonly maxBytes: number; readonly signal?: AbortSignal }): Promise<Uint8Array>;
  writeFile?(path: string, bytes: Uint8Array, options: { readonly maxBytes: number; readonly signal?: AbortSignal }): Promise<void>;
}

export interface WorkCompositionOptions {
  readonly sandbox: WorkSandbox;
  readonly connectors?: WorkToolsOptions;
  readonly office?: OfficeToolsOptions;
  readonly reader?: DocumentReader;
  readonly filesystem?: WorkSandboxFilesystem;
  readonly env?: Readonly<Record<string, string>>;
}

export interface WorkComposition {
  readonly capabilities: WorkSandboxCapabilities;
  readonly env: Readonly<Record<string, string>>;
  readonly sandbox: WorkSandbox;
  readonly reader?: DocumentReader;
  execFile(request: WorkSandboxExecFileRequest): Promise<{ exitCode: number | null }>;
}

export interface WorkCompositionResult {
  readonly tools: readonly ToolDefinition[];
  readonly composition: WorkComposition;
}

export function createWorkComposition(options: WorkCompositionOptions): WorkCompositionResult {
  if (!options?.sandbox || typeof options.sandbox.execFile !== "function") {
    throw new WorkSandboxError("sandbox.execFile is required");
  }
  const env = Object.freeze(assertWorkSandboxEnv(options.env ?? DEFAULT_WORK_SANDBOX_ENV));
  const capabilities = resolveWorkSandboxCapabilities(options.sandbox.capabilities);
  const filesystem = options.filesystem ?? asFilesystem(options.sandbox);
  const execFile = (request: WorkSandboxExecFileRequest) => runWorkExecFile(options.sandbox, request, env);

  const tools: ToolDefinition[] = [
    ...createOfficeTools({ ...options.office, ...(filesystem ? { filesystem } : {}) }),
    workExecTool(execFile),
  ];
  if (options.connectors) {
    tools.push(...createWorkTools({ ...options.connectors, filesystem: options.connectors.filesystem ?? filesystem }));
  }

  return {
    tools,
    composition: {
      capabilities,
      env,
      sandbox: options.sandbox,
      ...(options.reader ? { reader: options.reader } : {}),
      execFile,
    },
  };
}

export function assertWorkSandboxEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_NAME.test(key)) throw new WorkSandboxError(`invalid env name: ${key}`);
    if (TOKEN_ENV.test(key)) throw new WorkSandboxError(`${key} is not allowed in the work sandbox`);
    if (typeof value !== "string") throw new WorkSandboxError(`env value for ${key} must be a string`);
    out[key] = value;
  }
  return out;
}

export function resolveWorkSandboxCapabilities(metadata: Readonly<WorkSandboxCapabilities> | undefined): WorkSandboxCapabilities {
  if (!metadata || typeof metadata !== "object") return EMPTY_CAPABILITIES;
  const keys = Object.keys(metadata);
  if (keys.length !== CAPABILITY_KEYS.length) return EMPTY_CAPABILITIES;
  for (const key of CAPABILITY_KEYS) {
    if (typeof (metadata as Record<string, unknown>)[key] !== "boolean") return EMPTY_CAPABILITIES;
  }
  return Object.freeze({
    workspaceCoherent: metadata.workspaceCoherent,
    filesystemIsolated: metadata.filesystemIsolated,
    networkIsolated: metadata.networkIsolated,
    processIsolated: metadata.processIsolated,
    privilegeIsolated: metadata.privilegeIsolated,
    egressRestricted: metadata.egressRestricted,
  });
}

function asFilesystem(sandbox: WorkSandbox): WorkSandboxFilesystem | undefined {
  if (typeof sandbox.root !== "string" || !sandbox.root.startsWith("/")) return undefined;
  if (typeof sandbox.readFile !== "function" || typeof sandbox.writeFile !== "function") return undefined;
  return sandbox as WorkSandboxFilesystem;
}

async function runWorkExecFile(
  sandbox: WorkSandbox,
  request: WorkSandboxExecFileRequest,
  defaultEnv: Readonly<Record<string, string>>,
): Promise<{ exitCode: number | null }> {
  if (!request.file || request.file.includes("\0")) throw new WorkSandboxError("execFile requires a non-empty file path");
  if (!Array.isArray(request.args) || request.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new WorkSandboxError("execFile args must be a string array without NUL");
  }
  const args = sofficeArgs(request.file, request.args);
  const env = assertWorkSandboxEnv({ ...defaultEnv, ...request.env });
  return sandbox.execFile({ ...request, args, env });
}

function sofficeArgs(file: string, args: readonly string[]): readonly string[] {
  if (!SOFFICE.test(file)) return args;
  if (args.some((arg) => arg.startsWith("--accept") || /macro/i.test(arg))) {
    throw new WorkSandboxError("LibreOffice macro/socket flags are not allowed");
  }
  if (args.some((arg) => arg.startsWith("-env:UserInstallation="))) return args;
  return ["-env:UserInstallation=file:///tmp/lo-profile", "--headless", "--norestore", ...args];
}

function workExecTool(execFile: WorkComposition["execFile"]): ToolDefinition {
  return {
    name: "work_exec",
    description: "Run an argv command inside the injected work sandbox. Results are untrusted.",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
      },
      required: ["file", "args"],
      additionalProperties: false,
    },
    effect: { kind: "external_mutation", idempotency: "unsupported" },
    async execute(args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> {
      try {
        const file = args.file;
        if (typeof file !== "string" || !file) throw new WorkSandboxError("file must be a non-empty string");
        const rawArgs = args.args;
        if (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== "string")) {
          throw new WorkSandboxError("args must be a string array");
        }
        const cwd = args.cwd;
        if (cwd !== undefined && (typeof cwd !== "string" || !cwd.startsWith("/"))) {
          throw new WorkSandboxError("cwd must be an absolute sandbox path");
        }
        const result = await execFile({ file, args: rawArgs as string[], ...(cwd ? { cwd } : {}) });
        return { toolCallId: context.toolCallId, name: "work_exec", value: { exitCode: result.exitCode, untrusted: true } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { toolCallId: context.toolCallId, name: "work_exec", content: [{ type: "text", text: message }], error: { message } };
      }
    },
  };
}
