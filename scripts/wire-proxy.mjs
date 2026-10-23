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

  return null;
}

/**
 * Computes inclusive token metrics from raw usage following Task 4's contract.
 */
export function normalizeUsageMetrics(rawUsage) {
  if (!rawUsage) return null;

  // Anthropic format (input_tokens / cache_read_input_tokens / cache_creation_input_tokens)
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

  // OpenAI format (prompt_tokens is already inclusive of cache)
  if ("prompt_tokens" in rawUsage) {
    const input = Number(rawUsage.prompt_tokens) || 0;
    const output = Number(rawUsage.completion_tokens) || 0;
    const cacheRead = Number(rawUsage.prompt_tokens_details?.cached_tokens) || 0;
    const cacheWrite = Number(rawUsage.prompt_tokens_details?.cache_creation_input_tokens) || 0;
    const total = typeof rawUsage.total_tokens === "number" ? rawUsage.total_tokens : input + output;
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
  const { upstream, listen = "127.0.0.1:8787", record = "", secretEnv = [], usageLog = "", env = process.env } = options;

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
    hostname: host,
    port,
    async fetch(req) {
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

      let upstreamResponse;
      try {
        upstreamResponse = await fetch(targetUrl.toString(), {
          method: req.method,
          headers: forwardHeaders,
          body: upstreamBody,
          // @ts-expect-error
          duplex: "half",
        });
      } catch (err) {
        return new Response(`[wire-proxy] Upstream fetch failed: ${err.message}`, { status: 502 });
      }

      const resContentType = upstreamResponse.headers.get("content-type") || "";

      // If neither recording nor usage-log is configured, stream through directly.
      if (!record && !usageLog) {
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: upstreamResponse.headers,
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
            secrets,
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
          secrets,
        });
      }

      pendingExchanges.push(recordPromise);

      return new Response(clientBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    },
  });

  return {
    server,
    hostname: server.hostname,
    port: server.port,
    url: `http://${server.hostname}:${server.port}`,
    pendingExchanges,
    async drain() {
      await Promise.allSettled(pendingExchanges);
    },
    stop() {
      server.stop(true);
    },
  };
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
    secrets,
  } = params;

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
      status: resStatus,
      rawUsage,
      usage: rawUsage,
      promptTokens: normalized?.inputTokens ?? 0,
      inputTokens: normalized?.inputTokens ?? 0,
      outputTokens: normalized?.outputTokens ?? 0,
      cacheReadTokens: normalized?.cacheReadTokens ?? 0,
      cacheWriteTokens: normalized?.cacheWriteTokens ?? 0,
      totalTokens: normalized?.totalTokens ?? 0,
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
