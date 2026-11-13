/**
 * Plan 218.1 Task 2: the local pass-through between Compact-Bench and OpenCode Go.
 *
 * Upstream's continuation agent speaks Anthropic Messages (`CB_MESSAGES_URL`) and its reference summarizers Chat
 * Completions (`CB_SUMMARIZER_API=chat`, `CB_CHAT_URL`). OpenCode Go refuses a request without an `x-opencode-session`
 * header (`MissingSessionID`), which upstream never sends. The pass-through:
 *
 * - serves `/v1/messages` and `/v1/chat/completions` on a loopback address only, and answers 403 to any peer that is
 *   not loopback;
 * - accepts only the local placeholder key upstream is given, drops it, and sends the real key the way OpenCode Go's
 *   routes do (Messages: `x-api-key` and bearer; Chat: bearer). The key is read from the environment by name and never
 *   appears in argv, logs or records (the wire proxy's secret scan refuses any record that would hold it);
 * - adds `x-opencode-session`;
 * - sets the continuation agent's thinking off on its Messages requests (`thinking: {type: "disabled"}`, the patch
 *   Prism's `thinking_type` family sends for MiniMax at level `none`). Upstream switches thinking off only for Kimi
 *   models (`harness/e1_runner.py` `_call_agent_tools`);
 * - forwards through the wire proxy (`scripts/wire-proxy.mjs`), which records every exchange and usage row.
 *
 * Nothing else changes: no protocol translation, no other body field.
 */
import { randomUUID } from "node:crypto";
import { isLoopbackHost, parseListen, startWireProxy } from "../../../wire-proxy.mjs";

/** OpenCode Go's API base (`packages/providers/opencode-go/src/models.ts` `OPENCODE_GO_DEFAULT_BASE_URL`). */
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
/** The continuation agent (owner, 2026-11-12), served on OpenCode Go's Messages route (`routeForOpenCodeGoModel`). */
export const COMPACT_BENCH_AGENT_MODEL = "minimax-m3.1-flash";
/** Thinking off on agent requests. */
export const AGENT_THINKING = Object.freeze({ type: "disabled" });
/** The key upstream is given. Not a secret: it only proves the caller is the local harness. */
export const LOCAL_PLACEHOLDER_KEY = "prism-compact-bench-local";
/** `OPENCODE_SESSION_ID_MAX_LENGTH` in the provider. */
const SESSION_MAX = 128;

const ROUTES = Object.freeze({
  "/v1/messages": { path: "messages", auth: "x-api-key+bearer" },
  "/v1/chat/completions": { path: "chat/completions", auth: "bearer" },
});

/** A loopback peer address as Bun reports it (`127.x.y.z`, `::1`, `::ffff:127.x.y.z`). */
export function isLoopbackPeer(address) {
  if (typeof address !== "string" || !address) return false;
  const clean = address.replace(/^::ffff:/i, "");
  return isLoopbackHost(clean);
}

/** The session header value: OpenCode Go's charset and length cap. */
export function opencodeSessionId(value) {
  const clean = String(value)
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .slice(0, SESSION_MAX);
  if (!clean) throw new Error("CompactBenchPassthrough: empty session id");
  return clean;
}

/**
 * The request body as forwarded: unchanged, except the agent's Messages requests get `thinking` set off. Returns the
 * forwarded text and whether the thinking field was set.
 */
export function rewriteBody(route, text, agentModel = COMPACT_BENCH_AGENT_MODEL) {
  if (route !== "/v1/messages" || !text) return { text, thinking: false };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { text, thinking: false };
  }
  if (body?.model !== agentModel) return { text, thinking: false };
  return { text: JSON.stringify({ ...body, thinking: AGENT_THINKING }), thinking: true };
}

function presentedKey(headers) {
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1];
  return headers.get("x-api-key") ?? bearer ?? "";
}

/**
 * Start the pass-through. `keyEnv` names the environment variable that holds the OpenCode Go key; `record` and
 * `usageLog` go to the wire proxy. Returns `{ url, messagesUrl, chatUrl, counts, drain(), stop() }`.
 */
export async function startPassthrough({
  upstream = OPENCODE_GO_BASE_URL,
  listen = "127.0.0.1:0",
  keyEnv = "OPENCODE_GO_API_KEY",
  env = process.env,
  session = `cb-218.1-${randomUUID()}`,
  agentModel = COMPACT_BENCH_AGENT_MODEL,
  placeholder = LOCAL_PLACEHOLDER_KEY,
  record = "",
  usageLog = "",
  maxRequests = 0,
} = {}) {
  const { host, port } = parseListen(listen);
  if (!isLoopbackHost(host)) throw new Error(`CompactBenchPassthrough: refusing to listen on non-loopback ${host}`);
  const key = env[keyEnv];
  if (typeof key !== "string" || !key.trim()) throw new Error(`CompactBenchPassthrough: ${keyEnv} is not set`);
  const sessionId = opencodeSessionId(session);
  const proxy = await startWireProxy({
    upstream,
    listen: "127.0.0.1:0",
    record,
    secretEnv: [keyEnv],
    usageLog,
    env,
    maxRequests,
  });
  const counts = { forwarded: 0, refusedPeer: 0, refusedKey: 0, refusedRoute: 0, thinkingSet: 0, byRoute: {} };
  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 0,
    async fetch(req, srv) {
      if (!isLoopbackPeer(srv.requestIP(req)?.address)) {
        counts.refusedPeer++;
        return new Response("forbidden", { status: 403 });
      }
      const url = new URL(req.url);
      const route = ROUTES[url.pathname];
      if (!route || req.method !== "POST") {
        counts.refusedRoute++;
        return new Response("not found", { status: 404 });
      }
      if (presentedKey(req.headers) !== placeholder) {
        counts.refusedKey++;
        return new Response("unauthorized", { status: 401 });
      }
      const rewritten = rewriteBody(url.pathname, await req.text(), agentModel);
      if (rewritten.thinking) counts.thinkingSet++;
      const headers = new Headers();
      for (const [name, value] of req.headers) {
        const lower = name.toLowerCase();
        if (["authorization", "x-api-key", "host", "content-length", "connection"].includes(lower)) continue;
        headers.set(name, value);
      }
      headers.set("authorization", `Bearer ${key}`);
      if (route.auth === "x-api-key+bearer") headers.set("x-api-key", key);
      headers.set("x-opencode-session", sessionId);
      counts.forwarded++;
      counts.byRoute[url.pathname] = (counts.byRoute[url.pathname] ?? 0) + 1;
      const response = await fetch(`${proxy.url}/${route.path}`, { method: "POST", headers, body: rewritten.text });
      const out = new Headers(response.headers);
      out.delete("content-encoding");
      out.delete("content-length");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
    },
  });
  const base = `http://${server.hostname}:${server.port}`;
  return {
    url: base,
    messagesUrl: `${base}/v1/messages`,
    chatUrl: `${base}/v1/chat/completions`,
    sessionId,
    counts,
    /** The environment upstream gets: endpoints and the placeholder key only. */
    upstreamEnv: {
      CB_API_KEY: placeholder,
      CB_MESSAGES_URL: `${base}/v1/messages`,
      CB_CHAT_URL: `${base}/v1/chat/completions`,
      CB_SUMMARIZER_API: "chat",
      CB_AGENT_MODEL: agentModel,
    },
    drain: () => proxy.drain(),
    stop() {
      server.stop(true);
      proxy.stop();
    },
  };
}
