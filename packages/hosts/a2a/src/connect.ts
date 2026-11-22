import { randomUUID } from "node:crypto";
import {
  type Agent,
  type AgentEvent,
  type AgentInspection,
  type CredentialResolver,
  createEnvRefCredentialResolver,
  type EventOrigin,
  type HostUi,
  type JsonObject,
} from "@arnilo/prism";
import { defaultResolver, isLoopbackHostname, pinnedFetch, resolvePinnedAddress } from "@arnilo/prism/net";
import { type A2AAgentCard, type PeerCard, readPeerCard } from "./card.js";
import { A2A_CARD_PATH, A2A_PROTOCOL_VERSION, type A2AStreamResponse, isA2AId, parseA2AStreamResponse } from "./codec.js";
import { A2AClientError, A2AError, a2aErrorNameOf, A2ALiteralSecretError } from "./errors.js";
import { type A2ALimitOptions, type ResolvedA2ALimits, resolveA2ALimits } from "./limits.js";
import { createA2ASession, type A2AContextState, type A2ASessionHandle } from "./proxy.js";

/** The peer to connect to. */
export interface A2AEndpoint {
  /**
   * The peer's Agent Card URL, or any URL on the peer's origin: unless the path ends in `agent-card.json`,
   * the card is read from that origin's `/.well-known/agent-card.json`.
   */
  readonly url: string;
  /** `env:` / `keyring:` ref to a Bearer token, sent only to the card's JSON-RPC endpoint. A literal throws. */
  readonly token?: string;
  /** A card the host already holds (no card fetch). It is validated exactly as a fetched one. */
  readonly card?: A2AAgentCard;
}

export interface ConnectA2AOptions {
  /**
   * Answers the peer's `TASK_STATE_INPUT_REQUIRED` decisions (a `confirm` per approval, an `input` per
   * elicitation) and continues the task in the same run. Without it, or when it answers `unavailable`, the
   * run settles `suspended` with `pending`, and `session.resume(decisions)` sends the answers.
   */
  readonly host?: { readonly ui?: HostUi };
  /** Uses `maxRequestBytes`, `maxResponseBytes`, `maxStreamBytes`, `maxStreamEvents`, `maxStreamMs`, `taskTimeoutMs`, `maxParts`. */
  readonly limits?: A2ALimitOptions;
  /** Allow an `http:` or `https:` loopback peer (local development, tests). Every other private address is refused. */
  readonly allowLoopback?: boolean;
  /** More origins the card's JSON-RPC endpoint may be on. By default it must be the card URL's origin. */
  readonly allowedOrigins?: readonly string[];
  /** Resolves `token`. Defaults to the kernel `env:` resolver. */
  readonly credentials?: CredentialResolver;
  /** `origin.remote` on forwarded events. Defaults to the endpoint's origin. */
  readonly endpointId?: string;
}

/** The JSON-RPC calls a session proxy makes. Every call sends `A2A-Version: 1.0`. */
export interface A2ATransport {
  call(method: string, params: JsonObject, signal?: AbortSignal): Promise<unknown>;
  /** One SSE response. It ends when the peer closes it, or quietly at `maxStreamMs`. */
  stream(method: string, params: JsonObject, signal?: AbortSignal): AsyncGenerator<A2AStreamResponse>;
}

const MAX_CARD_BYTES = 1024 * 1024;
const CARD_TIMEOUT_MS = 30_000;
const MAX_ERROR_TEXT = 512;

const unsupported = (what: string): A2AClientError => new A2AClientError("a2a_unsupported", `${what} is not supported on an A2A agent`);

/**
 * Connects to an A2A 1.0 agent over JSON-RPC and returns an `Agent` proxy, usable wherever an `Agent` goes
 * (`agentNode({ agent })`, a host's session loop). One A2A context is one proxy session; one task is one run.
 * Forwarded events carry `origin: { kind: "external", executedBy: "external" }`: the peer ran the work, so no
 * local hook gated it. Every request is DNS-pinned and SSRF-checked (`@arnilo/prism/net`) and byte-bounded.
 */
export async function connectA2A(endpoint: A2AEndpoint, options: ConnectA2AOptions = {}): Promise<Agent> {
  const limits = resolveA2ALimits(options.limits);
  const allowLoopback = options.allowLoopback === true;
  if (endpoint.token !== undefined && !/^(?:env|keyring):.+$/.test(endpoint.token)) throw new A2ALiteralSecretError("token");
  let url: URL;
  try {
    url = new URL(endpoint.url);
  } catch {
    throw new A2AClientError("a2a_transport", "endpoint url is invalid");
  }
  const allowedOrigins = new Set<string>();
  for (const origin of options.allowedOrigins ?? []) {
    try {
      allowedOrigins.add(new URL(origin).origin);
    } catch {
      throw new A2AClientError("a2a_transport", "allowedOrigins holds an invalid url");
    }
  }

  const cardUrl = endpoint.card || /agent-card\.json$/.test(url.pathname) ? url : new URL(A2A_CARD_PATH, url.origin);
  const peer: PeerCard = readPeerCard(endpoint.card ?? (await fetchCard(cardUrl, allowLoopback)), cardUrl, allowedOrigins);
  await checkUrl(peer.endpoint, allowLoopback);

  let token: string | undefined;
  if (endpoint.token !== undefined) {
    const resolver = options.credentials ?? createEnvRefCredentialResolver();
    let secret: { readonly value?: string } | undefined;
    try {
      secret = (await resolver.resolve(endpoint.token, { package: "@arnilo/prism-hosts/a2a" })) as { value?: string } | undefined;
    } catch {
      secret = undefined;
    }
    if (!secret?.value) throw new A2AClientError("a2a_transport", "token reference is unavailable");
    token = secret.value;
  }
  const scrub = (text: string): string => (token ? text.split(token).join("[redacted]") : text);
  const transport = createTransport(peer.endpoint, token, allowLoopback, limits, scrub);

  const card = peer.card;
  const agentId = card.name;
  const origin: EventOrigin = {
    kind: "external",
    agent: card.name,
    agentId,
    vendor: "a2a",
    remote: options.endpointId ?? peer.endpoint.origin,
    depth: 0,
    executedBy: "external",
  };
  const contexts = new Map<string, A2AContextState>();
  const handles = new Set<A2ASessionHandle>();
  const agentSubscribers = new Set<() => void>();
  let disposed = false;

  const config = Object.freeze({ id: agentId, name: card.name }) as unknown as Agent["config"];
  const inspection = Object.freeze({
    packages: [],
    tools: [],
    skills: [],
    commands: [],
    hooks: {},
    slots: {},
    store: { owner: "a2a", capabilities: [] },
    disabled: { tools: [], skills: [], commands: [], hooks: [] },
    statusNotes: [],
    a2a: Object.freeze({
      endpoint: peer.endpoint.origin + peer.endpoint.pathname,
      protocolVersion: A2A_PROTOCOL_VERSION,
      streaming: peer.streaming,
      card: Object.freeze({ name: card.name, version: card.version, skills: (card.skills ?? []).map((skill) => skill.id) }),
    }),
  }) as unknown as AgentInspection;

  const agent: Agent = {
    id: agentId,
    config,
    commands: {
      list() {
        throw unsupported("commands.list()");
      },
      async run() {
        throw unsupported("commands.run()");
      },
    },
    tools: Object.freeze([]) as unknown as Agent["tools"],
    skills: Object.freeze([]) as unknown as Agent["skills"],
    sessions: {
      async list() {
        throw unsupported("sessions.list()");
      },
      async get() {
        throw unsupported("sessions.get()");
      },
      async delete() {
        throw unsupported("sessions.delete()");
      },
      async search() {
        throw unsupported("sessions.search()");
      },
    },
    models: {
      async list() {
        throw unsupported("models.list()");
      },
      resolve() {
        throw unsupported("models.resolve()");
      },
    },
    async reload() {
      throw unsupported("reload()");
    },
    /** `id` is the A2A context id. `parent`, `ownership`, `actor` and `metadata` stay local: A2A has no equivalent. */
    async session(sessionOptions = {}) {
      if (disposed) throw new A2AClientError("a2a_unsupported", "the A2A agent has been disposed");
      const contextId = sessionOptions.id ?? randomUUID();
      if (!isA2AId(contextId)) throw new A2AClientError("a2a_unsupported", "session id must be an A2A context id");
      let state = contexts.get(contextId);
      if (!state) {
        state = { contextId, messages: [] };
        contexts.set(contextId, state);
      }
      const handle = createA2ASession(
        { transport, origin, streaming: peer.streaming, limits, scrub, ...(options.host?.ui ? { ui: options.host.ui } : {}) },
        state,
        () => handles.delete(handle),
      );
      handles.add(handle);
      return handle.session;
    },
    subscribe() {
      // A2A has no agent-scoped events; the iterable ends at `dispose()`.
      let wake: (() => void) | undefined;
      let ended = false;
      const end = () => {
        ended = true;
        wake?.();
      };
      agentSubscribers.add(end);
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          try {
            while (!ended && !disposed) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          } finally {
            agentSubscribers.delete(end);
          }
        },
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await Promise.all([...handles].map((handle) => handle.dispose()));
      for (const end of agentSubscribers) end();
      agentSubscribers.clear();
    },
    inspect() {
      return inspection;
    },
  };
  return agent;
}

async function checkUrl(url: URL, allowLoopback: boolean): Promise<void> {
  try {
    if (url.username || url.password || url.hash) throw new Error("url must not embed credentials or a fragment");
    const loopback = allowLoopback && isLoopbackHostname(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("url must be https");
    await resolvePinnedAddress(url, defaultResolver, undefined, allowLoopback, undefined, "A2A");
  } catch (error) {
    throw transportError(error, "A2A endpoint is not allowed");
  }
}

async function fetchCard(cardUrl: URL, allowLoopback: boolean): Promise<unknown> {
  let response: Response;
  try {
    response = await pinnedFetch(
      cardUrl,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(CARD_TIMEOUT_MS) },
      { errorPrefix: "A2A card", allowLoopback, maxResponseBytes: MAX_CARD_BYTES },
    );
  } catch (error) {
    throw transportError(error, "Agent Card fetch failed");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new A2AClientError("a2a_invalid_card", `Agent Card fetch failed with HTTP ${response.status}`);
  }
  try {
    return JSON.parse(await response.text());
  } catch (error) {
    if (error instanceof SyntaxError) throw new A2AClientError("a2a_invalid_card", "Agent Card is not JSON");
    throw transportError(error, "Agent Card fetch failed");
  }
}

function transportError(error: unknown, fallback: string): A2AClientError {
  if (error instanceof A2AClientError) return error;
  const detail = error instanceof Error ? error.message.slice(0, MAX_ERROR_TEXT) : "";
  return new A2AClientError("a2a_transport", detail ? `${fallback}: ${detail}` : fallback);
}

function createTransport(
  endpoint: URL,
  token: string | undefined,
  allowLoopback: boolean,
  limits: ResolvedA2ALimits,
  scrub: (text: string) => string,
): A2ATransport {
  let seq = 0;

  async function post(
    method: string,
    params: JsonObject,
    accept: string,
    maxBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params });
    if (Buffer.byteLength(body) > limits.maxRequestBytes) throw new A2AClientError("a2a_transport", "Request exceeds maxRequestBytes");
    const headers: Record<string, string> = { "content-type": "application/json", accept, "a2a-version": A2A_PROTOCOL_VERSION };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      return await pinnedFetch(
        endpoint,
        { method: "POST", headers, body, ...(signal ? { signal } : {}) },
        {
          errorPrefix: "A2A",
          allowLoopback,
          maxResponseBytes: maxBytes,
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new A2AClientError("a2a_transport", scrub(transportError(error, "A2A request failed").message));
    }
  }

  /** A JSON-RPC response body: its `result`, or its `error` as an `A2AError`. */
  function unwrap(value: unknown, status: number): unknown {
    if (value === null || typeof value !== "object" || (value as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
      throw new A2AClientError("a2a_invalid_response", `The peer did not answer JSON-RPC (HTTP ${status})`);
    }
    const error = (value as { error?: unknown }).error;
    if (error !== undefined) {
      const code = (error as { code?: unknown } | null)?.code;
      const message = (error as { message?: unknown } | null)?.message;
      throw new A2AError(a2aErrorNameOf(code), scrub(typeof message === "string" ? message.slice(0, MAX_ERROR_TEXT) : "A2A error"), status);
    }
    if (!("result" in value)) throw new A2AClientError("a2a_invalid_response", "The peer answered with no result");
    return (value as { result: unknown }).result;
  }

  async function readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new A2AClientError("a2a_transport", scrub(transportError(error, "A2A response failed").message));
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new A2AClientError("a2a_invalid_response", `The peer did not answer JSON (HTTP ${response.status})`);
    }
  }

  return {
    async call(method, params, signal) {
      const response = await post(method, params, "application/json", limits.maxResponseBytes, signal);
      return unwrap(await readJson(response), response.status);
    },

    async *stream(method, params, signal) {
      const local = new AbortController();
      const onAbort = () => local.abort(signal?.reason);
      if (signal?.aborted) local.abort(signal.reason);
      else signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        local.abort(new Error("A2A stream reached maxStreamMs"));
      }, limits.maxStreamMs);
      try {
        const response = await post(method, params, "text/event-stream", limits.maxStreamBytes, local.signal);
        const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (type !== "text/event-stream") {
          unwrap(await readJson(response), response.status);
          throw new A2AClientError("a2a_invalid_response", "The peer did not answer with an event stream");
        }
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let count = 0;
        try {
          while (true) {
            let next: ReadableStreamReadResult<Uint8Array>;
            try {
              next = await reader.read();
            } catch (error) {
              if (timedOut) return;
              if (signal?.aborted) throw error;
              throw new A2AClientError("a2a_transport", scrub(transportError(error, "A2A stream failed").message));
            }
            if (next.done) return;
            buffer += decoder.decode(next.value, { stream: true });
            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary >= 0) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
              const data = block
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).replace(/^ /, ""))
                .join("\n");
              if (data.length > 0) {
                if (++count > limits.maxStreamEvents) throw new A2AClientError("a2a_transport", "Stream exceeds maxStreamEvents");
                let parsed: unknown;
                try {
                  parsed = JSON.parse(data);
                } catch {
                  throw new A2AClientError("a2a_invalid_response", "The peer sent a frame that is not JSON");
                }
                yield parseA2AStreamResponse(unwrap(parsed, response.status), limits.maxParts);
              }
              boundary = buffer.search(/\r?\n\r?\n/);
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch (error) {
        if (timedOut && !signal?.aborted) return;
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
