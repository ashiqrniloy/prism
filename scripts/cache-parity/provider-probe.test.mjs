import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  credentialAuth,
  credentialSlot,
  importProvider,
  loadEnv,
  parseArgs,
  probeProvider,
  summarizeReuse,
  writeEvidence,
} from "./provider-probe.mjs";

const model = {
  provider: "mock",
  model: "fixed",
  limits: { contextWindow: 65536 },
  parameters: { max_tokens: 8192, max_completion_tokens: 8192, max_output_tokens: 8192 },
};
function scripted(usages, requests = []) {
  return {
    id: "mock",
    async *generate(request) {
      requests.push({
        ...structuredClone({ ...request, signal: undefined, tools: request.tools.map(({ execute: _execute, ...tool }) => tool) }),
        signal: request.signal,
      });
      yield { type: "usage", usage: usages[requests.length - 1] };
      yield { type: "done", reason: "stop" };
    },
  };
}
const usages = [
  { inputTokens: 8400, cacheReadTokens: 0, cacheWriteTokens: 8400 },
  ...Array.from({ length: 3 }, () => ({ inputTokens: 8420, cacheReadTokens: 8192, cacheWriteTokens: 0 })),
];
test("provider_probe_reuse_math", () => {
  const turns = usages.map((usage, index) => ({ turn: index + 1, stablePrefixTokens: 8400, ...usage }));
  assert.equal(summarizeReuse(turns).reuse, 8192 / 8400);
  assert.equal(summarizeReuse(turns).status, "measured");
  for (const field of ["cacheReadTokens", "inputTokens"]) {
    const missing = structuredClone(turns);
    delete missing[2][field];
    assert.equal(summarizeReuse(missing).status, "unmeasurable");
    assert.equal(summarizeReuse(missing).reuse, null);
  }
  const invalid = structuredClone(turns);
  invalid[1].cacheReadTokens = 1e9;
  assert.equal(summarizeReuse(invalid).status, "unmeasurable");
  assert.equal(summarizeReuse(turns.map((turn) => ({ ...turn, cacheReadTokens: 0 }))).reuse, 0);
  assert.equal(summarizeReuse([]).status, "unmeasurable");
});
test("provider_probe_fixed_prefix_exact_request_budget_and_affinity", async () => {
  const requests = [];
  const report = await probeProvider({ provider: scripted(usages, requests), model, turns: 4, sessionId: "probe-test" });
  assert.equal(requests.length, 4);
  assert.equal(report.reuse, 8192 / 8400);
  assert.equal(report.stablePrefixTokens, 8400);
  assert.equal(report.stablePrefixTokensSource, "reported-first-request");
  for (const request of requests) {
    assert.equal(request.options.cacheKey, "probe-test");
    assert.ok(request.messages[0].content[0].text.split(" ").length >= 8192);
    assert.deepEqual(request.model.parameters, { maxTokens: 128 });
    assert.ok(request.signal instanceof AbortSignal);
    assert.deepEqual(request.messages.slice(0, requests[0].messages.length), requests[0].messages);
    assert.deepEqual(request.tools, requests[0].tools);
  }
  assert.ok(report.turns.every((turn) => Number.isFinite(turn.latencyMs)));
  const without = [];
  await probeProvider({ provider: scripted(usages, without), model, turns: 4, withoutSession: true });
  assert.ok(without.every((request) => request.options.cacheKey === undefined && request.options.sessionId === undefined));
});
test("provider_probe_ttft_flag", async () => {
  const flags = parseArgs(["--provider", "ollama-cloud", "--model", "gemma4:31b", "--route", "openai", "--ttft"]);
  assert.equal(flags.ttft, true);
  assert.equal(flags.route, "openai");
  assert.throws(() => parseArgs(["--provider", "ollama-cloud", "--model", "gemma4:31b", "--route", "messages"]));
  assert.throws(() => parseArgs(["--provider", "openrouter", "--model", "fixed", "--route", "native"]));
  let time = 0;
  const provider = {
    id: "mock",
    async *generate() {
      time += 5;
      yield { type: "content_delta", content: { type: "thinking", text: "not a text token" } };
      time += 10;
      yield { type: "content_delta", content: { type: "text", text: "" } };
      time += 20;
      yield { type: "content_delta", content: { type: "text", text: "OK" } };
      time += 40;
      yield { type: "usage", usage: usages[1] };
      yield { type: "done" };
    },
  };
  const report = await probeProvider({ provider, model, ttft: true, now: () => time });
  assert.ok(report.turns.every((turn) => turn.ttftMs === 35 && turn.latencyMs === 75));
  const noText = await probeProvider({ provider: scripted(usages), model, ttft: true, now: () => time });
  assert.ok(
    noText.turns.every((turn) => turn.ttftMs === null),
    "missing text is not zero TTFT",
  );
  const unchanged = await probeProvider({ provider: scripted(usages), model });
  assert.ok(
    unchanged.turns.every((turn) => !("ttftMs" in turn)),
    "opt-in only",
  );
});

test("provider_probe_ollama_routes_use_distinct_evidence_paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-cache-routes-"));
  try {
    const report = await probeProvider({ provider: scripted(usages), model, ttft: true, route: "native" });
    const native = await writeEvidence(report, { root });
    const compat = await writeEvidence({ ...report, route: "openai" }, { root });
    assert.notEqual(native, compat);
    assert.match(native, /-native-/);
    assert.match(compat, /-openai-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provider_probe_openrouter_wire_keeps_marked_prefix_stable", async () => {
  const { create } = await importProvider("openrouter");
  const bodies = [],
    sessions = [];
  const provider = create({
    apiKey: async () => "offline-fixture",
    fetch: async (_url, init) => {
      sessions.push(new Headers(init.headers).get("x-session-id"));
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 8400, completion_tokens: 1, prompt_tokens_details: { cached_tokens: bodies.length === 1 ? 0 : 8192 } } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await probeProvider({
    provider,
    model: {
      ...model,
      model: "anthropic/claude-haiku-4.5",
      compat: { cacheControl: "anthropic-blocks" },
      cache: { kind: "cache_control" },
    },
    turns: 4,
    sessionId: "stable-wire",
  });
  assert.deepEqual(sessions, Array(4).fill("stable-wire"));
  for (const body of bodies) {
    assert.equal(body.max_tokens, 128);
    assert.equal("prompt_cache_key" in body, false);
    assert.equal(JSON.stringify(body).includes("fixture-signature"), false);
    assert.equal("reasoning_details" in body.messages[2], false);
    assert.equal(JSON.stringify(body.tools), JSON.stringify(bodies[0].tools));
    assert.equal(JSON.stringify(body.messages.slice(0, bodies[0].messages.length)), JSON.stringify(bodies[0].messages));
    assert.deepEqual(body.messages[0].content[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(body.messages[4].content[0].cache_control, { type: "ephemeral" });
  }
});
test("provider_probe_never_fabricates_missing_usage_or_below_minimum_prefix", async () => {
  const unknown = await probeProvider({
    provider: scripted(usages.map(({ cacheReadTokens: _read, cacheWriteTokens: _write, ...usage }) => usage)),
    model,
    turns: 4,
  });
  assert.equal(unknown.status, "unmeasurable");
  assert.ok(unknown.turns.every((turn) => turn.cacheReadTokens === null));
  const requests = [];
  const small = await probeProvider({ provider: scripted([{ inputTokens: 3000 }], requests), model, turns: 4 });
  assert.equal(small.status, "unmeasurable");
  assert.match(small.reason, /8192/);
  assert.equal(requests.length, 1);
});
test("provider_probe_honors_model_cache_minimum_and_rejects_estimated_usage", async () => {
  const requests = [];
  const report = await probeProvider({
    provider: scripted(Array(4).fill({ inputTokens: 17000, cacheReadTokens: 16384 }), requests),
    model: { ...model, cache: { minCacheableTokens: 16384 } },
    turns: 4,
  });
  assert.equal(report.minimumPrefixTokens, 16384);
  assert.ok(requests[0].messages[0].content[0].text.split(" ").length >= 16384);
  const estimated = await probeProvider({
    provider: scripted([{ inputTokens: 9000, cacheReadTokens: 8000, estimated: true }]),
    model,
    turns: 4,
  });
  assert.equal(estimated.status, "unmeasurable");
  assert.equal(estimated.turns[0].inputTokens, null);
  await assert.rejects(
    () => probeProvider({ provider: scripted([]), model: { ...model, cache: { minCacheableTokens: 1e9 } } }),
    /cache minimum/,
  );
});
test("provider_probe_imports_only_named_provider", async () => {
  const imports = [];
  const create = () => ({}),
    list = () => [];
  const result = await importProvider("openrouter", async (name) => {
    imports.push(name);
    return { createOpenRouterProvider: create, listOpenRouterModels: list };
  });
  assert.deepEqual(imports, ["@arnilo/prism-ai/openrouter"]);
  assert.equal(result.create, create);
  assert.equal(result.list, list);
  await assert.rejects(() => importProvider("../secret", () => assert.fail("must not import")), /provider id/);
  await assert.rejects(() => importProvider("empty", async () => ({})), /factory and model discovery/);
});
test("provider_probe_accepts_a_credential_ref", async () => {
  const secret = { type: "bearer", value: "canary-oauth-record" };
  const calls = [];
  const store = {
    async get({ name }) {
      calls.push(["get", name]);
      return name === "openai-codex" ? secret : undefined;
    },
    async set(args) {
      calls.push(["set", args.name]);
    },
    async delete(args) {
      calls.push(["delete", args.name]);
    },
  };
  const created = [];
  const resolver = await credentialSlot(async (name) => {
    assert.equal(name, "@arnilo/prism-extensions/keyring");
    return {
      KEYRING_DEFAULT_SERVICE: "prism",
      createKeychainCredentialStore: ({ service }) => {
        assert.equal(service, "prism");
        return store;
      },
      createKeyringCredentialResolver: ({ store: backend }) => ({
        resolve: (ref) => backend.get({ name: ref.slice("keyring:".length) }),
        store: (ref, value) => backend.set({ name: ref.slice("keyring:".length), credential: value }),
        delete: (ref) => backend.delete({ name: ref.slice("keyring:".length) }),
      }),
    };
  });
  assert.deepEqual(calls, []);
  const auth = await credentialAuth("keyring:openai-codex", resolver);
  assert.deepEqual(auth, { credential: "keyring:openai-codex", credentialSource: resolver });
  assert.equal(JSON.stringify(auth).includes(secret.value), false, "the resolved record must not ride along");
  // The provider gets the ref plus the slot, so it can rotate and persist the record itself.
  created.push(auth);
  assert.equal(created[0].credential, "keyring:openai-codex");
  assert.equal(typeof created[0].credentialSource.store, "function");

  // A missing record fails closed with a named reason instead of sending a blank request.
  calls.length = 0;
  await assert.rejects(() => credentialAuth("keyring:absent", resolver), /keyring:absent has no stored record/);
  assert.deepEqual(calls, [["get", "absent"]]);

  // Flags: a keyring ref is required, and no provider id or model can smuggle one in.
  assert.equal(
    parseArgs(["--provider", "openai-codex", "--model", "gpt-6.1-sol", "--credential", "keyring:openai-codex"]).credential,
    "keyring:openai-codex",
  );
  for (const credential of ["env:OPENAI_CODEX_TOKEN", "keyring:", "openai-codex", "keyring:../../etc/passwd"])
    assert.throws(() => parseArgs(["--provider", "openai-codex", "--model", "gpt-6.1-sol", "--credential", credential]));
});

test("provider_probe_refuses_invalid_flags_and_unpinned_router", () => {
  assert.equal(parseArgs(["--provider", "openrouter", "--model", "anthropic/claude-haiku-4.5"]).turns, 4);
  for (const args of [
    [],
    ["--provider", "../bad", "--model", "x"],
    ["--provider", "openrouter", "--model", "openrouter/free"],
    ["--provider", "x", "--model", "x", "--turns", "21"],
    ["--provider", "x", "--model", "x", "--unknown"],
  ])
    assert.throws(() => parseArgs(args));
});
test("provider_probe_fails_on_error_incomplete_stream_and_secret_leak", async () => {
  for (const events of [
    [],
    [{ type: "error", error: { message: "upstream failed" } }],
    [{ type: "content_delta", content: { type: "text", text: "canary-probe-secret" } }, { type: "done" }],
  ]) {
    await assert.rejects(() =>
      probeProvider({
        provider: {
          id: "mock",
          async *generate() {
            yield* events;
          },
        },
        model,
        turns: 4,
        secrets: ["canary-probe-secret"],
      }),
    );
  }
});
test("provider_probe_evidence_is_scanned_private_and_affinity_runs_do_not_overwrite", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-cache-probe-"));
  try {
    const report = await probeProvider({ provider: scripted(usages), model, turns: 4 });
    const first = await writeEvidence(report, { root, date: "2026-10-25" });
    const second = await writeEvidence({ ...report, affinity: false }, { root, date: "2026-10-25" });
    assert.notEqual(first, second);
    assert.equal(statSync(first).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(first, "utf8")).reuse, report.reuse);
    await assert.rejects(
      () => writeEvidence({ ...report, model: "canary-probe-secret" }, { root, secrets: ["canary-probe-secret"] }),
      /secret/,
    );
    await assert.rejects(
      () => writeEvidence({ ...report, model: ["npm", "_", "a".repeat(32)].join("") }, { root }),
      /Secret scan rejected/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("provider_probe_cli_is_opt_in_and_never_prints_credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-cache-cli-"));
  const path = join(root, "live.env");
  writeFileSync(path, "# offline test env\n", { mode: 0o600 });
  try {
    const source = new URL("./provider-probe.mjs", import.meta.url).pathname;
    const base = {
      ...process.env,
      PRISM_LIVE_ENV_FILE: path,
      PRISM_LIVE_PROVIDER_TESTS: "0",
      PRISM_LIVE_CACHE_PARITY: "0",
      PRISM_LIVE_OPENROUTER_PAID: "0",
      OPENROUTER_API_KEY: "canary-cli-secret",
    };
    for (const flags of [{}, { PRISM_LIVE_PROVIDER_TESTS: "1", PRISM_LIVE_CACHE_PARITY: "1" }]) {
      const child = spawnSync(process.execPath, [source, "--provider", "openrouter", "--model", "anthropic/claude-haiku-4.5"], {
        env: { ...base, ...flags },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(child.status, 1);
      assert.equal(child.stdout, "");
      assert.equal(child.stderr.includes(base.OPENROUTER_API_KEY), false);
    }
    const help = spawnSync(process.execPath, [source, "--help"], {
      env: { ...base, PRISM_LIVE_ENV_FILE: join(root, "missing") },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /no retries/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("provider_probe_loads_live_env_without_replacing_environment_and_rejects_public_permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-cache-env-"));
  const path = join(root, "live.env");
  try {
    writeFileSync(path, "PRISM_LIVE_CACHE_PARITY=1\n", { mode: 0o600 });
    const env = { PRISM_LIVE_ENV_FILE: path, PRISM_LIVE_CACHE_PARITY: "0" };
    loadEnv(env);
    assert.equal(env.PRISM_LIVE_CACHE_PARITY, "0");
    loadEnv({ PRISM_LIVE_ENV_FILE: path });
    assert.throws(() => loadEnv({ PRISM_LIVE_ENV_FILE: join(root, "missing") }), /missing/);
    const publicPath = join(root, "public.env");
    writeFileSync(publicPath, "X=1", { mode: 0o644 });
    assert.throws(() => loadEnv({ PRISM_LIVE_ENV_FILE: publicPath }), /0600/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
