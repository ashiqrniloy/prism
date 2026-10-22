import type { Decision, HostUi, HostUiRequest, HostUiRequestKind, HostUiResponse, JsonObject, PendingDecision } from "@arnilo/prism";
import type { HostUiRequestParams } from "./protocol.js";

/** One attached client, as `remoteHostUi` sees it. */
export interface RemoteUiConnection {
  /** The client declared `hostUi.secret`. Without it a `secret` request answers `unavailable`. */
  readonly canSecret: boolean;
  /** Partition key of the authenticated principal (`""` for single-principal connections). */
  readonly principalKey?: string;
  /** Whether this connection may answer agent-scoped (`sessionId` absent) host-UI requests. */
  readonly operator?: boolean;
  ask(params: HostUiRequestParams): Promise<HostUiResponse>;
}

interface HostUiBinding {
  readonly byPrincipal: Map<string, RemoteUiConnection[]>;
  readonly operators: RemoteUiConnection[];
  ownerOf?: (sessionId: string) => string | undefined;
}

const UNAVAILABLE: HostUiResponse = { status: "unavailable" };
const bindings = new WeakMap<HostUi, HostUiBinding>();

/**
 * A `HostUi` that asks the connected `prism.remote/1` client. Pass it as the agent's `host.ui` and to
 * `serveAgent(agent, { hostUi: ui })`. With no matching owner/operator client bound, or after the client
 * disconnects mid-request, every request answers `unavailable`: the kernel then suspends the run durably
 * and a later client of the owning principal answers it.
 */
export function remoteHostUi(): HostUi {
  const binding: HostUiBinding = {
    byPrincipal: new Map(),
    operators: [],
  };
  const ui: HostUi = {
    async request<K extends HostUiRequestKind>(request: Extract<HostUiRequest, { kind: K }>): Promise<HostUiResponse<K>> {
      let connection: RemoteUiConnection | undefined;
      if (request.sessionId !== undefined && request.sessionId !== "") {
        const ownerKey = binding.ownerOf ? binding.ownerOf(request.sessionId) : "";
        if (ownerKey === undefined) return UNAVAILABLE as HostUiResponse<K>;
        const list = binding.byPrincipal.get(ownerKey);
        connection = list?.[list.length - 1];
      } else {
        connection = binding.operators[binding.operators.length - 1];
      }
      if (!connection) return UNAVAILABLE as HostUiResponse<K>;
      if (request.kind === "secret" && !connection.canSecret) return UNAVAILABLE as HostUiResponse<K>;
      let answer: HostUiResponse;
      try {
        answer = await connection.ask({
          ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
          request,
        });
      } catch {
        return UNAVAILABLE as HostUiResponse<K>;
      }
      return (validAnswer(request.kind, answer) ? answer : UNAVAILABLE) as HostUiResponse<K>;
    },
  };
  bindings.set(ui, binding);
  return ui;
}

/** Injects the server's session-to-principal resolver into a `remoteHostUi()`. Throws for any other `HostUi`. */
export function bindRemoteHostUiOwner(ui: HostUi, ownerOf: (sessionId: string) => string | undefined): void {
  const binding = bindings.get(ui);
  if (!binding) throw new TypeError("serveAgent hostUi must come from remoteHostUi()");
  binding.ownerOf = ownerOf;
}

/** Attaches a client to a `remoteHostUi`. Returns the detach function. Throws for any other `HostUi`. */
export function bindRemoteHostUi(ui: HostUi, connection: RemoteUiConnection): () => void {
  const binding = bindings.get(ui);
  if (!binding) throw new TypeError("serveAgent hostUi must come from remoteHostUi()");
  const key = connection.principalKey ?? "";
  const isOperator = connection.operator ?? key === "";
  let list = binding.byPrincipal.get(key);
  if (!list) {
    list = [];
    binding.byPrincipal.set(key, list);
  }
  list.push(connection);
  if (isOperator) binding.operators.push(connection);
  return () => {
    const owned = binding.byPrincipal.get(key);
    if (owned) {
      const index = owned.indexOf(connection);
      if (index >= 0) owned.splice(index, 1);
      if (owned.length === 0) binding.byPrincipal.delete(key);
    }
    if (isOperator) {
      const opIndex = binding.operators.indexOf(connection);
      if (opIndex >= 0) binding.operators.splice(opIndex, 1);
    }
  };
}

function validAnswer(kind: HostUiRequestKind, answer: unknown): answer is HostUiResponse {
  if (answer === null || typeof answer !== "object") return false;
  const status = (answer as { status?: unknown }).status;
  if (status === "dismissed" || status === "unavailable") return true;
  if (status !== "answered") return false;
  const value = (answer as { value?: unknown }).value;
  switch (kind) {
    case "confirm":
      return typeof value === "boolean";
    case "input":
      return typeof value === "string";
    case "select":
      return typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"));
    case "terminal":
      return value !== null && typeof value === "object" && Number.isInteger((value as { exitCode?: unknown }).exitCode);
    case "secret":
      return value === undefined || typeof value === "string";
    default:
      return true;
  }
}

/** The request a pending decision becomes when a client reconnects. */
export function requestForPending(sessionId: string, pending: PendingDecision): HostUiRequest {
  if (pending.kind === "elicitation") {
    return {
      kind: "input",
      sessionId,
      title: pending.reason,
      ...(pending.elicitationSchema ? { detail: JSON.stringify(pending.elicitationSchema) } : {}),
    };
  }
  return { kind: "confirm", sessionId, title: `Approve ${pending.scope.toolName ?? "tool call"}`, detail: pending.reason };
}

/**
 * Maps a client's answer to a `Decision`, or `undefined` to leave the decision pending. `dismissed` rejects
 * an approval; an elicitation answer must be a JSON object (the kernel validates it against the schema).
 */
export function decisionFromAnswer(pending: PendingDecision, answer: HostUiResponse): Decision | undefined {
  if (answer.status === "unavailable") return undefined;
  if (pending.kind === "elicitation") {
    if (answer.status !== "answered" || typeof answer.value !== "string") return undefined;
    try {
      const parsed: unknown = JSON.parse(answer.value);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      return { approvalId: pending.approvalId, outcome: "allow_once", elicitation: parsed as JsonObject };
    } catch {
      return undefined;
    }
  }
  if (answer.status === "dismissed") return { approvalId: pending.approvalId, outcome: "reject_once" };
  if (typeof answer.value !== "boolean") return undefined;
  return { approvalId: pending.approvalId, outcome: answer.value ? "allow_once" : "reject_once" };
}
