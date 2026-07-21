#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 64 * 1024;
const REQUIRED = [
  "PRISM_CANARY_PROVIDER_URL", "PRISM_CANARY_PROVIDER_API_KEY", "PRISM_CANARY_PROVIDER_MODEL",
  "PRISM_CANARY_MCP_URL", "PRISM_CANARY_MCP_TOKEN", "PRISM_CANARY_A2A_URL", "PRISM_CANARY_A2A_TOKEN",
  "PRISM_BRAVE_SEARCH_TOKEN",
];

function endpoint(value, name) {
  let url; try { url = new URL(value); } catch { throw new Error(`${name} is not a valid URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`${name} must be credential-free HTTPS`);
  return url.href;
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Canary response body is missing");
  const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Canary response exceeds 64 KiB"); } chunks.push(value); }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  try { return JSON.parse(text); } catch { const data = text.split(/\r?\n/).find((line) => line.startsWith("data:")); if (!data) throw new Error("Canary response is not JSON/SSE"); return JSON.parse(data.slice(5).trim()); }
}

async function request(fetcher, kind, url, init, timeoutMs, captureHeader) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const started = performance.now();
  try {
    const response = await fetcher(url, { ...init, redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await boundedJson(response);
    return { kind, status: "passed", statusCode: response.status, durationMs: Math.round(performance.now() - started), captured: captureHeader ? response.headers.get(captureHeader) ?? undefined : undefined };
  } catch (error) {
    const reason = controller.signal.aborted ? "timeout" : error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : "request failed";
    throw new Error(`${kind} canary ${reason}`);
  } finally { clearTimeout(timer); }
}

export async function runCanaries({ env = process.env, fetcher = fetch } = {}) {
  if (env.PRISM_LIVE_CANARIES !== "1") return { skipped: true, reason: "PRISM_LIVE_CANARIES is not 1", results: [] };
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Live canary configuration missing ${missing.join(", ")}`);
  const timeoutMs = Number(env.PRISM_CANARY_TIMEOUT_MS ?? 15_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) throw new Error("PRISM_CANARY_TIMEOUT_MS must be 1000..30000");
  const providerUrl = endpoint(env.PRISM_CANARY_PROVIDER_URL, "PRISM_CANARY_PROVIDER_URL");
  const mcpUrl = endpoint(env.PRISM_CANARY_MCP_URL, "PRISM_CANARY_MCP_URL");
  const a2aUrl = endpoint(env.PRISM_CANARY_A2A_URL, "PRISM_CANARY_A2A_URL");
  const json = { "content-type": "application/json" };
  const results = [];
  results.push(await request(fetcher, "provider", providerUrl, { method: "POST", headers: { ...json, authorization: `Bearer ${env.PRISM_CANARY_PROVIDER_API_KEY}` }, body: JSON.stringify({ model: env.PRISM_CANARY_PROVIDER_MODEL, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 1 }) }, timeoutMs));
  const mcpHeaders = { ...json, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", authorization: `Bearer ${env.PRISM_CANARY_MCP_TOKEN}` };
  const { captured: sessionId, ...mcpResponse } = await request(fetcher, "mcp", mcpUrl, { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "prism-release-canary", version: "0.0.96" } } }) }, timeoutMs, "mcp-session-id");
  results.push(mcpResponse);
  if (sessionId) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(sessionId)) throw new Error("mcp canary returned an invalid session id");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { const probe = await fetcher(mcpUrl, { method: "DELETE", redirect: "error", signal: controller.signal, headers: { ...mcpHeaders, "mcp-session-id": sessionId } }); if (![200, 202, 204, 404, 405].includes(probe.status)) throw new Error(`mcp cleanup failed with HTTP ${probe.status}`); await probe.body?.cancel(); }
    catch { throw new Error("mcp canary cleanup failed"); }
    finally { clearTimeout(timer); }
  }
  results.push(await request(fetcher, "a2a", a2aUrl, { method: "POST", headers: { ...json, authorization: `Bearer ${env.PRISM_CANARY_A2A_TOKEN}`, "a2a-version": "1.0" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetExtendedAgentCard", params: {} }) }, timeoutMs));
  const brave = new URL("https://api.search.brave.com/res/v1/web/search"); brave.searchParams.set("q", "Prism SDK"); brave.searchParams.set("count", "1");
  results.push(await request(fetcher, "web", brave.href, { headers: { accept: "application/json", "x-subscription-token": env.PRISM_BRAVE_SEARCH_TOKEN } }, timeoutMs));
  return { skipped: false, maximumRequests: 5, providerMaxOutputTokens: 1, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runCanaries();
  if (process.env.PRISM_CANARY_REPORT) await writeFile(process.env.PRISM_CANARY_REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(report.skipped ? "live canaries skipped: gate disabled" : `live canaries passed: ${report.results.map((item) => item.kind).join(",")}`);
}
