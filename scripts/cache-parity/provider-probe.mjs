#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnvFile } from "../live-matrix.mjs";
import { scanSecrets } from "../scan-secrets.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/three-turn-coding.json", import.meta.url), "utf8"));
const MIN_PREFIX = 8192;
const HELP =
  "usage: bun scripts/cache-parity/provider-probe.mjs --provider <id> --model <pinned-id> [--turns 4] [--without-session] [--ttft] [--route native|openai]\n--ttft records milliseconds from generate start to first nonempty text delta (null if absent); latencyMs remains total stream duration. --route is Ollama Cloud only; default native. Ollama Cloud uses OLLAMA_API_KEY, and both routes cost 2 × turns requests (8 by default).\nRequires PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_CACHE_PARITY=1; paid OpenRouter also requires PRISM_LIVE_OPENROUTER_PAID=1. Makes at most turns generation requests (2–20; default 4), no retries, plus one model-discovery operation. Each request caps output at 128 tokens and time at 60s. Never runs in release:gate. Without-session is a separate turns-request run; it writes a separate report.\nReuse = cache reads on turns 2..n / reported first-request prefix tokens repeated n-1 times. Missing cache counts => unmeasurable, not zero or parity.";

function validProvider(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error("ProviderProbe: invalid provider id");
}
export function parseArgs(argv) {
  const options = { turns: 4, withoutSession: false, ttft: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help") return { help: true };
    if (flag === "--without-session" || flag === "--ttft") {
      options[flag === "--ttft" ? "ttft" : "withoutSession"] = true;
      continue;
    }
    if (!["--provider", "--model", "--turns", "--credential", "--route"].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error("ProviderProbe: invalid arguments; use --help");
    options[flag.slice(2)] = argv[++i];
  }
  validProvider(options.provider);
  if (options.route !== undefined && (options.provider !== "ollama-cloud" || !["native", "openai"].includes(options.route)))
    throw new Error("ProviderProbe: --route native|openai is Ollama Cloud only");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/~@-]{0,255}$/.test(options.model ?? "")) throw new Error("ProviderProbe: invalid model id");
  if (options.credential !== undefined && !/^keyring:[A-Za-z0-9._:-]{1,128}$/.test(options.credential))
    throw new Error("ProviderProbe: --credential must be a writable keyring: ref");
  if (options.provider === "openrouter" && /^openrouter\/(free|auto)$/.test(options.model))
    throw new Error("ProviderProbe: use a pinned model, never openrouter/free or auto");
  options.turns = Number(options.turns);
  if (!Number.isSafeInteger(options.turns) || options.turns < 2 || options.turns > 20)
    throw new Error("ProviderProbe: turns must be 2..20");
  return options;
}
export function loadEnv(env = process.env) {
  // Out-of-repo only: a credential file inside the checkout is one git accident from a leak.
  const path = env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (!existsSync(path)) {
    if (env.PRISM_LIVE_ENV_FILE) throw new Error("ProviderProbe: explicit live env file missing");
    return;
  }
  if ((statSync(path).mode & 0o077) !== 0) throw new Error("ProviderProbe: live env file must be private (0600)");
  for (const [name, value] of Object.entries(parseEnvFile(path))) if (env[name] === undefined) env[name] = value;
}
export async function importProvider(id, importer = (name) => import(name)) {
  validProvider(id);
  const module = await importer(`@arnilo/prism-provider-${id}`);
  const factories = Object.entries(module).filter(([name, value]) => /^create.+Provider$/.test(name) && typeof value === "function");
  const catalogs = Object.entries(module).filter(([name, value]) => /^list.+Models$/.test(name) && typeof value === "function");
  if (factories.length !== 1 || catalogs.length !== 1)
    throw new Error("ProviderProbe: package must export one provider factory and model discovery function");
  return { create: factories[0][1], list: catalogs[0][1] };
}
function assertNoSecrets(value, secrets) {
  const text = JSON.stringify(value);
  if (secrets.some((secret) => secret && text.includes(secret))) throw new Error("ProviderProbe: secret leak refused");
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function summarizeReuse(turns) {
  const warm = turns.slice(1);
  if (
    !warm.length ||
    warm.some(
      (turn) =>
        count(turn.cacheReadTokens) === null ||
        count(turn.inputTokens) === null ||
        turn.cacheReadTokens > turn.inputTokens ||
        !(turn.stablePrefixTokens > 0),
    )
  ) {
    return {
      status: "unmeasurable",
      reason: "Missing or invalid reported input/cache-read counts or stable-prefix denominator on warm turns",
      reuse: null,
    };
  }
  return {
    status: "measured",
    reuse: warm.reduce((sum, turn) => sum + turn.cacheReadTokens, 0) / warm.reduce((sum, turn) => sum + turn.stablePrefixTokens, 0),
  };
}
export async function probeProvider({
  provider,
  model,
  turns = 4,
  withoutSession = false,
  sessionId = `cache-probe-${randomUUID()}`,
  secrets = [],
  ttft = false,
  route,
  now = () => performance.now(),
}) {
  if (!Number.isSafeInteger(turns) || turns < 2 || turns > 20) throw new Error("ProviderProbe: turns must be 2..20");
  const minimumPrefixTokens = Math.max(MIN_PREFIX, model.cache?.minCacheableTokens ?? 0);
  if (!Number.isSafeInteger(minimumPrefixTokens) || minimumPrefixTokens > 65536)
    throw new Error("ProviderProbe: unsupported cache minimum");
  const {
    max_tokens: _legacyCap,
    max_completion_tokens: _chatCap,
    max_output_tokens: _responsesCap,
    ...parameters
  } = model.parameters ?? {};
  const tools = FIXTURE.tools.map((tool) => ({
    ...tool,
    execute: () => {
      throw new Error("ProviderProbe: fixture tools must not execute");
    },
  }));
  const messages = [
    {
      id: "system",
      role: "system",
      content: [
        {
          type: "text",
          text: `${sessionId}\n${FIXTURE.system}\n${Array(Math.max(FIXTURE.padding.words, minimumPrefixTokens)).fill(FIXTURE.padding.word).join(" ")}`,
        },
      ],
    },
    // Opaque reasoning signatures are offline replay canaries, not valid live history.
    ...structuredClone(FIXTURE.messages).map((message) => ({
      ...message,
      content: message.content.filter((part) => part.type !== "thinking"),
    })),
  ];
  const rows = [];
  let stablePrefixTokens = null;
  for (let turn = 1; turn <= turns; turn++) {
    const start = now();
    let usage,
      firstTextMs = null,
      done = false;
    for await (const event of provider.generate({
      model: { ...model, parameters: { ...parameters, maxTokens: 128 } },
      messages: structuredClone(messages),
      tools,
      options: {
        ...(!withoutSession ? { sessionId, cacheKey: sessionId } : {}),
        cache: { breakpoints: [{ location: "system_prompt" }, { location: "tools" }, { location: "message_id", messageId: "anchor" }] },
      },
      signal: AbortSignal.timeout(60_000),
    })) {
      assertNoSecrets(event, secrets);
      if (ttft && firstTextMs === null && event.type === "content_delta" && event.content?.type === "text" && event.content.text)
        firstTextMs = now() - start;
      if (event.type === "error") throw new Error(`ProviderProbe: upstream error on turn ${turn}; no evidence persisted`);
      if (event.type === "tool_call" || (event.type === "content_delta" && event.content?.type === "tool_call"))
        throw new Error("ProviderProbe: unexpected tool call");
      if (event.type === "usage") usage = event.usage;
      if (event.type === "done") done = true;
    }
    if (!done) throw new Error("ProviderProbe: incomplete stream; no evidence persisted");
    if (turn === 1) stablePrefixTokens = usage?.estimated ? null : count(usage?.inputTokens);
    rows.push({
      turn,
      inputTokens: usage?.estimated ? null : count(usage?.inputTokens),
      cacheReadTokens: usage?.estimated ? null : count(usage?.cacheReadTokens),
      cacheWriteTokens: usage?.estimated ? null : count(usage?.cacheWriteTokens),
      stablePrefixTokens,
      latencyMs: now() - start,
      ...(ttft ? { ttftMs: firstTextMs } : {}),
    });
    if (stablePrefixTokens === null || stablePrefixTokens < minimumPrefixTokens) break;
    // Replay fixed, deterministic history, not generated text: only the suffix grows.
    messages.push(
      { role: "assistant", content: [{ type: "text", text: "OK" }] },
      { role: "user", content: [{ type: "text", text: `Reply OK for check ${turn + 1}.` }] },
    );
  }
  const summary =
    stablePrefixTokens === null || stablePrefixTokens < minimumPrefixTokens
      ? {
          status: "unmeasurable",
          reason: `First request did not report a prefix of at least ${minimumPrefixTokens} tokens; stopped before further spend`,
          reuse: null,
        }
      : summarizeReuse(rows);
  const report = {
    schemaVersion: 1,
    provider: provider.id,
    model: model.model,
    affinity: !withoutSession,
    ...(route ? { route } : {}),
    requestedTurns: turns,
    requests: rows.length,
    stablePrefixTokens,
    stablePrefixTokensSource: "reported-first-request",
    minimumPrefixTokens,
    outputTokensLimit: 128,
    turns: rows,
    ...summary,
  };
  assertNoSecrets(report, secrets);
  return report;
}
export async function writeEvidence(report, { root = ROOT, date = new Date().toISOString().slice(0, 10), secrets = [] } = {}) {
  assertNoSecrets(report, secrets);
  const slug = `${report.provider}-${report.model}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  const path = join(
    root,
    "docs/_evidence/cache-probe",
    `${slug}${report.route ? `-${report.route}` : ""}${report.affinity ? "" : "-without-session"}-${date}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await scanSecrets([temp]);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  return path;
}
/**
 * A provider whose grant is an OAuth record in the OS keyring takes a credential ref, never a token
 * in the environment: the record rotates, so an env copy would be stale on the second run. The slot
 * exposes `resolve`/`store`/`delete`, so the provider can persist a rotated record too.
 */
export async function credentialSlot(importer = (name) => import(name)) {
  const keyring = await importer("@arnilo/prism-credentials-keyring");
  const createResolver = keyring.createKeyringCredentialResolver ?? keyring.default?.createKeyringCredentialResolver;
  const createStore = keyring.createKeychainCredentialStore ?? keyring.default?.createKeychainCredentialStore;
  if (typeof createResolver !== "function" || typeof createStore !== "function")
    throw new Error("ProviderProbe: @arnilo/prism-credentials-keyring exposes no credential resolver");
  return createResolver({ store: createStore({ service: keyring.KEYRING_DEFAULT_SERVICE }) });
}

/** Resolve the ref and refuse an empty one: a missing record must fail closed, never send a blank request. */
export async function credentialAuth(ref, slot) {
  const secret = await slot.resolve(ref);
  if (!secret || typeof secret.value !== "string" || secret.value.length === 0)
    throw new Error(`ProviderProbe: credential ${ref} has no stored record; sign in before probing`);
  return { credential: ref, credentialSource: slot };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  loadEnv();
  if (process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || process.env.PRISM_LIVE_CACHE_PARITY !== "1")
    throw new Error("ProviderProbe: enable PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_CACHE_PARITY=1 after approving the request budget");
  if (options.provider === "openrouter" && !options.model.endsWith(":free") && process.env.PRISM_LIVE_OPENROUTER_PAID !== "1")
    throw new Error("ProviderProbe: paid OpenRouter requires PRISM_LIVE_OPENROUTER_PAID=1 and owner spend approval");
  const keyName = options.provider === "ollama-cloud" ? "OLLAMA_API_KEY" : `${options.provider.toUpperCase().replaceAll("-", "_")}_API_KEY`;
  const key = process.env[keyName];
  if (["openrouter", "ollama-cloud"].includes(options.provider) && !key) throw new Error(`ProviderProbe: ${keyName} is unavailable`);
  if (options.credential !== undefined && key)
    throw new Error("ProviderProbe: pass either --credential or an API key variable, never both");
  const { create, list } = await importProvider(options.provider);
  const auth = options.credential ? await credentialAuth(options.credential, await credentialSlot()) : key ? { apiKey: () => key } : {};
  const models = await list({ ...auth, signal: AbortSignal.timeout(60_000) });
  const model = models.find((entry) => entry.model === options.model);
  if (!model) throw new Error("ProviderProbe: pinned model absent from catalog; choose a current authorized model");
  if (
    !Number.isFinite(model.limits?.contextWindow) ||
    model.limits.contextWindow < Math.max(MIN_PREFIX, model.cache?.minCacheableTokens ?? 0) + 2048
  )
    throw new Error("ProviderProbe: model context missing or too small for the cache fixture");
  if (model.capabilities?.tools !== true) throw new Error("ProviderProbe: fixture requires a catalog-declared tool-capable model");
  const secrets = Object.entries(process.env)
    .filter(([name, value]) => /(?:KEY|TOKEN|SECRET)$/.test(name) && value.length >= 8)
    .map(([, value]) => value);
  const route = options.provider === "ollama-cloud" ? (options.route ?? "native") : undefined;
  const report = await probeProvider({ ...options, route, provider: create({ ...auth, ...(route ? { route } : {}) }), model, secrets });
  const path = await writeEvidence(report, { secrets });
  console.log(
    JSON.stringify({ status: report.status, reuse: report.reuse, reason: report.reason, requests: report.requests, evidence: path }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    // Provider/discovery errors can echo credentials. Never print their raw text.
    console.error(
      "Provider cache probe failed; no successful evidence recorded. Check flags, private live.env, authorization gates, model and credentials (--help).",
    );
    process.exitCode = 1;
  });
