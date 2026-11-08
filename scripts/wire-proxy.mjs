#!/usr/bin/env bun
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Checks if a hostname or IP address is loopback.
 */
export function isLoopbackHost(host) {
  if (!host) return false;
  const clean = host.replace(/^\[|\]$/g, "");
  if (clean === "localhost" || clean === "::1") return true;
  const parts = clean.split(".");
  if (parts.length === 4 && parts[0] === "127") {
    return parts.every((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return false;
}

/**
 * Parses a listen string into host and port.
 */
export function parseListen(listenStr = "127.0.0.1:8787") {
  let host = "127.0.0.1";
  let port = 8787;
  if (listenStr.includes(":")) {
    const lastColon = listenStr.lastIndexOf(":");
    const h = listenStr.slice(0, lastColon);
    const p = listenStr.slice(lastColon + 1);
    if (h) host = h;
    if (p) port = parseInt(p, 10);
  } else if (/^\d+$/.test(listenStr)) {
    port = parseInt(listenStr, 10);
  } else {
    host = listenStr;
  }
  return { host, port };
}

/**
 * Parses CLI arguments into typed options.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    upstream: "",
    listen: "127.0.0.1:8787",
    record: "",
    secretEnv: [],
    usageLog: "",
    maxRequests: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--upstream" && i + 1 < argv.length) {
      options.upstream = argv[++i];
    } else if (arg === "--listen" && i + 1 < argv.length) {
      options.listen = argv[++i];
    } else if (arg === "--record" && i + 1 < argv.length) {
      options.record = argv[++i];
    } else if (arg === "--secret-env" && i + 1 < argv.length) {
      const val = argv[++i];
      for (const item of val.split(",")) {
        const trimmed = item.trim();
        if (trimmed) options.secretEnv.push(trimmed);
      }
    } else if (arg === "--usage-log" && i + 1 < argv.length) {
      options.usageLog = argv[++i];
    } else if (arg === "--max-requests" && i + 1 < argv.length) {
      options.maxRequests = parseInt(argv[++i], 10);
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: bun scripts/wire-proxy.mjs --upstream <url> [options]

Options:
  --upstream <url>        Upstream base URL (required)
  --listen <host:port>    Listen address (must be loopback, default 127.0.0.1:8787)
  --record <dir>          Directory to record exchanges (<n>.json)
  --secret-env <names>    Env vars containing secrets to scan (mandatory with --record)
  --usage-log <file>      JSONL file to append raw upstream usage per exchange
  --max-requests <n>      Answer 429 without contacting the upstream once n requests were forwarded (0 = unlimited)
  -h, --help              Show this help message
`);
}

/**
 * Collects non-empty secret strings from environment variables.
 */
export function collectSecrets(secretEnvNames = [], env = process.env) {
  const secrets = [];
  for (const name of secretEnvNames) {
    const val = env[name];
    if (typeof val === "string" && val.trim().length > 0) {
      secrets.push(val.trim());
    }
  }
  return secrets;
}

/**
 * Scans payload for any secret string leak.
 */
export function scanPayloadForSecrets(payloadText, secrets = []) {
  if (!payloadText || secrets.length === 0) return null;
  for (const secret of secrets) {
    if (secret && payloadText.includes(secret)) {
      return secret;
    }
  }
  return null;
}

/**
 * Extracts raw upstream usage object from streaming SSE or JSON responses.
 * Implemented independently of provider-kit codecs.
 */
/**
 * The prompt-cache affinity key a route sent, from the headers the shipped routes use for it
 * (`x-session-id`, `session_id`, `x-client-request-id`, `x-opencode-session`) or the body's
 * `prompt_cache_key`. Retained so write-side accounting can split the extractor by its stable key.
 */
export function requestCacheKey(headers, body) {
  for (const name of ["x-session-id", "session_id", "x-client-request-id", "x-opencode-session"]) {
    const value = headers?.get?.(name);
    if (value) return value;
  }
  return typeof body?.prompt_cache_key === "string" && body.prompt_cache_key ? body.prompt_cache_key : undefined;
}

export function parseRawResponseId(body) {
  const candidates = [
    body,
    ...body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()),
  ];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      const id = value.id ?? value.response?.id ?? value.message?.id;
      if (typeof id === "string" && id) return id;
    } catch {}
  }
  return undefined;
}

export function parseRawUpstreamUsage(responseBody, contentType = "") {
  if (!responseBody || typeof responseBody !== "string") return null;

  const trimmed = responseBody.trim();

  // 1. Try parsing as single JSON object
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.usage && typeof parsed.usage === "object") {
        return parsed.usage;
      }
      if (parsed?.message?.usage && typeof parsed.message.usage === "object") {
        return parsed.message.usage;
      }
    } catch {
      // not direct JSON
    }
  }

  // 2. Try parsing as SSE stream
  let anthropicStartUsage = null;
  let anthropicDeltaUsage = null;
  let lastOpenAIUsage = null;

  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === "[DONE]") continue;

    try {
      const data = JSON.parse(dataStr);
      // Anthropic message_start
      if (data.type === "message_start" && data.message?.usage) {
        anthropicStartUsage = { ...anthropicStartUsage, ...data.message.usage };
      }
      // Anthropic message_delta
      if (data.type === "message_delta" && data.usage) {
        anthropicDeltaUsage = { ...anthropicDeltaUsage, ...data.usage };
      }
      // Responses terminal events nest usage under the completed response.
      if (data.response?.usage && typeof data.response.usage === "object") {
        lastOpenAIUsage = data.response.usage;
      }
      // OpenAI streaming chunk usage
      if (data.usage && typeof data.usage === "object") {
        lastOpenAIUsage = data.usage;
      }
    } catch {
      // ignore non-json data frames
    }
  }

  if (anthropicStartUsage || anthropicDeltaUsage) {
    return {
      ...(anthropicStartUsage ?? {}),
      ...(anthropicDeltaUsage ?? {}),
    };
  }

  if (lastOpenAIUsage) {
    return lastOpenAIUsage;
  }

  // 3. Ollama native NDJSON (`/api/chat`): the terminal `done` line carries prompt_eval_count / eval_count.
  for (const line of lines.toReversed()) {
    if (!line.startsWith("{")) continue;
    try {
      const data = JSON.parse(line);
      if (data?.done === true && (typeof data.prompt_eval_count === "number" || typeof data.eval_count === "number")) {
        const prompt = Number(data.prompt_eval_count) || 0;
        const completion = Number(data.eval_count) || 0;
        const cached = Number(data.prompt_eval_cached_count) || 0;
        return {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: prompt + completion,
          ...(cached ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
        };
      }
    } catch {
      // not a JSON line
    }
  }

  return null;
}

/**
 * Computes inclusive token metrics from raw usage following Task 4's contract.
 */
export function normalizeUsageMetrics(rawUsage) {
  if (!rawUsage) return null;

  // OpenAI Chat (`prompt_tokens` is already inclusive of cache). Checked first: some vendors (Command Code) add a
  // top-level `cache_creation_input_tokens` that must not make the usage look like Anthropic's.
  if ("prompt_tokens" in rawUsage) {
    const input = Number(rawUsage.prompt_tokens) || 0;
    const output = Number(rawUsage.completion_tokens) || 0;
    const details = rawUsage.prompt_tokens_details;
    const cacheRead = Number(details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens) || 0;
    const cacheWrite =
      Number(details?.cache_write_tokens ?? details?.cache_creation_input_tokens ?? rawUsage.cache_creation_input_tokens) || 0;
    const total = typeof rawUsage.total_tokens === "number" ? rawUsage.total_tokens : input + output;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
    };
  }

  // OpenAI Responses (`input_tokens` is inclusive; cache counts sit under `input_tokens_details`).
  if ("input_tokens_details" in rawUsage) {
    const input = Number(rawUsage.input_tokens) || 0;
    const output = Number(rawUsage.output_tokens) || 0;
    const details = rawUsage.input_tokens_details;
    const cacheRead = Number(details?.cached_tokens) || 0;
    const cacheWrite = Number(details?.cache_write_tokens ?? details?.cache_creation_input_tokens) || 0;
    const total = typeof rawUsage.total_tokens === "number" ? rawUsage.total_tokens : input + output;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
    };
  }

  // Anthropic format (input_tokens / cache_read_input_tokens / cache_creation_input_tokens; `input_tokens` is exclusive)
  if ("input_tokens" in rawUsage || "cache_read_input_tokens" in rawUsage || "cache_creation_input_tokens" in rawUsage) {
    const rawInput = Number(rawUsage.input_tokens) || 0;
    const cacheRead = Number(rawUsage.cache_read_input_tokens) || 0;
    const cacheWrite = Number(rawUsage.cache_creation_input_tokens) || 0;
    const output = Number(rawUsage.output_tokens) || 0;
    const input = rawInput + cacheRead + cacheWrite;
    const total = input + output;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
    };
  }

  return null;
}

/**
 * Starts the wire proxy server.
 */
export async function startWireProxy(options = {}) {
  const { upstream, listen = "127.0.0.1:8787", record = "", secretEnv = [], usageLog = "", env = process.env, maxRequests = 0 } = options;

  if (!upstream) {
    console.error("[wire-proxy] Missing required --upstream <url>");
    process.exit(1);
  }

  const { host, port } = parseListen(listen);
  if (!isLoopbackHost(host)) {
    console.error(`[wire-proxy] Refusing to listen on non-loopback address: ${host}`);
    process.exit(1);
  }

  if (record && (!secretEnv || secretEnv.length === 0)) {
    console.error("[wire-proxy] --secret-env is mandatory whenever --record is set");
    process.exit(2);
  }

  if (record) {
    mkdirSync(record, { recursive: true });
  }
  if (usageLog) {
    mkdirSync(dirname(usageLog), { recursive: true });
  }

  const secrets = collectSecrets(secretEnv, env);
  let exchangeIndex = 0;
  const pendingExchanges = [];

  const server = Bun.serve({
    // Long model prefill and quiet SSE periods use the caller's deadline.
    idleTimeout: 0,
    hostname: host,
    port,
    async fetch(req) {
      // A cell budget: past it the request never reaches the (billed) upstream.
      if (maxRequests > 0 && exchangeIndex >= maxRequests) {
        return new Response("[wire-proxy] request ceiling reached", { status: 429 });
      }
      const currentExchange = ++exchangeIndex;
      const reqUrl = new URL(req.url);
      const upstreamBase = upstream.endsWith("/") ? upstream : `${upstream}/`;
      const targetUrl = new URL(reqUrl.pathname.replace(/^\//, "") + reqUrl.search, upstreamBase);

      const forwardHeaders = new Headers(req.headers);
      forwardHeaders.set("host", targetUrl.host);

      let reqBodyText = null;
      let parsedReqBody = null;
      let upstreamBody = null;

      if (req.method !== "GET" && req.method !== "HEAD") {
        reqBodyText = await req.text();
        upstreamBody = reqBodyText;
        if (reqBodyText) {
          try {
            parsedReqBody = JSON.parse(reqBodyText);
          } catch {
            parsedReqBody = reqBodyText;
          }
        }
      }

      const cacheKey = requestCacheKey(req.headers, parsedReqBody);
      let upstreamResponse;
      try {
        upstreamResponse = await fetch(targetUrl.toString(), {
          method: req.method,
          headers: forwardHeaders,
          body: upstreamBody,
          // @ts-expect-error
          duplex: "half",
        });
      } catch {
        // A request may have reached the model before transport failed; retain unknown usage.
        const body = "[wire-proxy] Upstream fetch failed";
        await handleExchangeCompletion({
          exchange: currentExchange,
          method: req.method,
          path: reqUrl.pathname + reqUrl.search,
          parsedReqBody,
          rawReqBodyText: reqBodyText ?? "",
          resStatus: 502,
          resContentType: "text/plain",
          resBodyText: body,
          recordDir: record,
          usageLogFile: usageLog,
          cacheKey,
          secrets,
        });
        return new Response(body, { status: 502 });
      }

      const resContentType = upstreamResponse.headers.get("content-type") || "";

      // If neither recording nor usage-log is configured, stream through directly.
      // fetch() decompresses the body but leaves content-encoding/length on the headers;
      // forwarding both makes the client inflate plaintext (ZlibError on Hyper deflate).
      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      if (!record && !usageLog) {
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        });
      }

      // Tee response stream to add zero buffering while piping to client.
      let clientBody = null;
      let recordPromise = null;

      if (upstreamResponse.body) {
        const [clientStream, recordStream] = upstreamResponse.body.tee();
        clientBody = clientStream;

        recordPromise = (async () => {
          const reader = recordStream.getReader();
          const chunks = [];
          // A provider reset mid-stream must still leave the partial exchange on disk; throwing here
          // used to reject drain() and abort the whole run.
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          } catch {}

          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }

          const resBodyText = new TextDecoder().decode(merged);
          await handleExchangeCompletion({
            exchange: currentExchange,
            method: req.method,
            path: reqUrl.pathname + reqUrl.search,
            parsedReqBody,
            rawReqBodyText: reqBodyText ?? "",
            resStatus: upstreamResponse.status,
            resContentType,
            resBodyText,
            recordDir: record,
            usageLogFile: usageLog,
            cacheKey,
            secrets,
            upstreamHeaders: upstreamResponse.headers,
          });
        })();
      } else {
        recordPromise = handleExchangeCompletion({
          exchange: currentExchange,
          method: req.method,
          path: reqUrl.pathname + reqUrl.search,
          parsedReqBody,
          rawReqBodyText: reqBodyText ?? "",
          resStatus: upstreamResponse.status,
          resContentType,
          resBodyText: "",
          recordDir: record,
          usageLogFile: usageLog,
          cacheKey,
          secrets,
          upstreamHeaders: upstreamResponse.headers,
        });
      }

      pendingExchanges.push(recordPromise);

      return new Response(clientBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    },
  });

  return {
    server,
    hostname: server.hostname,
    port: server.port,
    url: `http://${server.hostname}:${server.port}`,
    pendingExchanges,
    /** Requests forwarded upstream so far. */
    forwarded: () => exchangeIndex,
    async drain() {
      await Promise.allSettled(pendingExchanges);
    },
    stop() {
      server.stop(true);
    },
  };
}

/**
 * The `x-litellm-*` response headers worth keeping: a call id to reconcile spend against, the
 * deployment that answered, and LiteLLM's own cost figure. Everything else in that namespace
 * (`x-litellm-model-api-base`, key labels) can name private infrastructure, so it is not copied.
 */
export const LITELLM_HEADERS = {
  "x-litellm-call-id": "callId",
  "x-litellm-model-id": "modelId",
  "x-litellm-model-group": "modelGroup",
  "x-litellm-response-cost": "responseCost",
};

export function litellmHeaders(headers) {
  if (!headers) return {};
  const get = (name) => (typeof headers.get === "function" ? headers.get(name) : headers[name]);
  const out = {};
  for (const [header, key] of Object.entries(LITELLM_HEADERS)) {
    const value = get(header);
    if (value === null || value === undefined || value === "") continue;
    out[key] = key === "responseCost" ? Number(value) : String(value);
  }
  return out;
}

async function handleExchangeCompletion(params) {
  const {
    exchange,
    method,
    path,
    parsedReqBody,
    rawReqBodyText,
    resStatus,
    resContentType,
    resBodyText,
    recordDir,
    usageLogFile,
    cacheKey,
    secrets,
    upstreamHeaders,
  } = params;
  const telemetry = litellmHeaders(upstreamHeaders);

  const exchangeRecord = {
    method,
    path,
    requestBody: parsedReqBody,
    status: resStatus,
    contentType: resContentType,
    headers: {
      "content-type": resContentType,
    },
    responseBody: resBodyText,
  };

  // Mandatory secret scan before any write: a hit aborts the write and exits 3.
  const serializedRecord = JSON.stringify(exchangeRecord);
  const secretHit =
    scanPayloadForSecrets(serializedRecord, secrets) ||
    scanPayloadForSecrets(rawReqBodyText, secrets) ||
    scanPayloadForSecrets(resBodyText, secrets) ||
    scanPayloadForSecrets(path, secrets);

  if (secretHit) {
    console.error(`[wire-proxy] Secret leaked in exchange #${exchange}; write aborted.`);
    process.exit(3);
  }

  // 1. Write recording <n>.json if requested
  if (recordDir) {
    const filename = `${exchange}.json`;
    const targetFile = join(recordDir, filename);
    writeFileSync(targetFile, JSON.stringify(exchangeRecord, null, 2), "utf8");
  }

  // 2. Append usage-log line if requested
  if (usageLogFile) {
    const rawUsage = parseRawUpstreamUsage(resBodyText, resContentType);
    const normalized = normalizeUsageMetrics(rawUsage);
    const logEntry = {
      exchange,
      path,
      model: parsedReqBody?.model,
      ...(cacheKey ? { cacheKey } : {}),
      generationId: parseRawResponseId(resBodyText),
      status: resStatus,
      rawUsage,
      usage: rawUsage,
      promptTokens: normalized?.inputTokens ?? 0,
      inputTokens: normalized?.inputTokens ?? 0,
      outputTokens: normalized?.outputTokens ?? 0,
      cacheReadTokens: normalized?.cacheReadTokens ?? 0,
      cacheWriteTokens: normalized?.cacheWriteTokens ?? 0,
      totalTokens: normalized?.totalTokens ?? 0,
      // Only the allow-listed LiteLLM fields, and only when the gateway actually sent one.
      ...(telemetry.callId ? { callId: telemetry.callId } : {}),
      ...(telemetry.modelId ? { modelId: telemetry.modelId } : {}),
      ...(telemetry.modelGroup ? { modelGroup: telemetry.modelGroup } : {}),
      ...(telemetry.responseCost !== undefined && Number.isFinite(telemetry.responseCost) ? { responseCost: telemetry.responseCost } : {}),
    };
    // The run may already be tearing its scratch directory down while a streamed reply finishes;
    // a lost usage line after teardown must not fail the run that is ending.
    try {
      appendFileSync(usageLogFile, `${JSON.stringify(logEntry)}\n`, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

// CLI entry point
if (import.meta.main || process.argv[1]?.endsWith("wire-proxy.mjs")) {
  const parsed = parseArgs();
  const proxy = await startWireProxy(parsed);
  console.log(`[wire-proxy] Proxying ${parsed.upstream} at ${proxy.url}`);
}
