import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AgentEvent, AgentSession, CommandDefinition, CommandResult, InstructionInjector, JsonObject, ModelConfig, RunOptions } from "./contracts.js";
import type { ContributionRegistry } from "./contributions.js";
import { errorToErrorInfo } from "./redaction.js";
import { resolveInstructionInjectors } from "./instruction-injection.js";

export type RpcCommandName =
  | "prompt"
  | "steer"
  | "followUp"
  | "abort"
  | "state"
  | "messages"
  | "setModel"
  | "compact"
  | "switchSession"
  | "forkSession"
  | "cloneSession"
  | "checkout"
  | "command";

export interface RpcRequest {
  readonly id: string | number;
  readonly command: RpcCommandName;
  readonly params?: Record<string, unknown>;
}

export interface RpcSessionFactory {
  createSession(id?: string): AgentSession;
  readonly commands?: readonly CommandDefinition[];
  /** Optional registry for resolving `instructionInjectors` names in `prompt`/`followUp`
   *  params (Phase 30). Names resolve fail-closed. */
  readonly instructionInjectors?: ContributionRegistry<InstructionInjector>;
}

export interface RpcServerOptions extends RpcSessionFactory {
  readonly stdin: Readable;
  readonly stdout: Writable;
}

interface RpcState {
  current: AgentSession;
  currentHandleId: string;
  model?: ModelConfig;
  readonly sessions: Map<string, AgentSession>;
  readonly commands: Map<string, CommandDefinition>;
  readonly createSession: (id?: string) => AgentSession;
  readonly instructionInjectors?: ContributionRegistry<InstructionInjector>;
}

interface ActiveRun {
  readonly requestId: string | number;
  readonly promise: Promise<void>;
}

export async function runRpcServer(options: RpcServerOptions): Promise<void> {
  const first = options.createSession();
  const state: RpcState = {
    current: first,
    currentHandleId: first.id,
    sessions: new Map([[first.id, first]]),
    commands: new Map((options.commands ?? []).map((command) => [command.name, command])),
    createSession: options.createSession,
    ...(options.instructionInjectors ? { instructionInjectors: options.instructionInjectors } : {}),
  };
  const activeRuns = new Map<string, ActiveRun>();
  const lines = createInterface({ input: options.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let raw: unknown;
    let request: RpcRequest;
    try {
      raw = JSON.parse(line);
      request = parseRpcRequest(raw);
    } catch (error) {
      write(options.stdout, { id: readRequestId(raw), ok: false, error: errorToErrorInfo(error) });
      continue;
    }
    try {
      await handleRequest(request, state, options.stdout, activeRuns);
    } catch (error) {
      write(options.stdout, { id: request.id, ok: false, error: errorToErrorInfo(error) });
    }
  }
  // Await any active runs before returning so callers do not lose final envelopes.
  await Promise.allSettled([...activeRuns.values()].map((run) => run.promise));
}

export function parseRpcRequest(value: unknown): RpcRequest {
  if (!isObject(value)) throw new Error("RPC request must be an object");
  const { id, command, params } = value;
  if (typeof id !== "string" && typeof id !== "number") throw new Error("RPC request id must be a string or number");
  if (!isCommand(command)) throw new Error(`Unknown RPC command: ${String(command)}`);
  if (params !== undefined && !isObject(params)) throw new Error("RPC params must be an object");
  return { id, command, params: params as Record<string, unknown> | undefined };
}

async function handleRequest(request: RpcRequest, state: RpcState, stdout: Writable, activeRuns: Map<string, ActiveRun>): Promise<void> {
  switch (request.command) {
    case "prompt":
    case "followUp": {
      const input = stringParam(request.params, "input") ?? stringParam(request.params, "prompt");
      if (!input) throw new Error(`${request.command} requires params.input`);
      const session = state.current;
      const existing = activeRuns.get(session.id);
      if (existing) {
        write(stdout, { id: request.id, ok: false, error: errorToErrorInfo(new Error(`Session ${session.id} already has an active run for request ${existing.requestId}`)) });
        return;
      }
      // ponytail: Phase 30 — resolve run options (incl. instructionInjectors names) BEFORE opening the
      // event pump. A fail-closed name resolution throws here, surfaces as an error response via the
      // outer try/catch, and never strands the event subscription's for-await.
      const runOpts = runOptions(state, request.params);
      const events = pumpEvents(session, stdout, request.id);
      const promise = (async () => {
        try {
          await session.run(input, runOpts);
        } finally {
          await events;
        }
        write(stdout, { id: request.id, ok: true, result: { sessionId: session.id } });
      })().catch((error) => {
        write(stdout, { id: request.id, ok: false, error: errorToErrorInfo(error) });
      }).finally(() => {
        activeRuns.delete(session.id);
      });
      activeRuns.set(session.id, { requestId: request.id, promise });
      break;
    }
    case "steer": {
      const input = stringParam(request.params, "input") ?? stringParam(request.params, "prompt");
      if (!input) throw new Error("steer requires params.input");
      const softInterrupt = request.params?.softInterrupt === true;
      state.current.steer(input, softInterrupt ? { softInterrupt: true } : undefined);
      write(stdout, {
        id: request.id,
        ok: true,
        result: { sessionId: state.current.id },
      });
      break;
    }
    case "abort":
      state.current.abort(stringParam(request.params, "reason"));
      write(stdout, { id: request.id, ok: true, result: { sessionId: state.current.id } });
      break;
    case "state":
      write(stdout, { id: request.id, ok: true, result: {
        sessionId: state.current.id,
        leafId: state.current.leafId,
        handleId: state.currentHandleId,
        // ponytail: `sessions` kept as a backward-compatible handle-id string list (== sessionId
        // for the initial session and clones); `handles` is the branch-handle detail view.
        sessions: [...state.sessions.keys()],
        handles: [...state.sessions.entries()].map(([handleId, session]) => ({ handleId, sessionId: session.id, leafId: session.leafId })),
        model: state.model,
      } });
      break;
    case "messages":
      write(stdout, { id: request.id, ok: true, result: { sessionId: state.current.id, entries: await state.current.entries() } });
      break;
    case "setModel":
      state.model = modelParam(request.params);
      write(stdout, { id: request.id, ok: true, result: { model: state.model } });
      break;
    case "compact":
      write(stdout, { id: request.id, ok: true, result: await state.current.compact() });
      break;
    case "switchSession": {
      const handleId = stringParam(request.params, "handleId") ?? stringParam(request.params, "sessionId") ?? stringParam(request.params, "id");
      if (!handleId) throw new Error("switchSession requires params.handleId (or sessionId)");
      const session = state.sessions.get(handleId) ?? makeSession(state, handleId);
      state.current = session;
      state.currentHandleId = handleId;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id, leafId: session.leafId, handleId } });
      break;
    }
    case "forkSession": {
      const session = state.current.fork({ leafId: stringParam(request.params, "leafId") });
      const handleId = registerSession(state, session);
      state.current = session;
      state.currentHandleId = handleId;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id, leafId: session.leafId, handleId } });
      break;
    }
    case "cloneSession": {
      const session = await state.current.clone({ id: stringParam(request.params, "id"), leafId: stringParam(request.params, "leafId") });
      const handleId = registerSession(state, session);
      state.current = session;
      state.currentHandleId = handleId;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id, leafId: session.leafId, handleId } });
      break;
    }
    case "checkout": {
      const leafId = stringParam(request.params, "leafId");
      if (!leafId) throw new Error("checkout requires params.leafId");
      await state.current.checkout(leafId);
      write(stdout, { id: request.id, ok: true, result: { sessionId: state.current.id, leafId: state.current.leafId, handleId: state.currentHandleId } });
      break;
    }
    case "command": {
      const name = stringParam(request.params, "name");
      if (!name) throw new Error("command requires params.name");
      const command = state.commands.get(name);
      if (!command) throw new Error(`Unknown command: ${name}`);
      const args = objectParam(request.params, "args") ?? {};
      const result: CommandResult = await command.execute(args as JsonObject, { sessionId: state.current.id });
      write(stdout, { id: request.id, ok: true, result });
      break;
    }
  }
}

function pumpEvents(session: AgentSession, stdout: Writable, requestId: string | number): Promise<void> {
  return (async () => {
    for await (const event of session.subscribe()) write(stdout, eventEnvelope(event, requestId));
  })();
}

function eventEnvelope(event: AgentEvent, requestId: string | number): Record<string, unknown> {
  const sessionId = "sessionId" in event ? event.sessionId : undefined;
  const runId = "runId" in event ? event.runId : undefined;
  return { type: "event", id: requestId, sessionId, runId, event };
}

function registerSession(state: RpcState, session: AgentSession, preferredHandleId?: string): string {
  const base = preferredHandleId ?? session.id;
  // ponytail: branch handles coexist for one sessionId. fork() reuses the sessionId (it is a
  // branch of the same session, not a copy; clone() is the copy), so on collision we mint a
  // stable, self-describing handle id (`{sessionId}#2`, `#3`, ...). Clients switch among handles
  // via the handleId returned by fork/clone/switch; the (sessionId, leafId) pair is read live
  // from the session so it stays accurate as the leaf advances on append/run.
  if (!state.sessions.has(base)) {
    state.sessions.set(base, session);
    return base;
  }
  let n = 2;
  while (state.sessions.has(`${base}#${n}`)) n++;
  const handleId = `${base}#${n}`;
  state.sessions.set(handleId, session);
  return handleId;
}

function makeSession(state: RpcState, id: string): AgentSession {
  const session = state.createSession(id);
  state.sessions.set(session.id, session);
  return session;
}

function runOptions(state: RpcState, params: Record<string, unknown> | undefined): RunOptions {
  const names = stringArrayParam(params, "instructionInjectors");
  // ponytail: fail-closed — unknown name throws (caller surfaces as RPC error), matching CLI.
  const injectors = names.length ? resolveInstructionInjectors({ registry: state.instructionInjectors, names }) : undefined;
  return {
    model: modelParam(params) ?? state.model,
    maxToolRounds: numberParam(params, "maxToolRounds"),
    ...(injectors ? { instructionInjectors: injectors } : {}),
  };
}

function modelParam(params: Record<string, unknown> | undefined): ModelConfig | undefined {
  if (!params) return undefined;
  const model = params.model;
  if (isObject(model) && typeof model.provider === "string" && typeof model.model === "string") return model as unknown as ModelConfig;
  if (typeof model === "string") return { provider: stringParam(params, "provider") ?? "rpc", model };
  return undefined;
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberParam(params: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = params?.[key];
  return typeof value === "number" ? value : undefined;
}

function objectParam(params: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = params?.[key];
  return isObject(value) ? value as Record<string, unknown> : undefined;
}

function stringArrayParam(params: Record<string, unknown> | undefined, key: string): readonly string[] {
  const value = params?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCommand(value: unknown): value is RpcCommandName {
  return typeof value === "string" && ["prompt", "steer", "followUp", "abort", "state", "messages", "setModel", "compact", "switchSession", "forkSession", "cloneSession", "checkout", "command"].includes(value);
}

function readRequestId(value: unknown): string | number | null {
  return isObject(value) && (typeof value.id === "string" || typeof value.id === "number") ? value.id : null;
}

function write(stdout: Writable, value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`);
}
