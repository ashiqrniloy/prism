import type { AgentInput, ExternalActivity, JsonSchema, JsonValue, Message, RunController, ToolDefinition } from "@arnilo/prism";
import {
  assertDriverDescriptor,
  type DriverDescriptor,
  type DriverRunContext,
  type ExternalAgentSpec,
  type HookCodec,
  type LimitSignal,
  type MaterializedFile,
  type MaterializedSkills,
  type McpEndpoint,
  type ParseStatus,
  type RunDirectory,
  type ToolBridge,
} from "@arnilo/prism/driver-kit";
import { ProcessDriverError } from "./errors.js";

export type RelayAnswer = ReturnType<HookCodec["encode"]>;

export interface ProcessDriverConfig {
  readonly binary?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly capture?: "mapped" | "all";
  readonly graceMs?: number;
}
export interface EncodeContext {
  readonly sessionId?: string;
  readonly turnId?: string;
}
export interface RpcFrame {
  readonly method: string;
  readonly params?: JsonValue;
  readonly notify?: boolean;
  readonly onResult?: (result: JsonValue) => Decoded | undefined;
}
export type OutboundFrame = JsonValue | RpcFrame;
export interface Decoded {
  readonly activity: readonly ExternalActivity[];
  readonly turnEnd?: boolean;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly stop?: string | true;
  readonly unmapped?: boolean;
}
export interface LaunchPlan {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: readonly MaterializedFile[];
  readonly overlays?: readonly MaterializedFile[];
}
export type RestorePlan = LaunchPlan;
export interface SessionContext extends EncodeContext {
  readonly runDir: RunDirectory;
  readonly home: string;
  readonly cwd: string;
}
export interface ResumeContext {
  readonly entries: readonly JsonValue[];
  readonly sessionId?: string;
  readonly args?: readonly string[];
}
export interface ConfigureContext extends SessionContext {
  readonly resume: ResumeContext;
  readonly hook: { readonly argv: readonly string[]; readonly command: string };
  readonly endpoint?: McpEndpoint;
  readonly skills?: MaterializedSkills;
}
export interface OpenContext extends EncodeContext {
  readonly resume: ResumeContext;
  readonly tools: readonly ToolDefinition[];
}
export interface RequestContext extends EncodeContext {
  readonly params: JsonValue;
  readonly bridge: ToolBridge;
  readonly ask: RunController["ask"];
  readonly run: RunController;
  readonly host: DriverRunContext["host"];
  readonly tools: readonly ToolDefinition[];
}
export type RequestHandler = (ctx: RequestContext) => JsonValue | Promise<JsonValue>;
export type AbortStep =
  | { readonly rpc: string; readonly params?: (ctx: EncodeContext) => JsonValue }
  | { readonly closeStdin: true }
  | { readonly signal: "SIGINT" | "SIGTERM" };

export interface AdapterIdentity {
  readonly name: string;
  readonly revision: string;
  readonly extends?: AdapterIdentity;
}

export interface AgentAdapter {
  readonly extends?: AdapterIdentity;
  readonly name: string;
  readonly revision: string;
  readonly descriptor: DriverDescriptor;
  readonly transport: "jsonl-stream" | "json-rpc";
  readonly vendor?: JsonSchema;
  readonly binary: {
    readonly command: readonly string[];
    readonly versionArgs?: readonly string[];
    version(stdout: string): string | undefined;
  };
  readonly profile: { readonly parseStatus: ParseStatus };
  configure(spec: ExternalAgentSpec, ctx: ConfigureContext): LaunchPlan | Promise<LaunchPlan>;
  open?(ctx: OpenContext): readonly OutboundFrame[];
  readonly encode: {
    prompt(input: AgentInput, ctx: EncodeContext): OutboundFrame;
    steer?(message: Message, ctx: EncodeContext): OutboundFrame;
    continue?(reason: string, ctx: EncodeContext): OutboundFrame;
  };
  decode(frame: JsonValue): Decoded;
  readonly hooks?: { readonly codec: HookCodec; readonly failClosed: RelayAnswer; readonly timeoutMs?: number };
  readonly permissionTool?: string;
  readonly requests?: Readonly<Record<string, RequestHandler>>;
  readonly session: {
    readonly strategy: "store" | "vendor" | "none";
    archive?(ctx: SessionContext): Promise<JsonValue[]>;
    restore?(entries: readonly JsonValue[], ctx: SessionContext): Promise<RestorePlan>;
  };
  readonly abort: readonly AbortStep[];
  notices?(activity: ExternalActivity): LimitSignal | undefined;
}

export function assertAdapter(adapter: AgentAdapter): void {
  const bad = (member: string): never => {
    throw new ProcessDriverError("adapter_invalid", `adapter.${member} is invalid`);
  };
  if (!adapter || typeof adapter !== "object") bad("name");
  for (const member of ["name", "revision"] as const) if (typeof adapter[member] !== "string" || !adapter[member].trim()) bad(member);
  if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(adapter.name)) bad("name");
  try {
    assertDriverDescriptor(adapter.descriptor);
  } catch {
    bad("descriptor");
  }
  if (!adapter.descriptor.controls || !adapter.descriptor.capture) bad("descriptor");
  if (!["jsonl-stream", "json-rpc"].includes(adapter.transport)) bad("transport");
  if (
    !Array.isArray(adapter.binary?.command) ||
    !adapter.binary.command.length ||
    adapter.binary.command.some((part) => typeof part !== "string" || !part) ||
    typeof adapter.binary.version !== "function"
  )
    bad("binary");
  if (
    adapter.binary.versionArgs !== undefined &&
    (!Array.isArray(adapter.binary.versionArgs) || adapter.binary.versionArgs.some((part) => typeof part !== "string"))
  )
    bad("binary.versionArgs");
  if (typeof adapter.profile?.parseStatus !== "function") bad("profile");
  if (typeof adapter.configure !== "function") bad("configure");
  if (typeof adapter.encode?.prompt !== "function") bad("encode.prompt");
  if (typeof adapter.decode !== "function") bad("decode");
  for (const member of ["open", "notices"] as const)
    if (adapter[member] !== undefined && typeof adapter[member] !== "function") bad(member);
  if (
    !Array.isArray(adapter.abort) ||
    adapter.abort.some(
      (step) =>
        !step ||
        typeof step !== "object" ||
        !(
          ("rpc" in step && typeof step.rpc === "string") ||
          ("closeStdin" in step && step.closeStdin === true) ||
          ("signal" in step && ["SIGINT", "SIGTERM"].includes(step.signal))
        ),
    )
  )
    bad("abort");
  if (
    !adapter.session ||
    !["store", "vendor", "none"].includes(adapter.session.strategy) ||
    adapter.session.strategy !== adapter.descriptor.controls.resume
  )
    bad("session.strategy");
  if (adapter.transport === "jsonl-stream" && adapter.requests !== undefined) bad("requests");
  if (adapter.transport === "jsonl-stream" && adapter.abort.some((step) => "rpc" in step)) bad("abort");
  if (
    adapter.session.strategy === "store" &&
    (typeof adapter.session.archive !== "function" || typeof adapter.session.restore !== "function")
  )
    bad("session");
  if (adapter.requests && Object.values(adapter.requests).some((handler) => typeof handler !== "function")) bad("requests");
  if (adapter.permissionTool !== undefined && (typeof adapter.permissionTool !== "string" || !adapter.permissionTool))
    bad("permissionTool");
  if (
    adapter.hooks &&
    (typeof adapter.hooks.codec?.decode !== "function" ||
      typeof adapter.hooks.codec?.encode !== "function" ||
      !Number.isInteger(adapter.hooks.failClosed?.exitCode) ||
      adapter.hooks.failClosed.exitCode < 0 ||
      adapter.hooks.failClosed.exitCode > 255 ||
      typeof adapter.hooks.failClosed.stdout !== "string" ||
      (adapter.hooks.timeoutMs !== undefined && (!Number.isFinite(adapter.hooks.timeoutMs) || adapter.hooks.timeoutMs <= 0)))
  )
    bad("hooks");
  if (
    adapter.descriptor.controls.permissionCallback &&
    !adapter.hooks &&
    !Object.keys(adapter.requests ?? {}).length &&
    !adapter.permissionTool
  )
    bad("descriptor.controls.permissionCallback");
}

/** Hook settings take a shell command, so quote every argument including empty ones. */
export function quoteCommand(argv: readonly string[]): string {
  return argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
}
