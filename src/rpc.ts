import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AgentEvent, AgentSession, CommandDefinition, CommandResult, JsonObject, ModelConfig, RunOptions } from "./contracts.js";
import { errorToErrorInfo } from "./redaction.js";

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
  | "command";

export interface RpcRequest {
  readonly id: string | number;
  readonly command: RpcCommandName;
  readonly params?: Record<string, unknown>;
}

export interface RpcSessionFactory {
  createSession(id?: string): AgentSession;
  readonly commands?: readonly CommandDefinition[];
}

export interface RpcServerOptions extends RpcSessionFactory {
  readonly stdin: Readable;
  readonly stdout: Writable;
}

interface RpcState {
  current: AgentSession;
  model?: ModelConfig;
  readonly sessions: Map<string, AgentSession>;
  readonly commands: Map<string, CommandDefinition>;
  readonly createSession: (id?: string) => AgentSession;
}

export async function runRpcServer(options: RpcServerOptions): Promise<void> {
  const first = options.createSession();
  const state: RpcState = {
    current: first,
    sessions: new Map([[first.id, first]]),
    commands: new Map((options.commands ?? []).map((command) => [command.name, command])),
    createSession: options.createSession,
  };
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
      await handleRequest(request, state, options.stdout);
    } catch (error) {
      write(options.stdout, { id: request.id, ok: false, error: errorToErrorInfo(error) });
    }
  }
}

export function parseRpcRequest(value: unknown): RpcRequest {
  if (!isObject(value)) throw new Error("RPC request must be an object");
  const { id, command, params } = value;
  if (typeof id !== "string" && typeof id !== "number") throw new Error("RPC request id must be a string or number");
  if (!isCommand(command)) throw new Error(`Unknown RPC command: ${String(command)}`);
  if (params !== undefined && !isObject(params)) throw new Error("RPC params must be an object");
  return { id, command, params: params as Record<string, unknown> | undefined };
}

async function handleRequest(request: RpcRequest, state: RpcState, stdout: Writable): Promise<void> {
  switch (request.command) {
    case "prompt":
    case "followUp": {
      const input = stringParam(request.params, "input") ?? stringParam(request.params, "prompt");
      if (!input) throw new Error(`${request.command} requires params.input`);
      const session = state.current;
      const events = pumpEvents(session, stdout, request.id);
      await session.run(input, runOptions(state, request.params));
      await events;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id } });
      break;
    }
    case "steer":
      throw new Error("steer is not supported by the current AgentSession runtime");
    case "abort":
      state.current.abort(stringParam(request.params, "reason"));
      write(stdout, { id: request.id, ok: true, result: { sessionId: state.current.id } });
      break;
    case "state":
      write(stdout, { id: request.id, ok: true, result: { sessionId: state.current.id, sessions: [...state.sessions.keys()], model: state.model } });
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
      const id = stringParam(request.params, "sessionId") ?? stringParam(request.params, "id");
      if (!id) throw new Error("switchSession requires params.sessionId");
      const session = state.sessions.get(id) ?? makeSession(state, id);
      state.current = session;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id } });
      break;
    }
    case "forkSession": {
      const session = state.current.fork({ leafId: stringParam(request.params, "leafId") });
      state.sessions.set(session.id, session);
      state.current = session;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id } });
      break;
    }
    case "cloneSession": {
      const session = await state.current.clone({ id: stringParam(request.params, "id"), leafId: stringParam(request.params, "leafId") });
      state.sessions.set(session.id, session);
      state.current = session;
      write(stdout, { id: request.id, ok: true, result: { sessionId: session.id } });
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

function makeSession(state: RpcState, id: string): AgentSession {
  const session = state.createSession(id);
  state.sessions.set(session.id, session);
  return session;
}

function runOptions(state: RpcState, params: Record<string, unknown> | undefined): RunOptions {
  return { model: modelParam(params) ?? state.model, maxToolRounds: numberParam(params, "maxToolRounds") };
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCommand(value: unknown): value is RpcCommandName {
  return typeof value === "string" && ["prompt", "steer", "followUp", "abort", "state", "messages", "setModel", "compact", "switchSession", "forkSession", "cloneSession", "command"].includes(value);
}

function readRequestId(value: unknown): string | number | null {
  return isObject(value) && (typeof value.id === "string" || typeof value.id === "number") ? value.id : null;
}

function write(stdout: Writable, value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`);
}
