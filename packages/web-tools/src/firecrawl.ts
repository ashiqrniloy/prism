import { assertSsrfAllowedUrl, type JsonObject, type JsonValue } from "@arnilo/prism";
import { citation, object, providerFacts, text } from "./normalize.js";
import { assertBoundedJson, boundedJson, createWebTransport, WebToolError } from "./transport.js";
import type { FirecrawlExtractOptions, FirecrawlFetchOptions, FirecrawlTargetPolicy, WebDocument, WebExtractAdapter, WebExtraction, WebFetchAdapter } from "./types.js";

const ORIGIN = "https://api.firecrawl.dev";
export function createFirecrawlFetch(options: FirecrawlFetchOptions): WebFetchAdapter {
  const transport = createWebTransport("firecrawl", ORIGIN, options);
  return { provider: "firecrawl", async fetch(input, call = {}) { return transport.run(call.signal, async (signal) => {
    const url = await target(input, options, signal); const response = await transport.json("firecrawl", "api_key", new URL("/v2/scrape", ORIGIN), { method: "POST", body: JSON.stringify({ url: url.toString(), formats: ["markdown"] }) }, signal);
    const root = object(response.value), data = object(root.data), markdown = text(data.markdown); if (root.success !== true || markdown === undefined) throw new WebToolError("ERR_PRISM_WEB_RESPONSE", "Firecrawl scrape returned no Markdown"); if (Buffer.byteLength(markdown) > transport.limits.maxMarkdownBytes) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "Firecrawl Markdown exceeds byte limit");
    const providerMetadata = providerFacts(response.value, response.metadata), metadata = typeof data.metadata === "object" && data.metadata ? data.metadata as Record<string, unknown> : {}; const sourceUrl = text(metadata.sourceURL) ?? url.toString();
    return boundedJson<WebDocument>({ ...citation("firecrawl", sourceUrl), title: text(metadata.title), markdown, retrievedAt: new Date().toISOString(), metadata: providerMetadata, untrusted: true }, transport.limits.maxJsonDepth, transport.limits.maxJsonProperties, transport.limits.maxAggregateBytes);
  }); } };
}

export function createFirecrawlExtractor(options: FirecrawlExtractOptions): WebExtractAdapter {
  const transport = createWebTransport("firecrawl", ORIGIN, options); assertSchema(options.schema, transport.limits.maxSchemaBytes, transport.limits.maxJsonDepth, transport.limits.maxJsonProperties);
  return { provider: "firecrawl", async extract(inputs, call = {}) { return transport.run(call.signal, async (signal) => {
    if (!inputs.length || inputs.length > transport.limits.maxUrls) throw new WebToolError("ERR_PRISM_WEB_INPUT", "Firecrawl URL count is invalid"); const urls: string[] = []; for (const input of inputs) urls.push((await target(input, options, signal)).toString());
    let response = await transport.json("firecrawl", "api_key", new URL("/v2/extract", ORIGIN), { method: "POST", body: JSON.stringify({ urls, schema: options.schema }) }, signal); let root = object(response.value), metadata = providerFacts(response.value, response.metadata);
    if (root.data === undefined) { const id = text(root.id); if (!id || !/^[A-Za-z0-9_-]{1,256}$/u.test(id)) throw new WebToolError("ERR_PRISM_WEB_RESPONSE", "Firecrawl extract returned no data or job id"); for (let poll = 0; poll < transport.limits.maxPollingAttempts; poll++) { if (transport.limits.pollingDelayMs) await (options.sleep ?? defaultSleep)(transport.limits.pollingDelayMs, signal); response = await transport.json("firecrawl", "api_key", new URL(`/v2/extract/${id}`, ORIGIN), { method: "GET" }, signal); root = object(response.value); metadata = providerFacts(response.value, response.metadata) ?? metadata; if (root.status === "failed") throw new WebToolError("ERR_PRISM_WEB_RESPONSE", "Firecrawl extraction failed"); if (root.data !== undefined || root.status === "completed") break; } }
    if (root.data === undefined) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "Firecrawl extraction polling limit reached"); assertBoundedJson(root.data, transport.limits.maxJsonDepth, transport.limits.maxJsonProperties, transport.limits.maxExtractBytes); let checked: ReturnType<typeof options.validator.validate>; try { checked = options.validator.validate(options.schema, root.data); } catch { throw new WebToolError("ERR_PRISM_WEB_SCHEMA", "Firecrawl extraction validation failed"); } if (!checked.ok) throw new WebToolError("ERR_PRISM_WEB_SCHEMA", "Firecrawl extraction did not match host schema");
    return boundedJson<WebExtraction>({ provider: "firecrawl", urls, data: root.data as JsonValue, retrievedAt: new Date().toISOString(), metadata, untrusted: true }, transport.limits.maxJsonDepth, transport.limits.maxJsonProperties, transport.limits.maxAggregateBytes);
  }); } };
}

async function target(input: string, policy: FirecrawlTargetPolicy, signal: AbortSignal): Promise<URL> { assertSsrfAllowedUrl(input, policy.ssrf); const url = new URL(input); await policy.validateUrl?.(url, signal); return url; }
function assertSchema(schema: JsonObject, bytes: number, depth: number, properties: number): void { assertBoundedJson(schema, depth, properties, bytes); const stack: unknown[] = [schema]; while (stack.length) { const value = stack.pop(); if (!value || typeof value !== "object") continue; for (const [key, child] of Object.entries(value)) { if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#"))) throw new WebToolError("ERR_PRISM_WEB_SCHEMA", "Remote JSON Schema references are not allowed"); stack.push(child); } } }
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { try { signal.throwIfAborted(); } catch (error) { reject(error); return; } const cleanup = () => signal.removeEventListener("abort", abort); const timer = setTimeout(() => { cleanup(); resolve(); }, ms); const abort = () => { clearTimeout(timer); cleanup(); reject(signal.reason); }; signal.addEventListener("abort", abort, { once: true }); }); }
