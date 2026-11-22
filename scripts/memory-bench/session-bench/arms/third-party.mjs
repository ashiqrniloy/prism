/**
 * Plan 218.3 Task 10: Session-Bench's third-party memory systems.
 *
 *   timeout 600 bun scripts/memory-bench/session-bench/arms/third-party.mjs --install   # Mem0 into the cache, from the lock
 *   timeout 60  bun scripts/memory-bench/session-bench/arms/third-party.mjs --check     # installed and pinned?
 *   timeout 3000 bun scripts/memory-bench/session-bench/arms/third-party.mjs --install-embedder # the screen's BGE-M3 (llama.cpp/Vulkan)
 *   timeout 60  bun scripts/memory-bench/session-bench/arms/third-party.mjs --check-embedder
 *
 * Each candidate was checked (2026-11-18, at the version below, from its published package and source) for
 * (a) a licence that allows this use, (b) a local runtime with no vendor account, (c) its model calls routable to the
 * same model as every other arm, (d) countable tokens, embeddings included. `THIRD_PARTY_CANDIDATES` records the result
 * and the reason for each one that is not run.
 *
 * An included system runs as a harness arm in its documented pattern on top of `memory-off-llm`'s compaction: after
 * every exchange the harness writes it to the system (`add`); before every task it retrieves (`search`) and the result
 * rides in one context block for that task's loop. Every model and embedding call the system makes goes to a local
 * OpenAI-compatible endpoint (`startModelEndpoint`, 127.0.0.1 only) that the harness serves: chat goes to the run's
 * worker model through `windowedProviders` (same model, same window, metered as worker tokens, G9), embeddings to the
 * run's embedder (metered apart). The system never reaches the network itself.
 *
 * Third-party code is installed into `$PRISM_CACHE_DIR/session-bench/` from the committed lock (`arms/lock/`), never
 * into the Prism workspace (no product dependency).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK = join(HERE, "lock");

/**
 * The candidates and the inclusion check (criteria a–d). `included: false` rows are recorded with the reason and never
 * run (`excluded_systems_are_recorded_with_a_reason`).
 */
export const THIRD_PARTY_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "mem0",
    system: "Mem0 open-source library (npm mem0ai, `mem0ai/oss` Memory)",
    version: "3.3.1",
    included: true,
    criteria: Object.freeze({
      licence: "pass: Apache-2.0 (package.json license field)",
      localRuntime:
        "pass: an in-process library; default vector store `memory` and history store `sqlite` are local SQLite files (served under Bun by the bun:sqlite shim in arms/lock/mem0/better-sqlite3-bun); telemetry off (MEM0_TELEMETRY=false)",
      sameModel: "pass: its default LLM and embedder are OpenAI-compatible clients with a `baseURL`, pointed at the harness endpoint",
      countableTokens: "pass: every chat and embedding call goes through the harness endpoint, which meters it",
    }),
  }),
  Object.freeze({
    id: "letta",
    system: "Letta (PyPI letta)",
    version: "0.34.12",
    included: false,
    criteria: Object.freeze({
      licence: "pass: Apache-2.0",
      localRuntime: "pass: a local server",
      sameModel: "fail for this benchmark: Letta's memory is its own stateful agent loop (MemGPT-style self-editing memory)",
      countableTokens: "not checked",
    }),
    reason:
      "Letta is an agent, not a memory layer: its memory works only inside Letta's own agent loop (the 0.34 package is 'Letta Code: stateful agents in your terminal'). Running it would replace Prism's agent, tools, system prompt and loop, so it cannot differ from the other arms in memory alone (G6).",
  }),
  Object.freeze({
    id: "zep",
    system: "Zep (PyPI zep-cloud; zep-python)",
    version: "zep-cloud 4.1.0",
    included: false,
    criteria: Object.freeze({
      licence: "no licence field on the SDKs; the service is proprietary",
      localRuntime: "fail: Zep Community Edition is no longer published; the current SDK is a client for the hosted Zep service",
      sameModel: "fail: the hosted service runs its own models",
      countableTokens: "fail: the service's model and embedding calls are not visible to the harness",
    }),
    reason:
      "Zep is a vendor-hosted service (a Zep account and key; data leaves the machine; behaviour not pinnable). Rejected by the plan's options (vendor-hosted services).",
  }),
  Object.freeze({
    id: "graphiti",
    system: "Graphiti (PyPI graphiti-core, Zep's open-source temporal graph)",
    version: "0.31.2",
    included: false,
    criteria: Object.freeze({
      licence: "pass: Apache-2.0",
      localRuntime: "partial: needs a graph database (Neo4j by default; Kuzu/FalkorDB-lite as extras) and a Python runtime",
      sameModel:
        "fail at its defaults: the default LLM client calls the OpenAI Responses API with structured parsing (`responses.parse`), and the default reranker (`OpenAIRerankerClient`) scores passages from token logprobs (`logprobs=True, top_logprobs=2`)",
      countableTokens: "not reachable at its defaults (see sameModel)",
    }),
    reason:
      "At its documented defaults Graphiti's reranker needs token logprobs, which Prism's provider stream does not carry, so its calls cannot run on the same model through the metered harness path; replacing the reranker and the LLM client with non-default ones would break G10 (documented defaults).",
  }),
]);

/** The included systems' arm ids. */
export const THIRD_PARTY_ARMS = Object.freeze(THIRD_PARTY_CANDIDATES.filter((row) => row.included).map((row) => row.id));

/** G10's input: each included arm declares it runs at its documented defaults on the same model. */
export const THIRD_PARTY_ARM_SPECS = Object.freeze(
  THIRD_PARTY_CANDIDATES.filter((row) => row.included).map((row) =>
    Object.freeze({ id: row.id, version: row.version, documentedDefaults: true, model: "same" }),
  ),
);

// --- Mem0: the pin, the cache install, the runtime ---------------------------------------------------------------------

export const MEM0_PIN = Object.freeze({ package: "mem0ai", version: "3.3.1" });
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** `$PRISM_CACHE_DIR/session-bench/mem0-<version>` (default `~/.cache/prism/session-bench/...`). */
export function mem0CacheDir(env = process.env) {
  return join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "session-bench", `mem0-${MEM0_PIN.version}`);
}

/** Whether the cache holds Mem0 at the pin, installed from the committed lock, with the SQLite shim in place. */
export function mem0Status(dir = mem0CacheDir()) {
  const pkg = join(dir, "node_modules/mem0ai/package.json");
  if (!existsSync(pkg)) return { installed: false, reason: `not installed (${dir}); run arms/third-party.mjs --install` };
  const version = JSON.parse(readFileSync(pkg, "utf8")).version;
  if (version !== MEM0_PIN.version) return { installed: false, reason: `mem0ai ${version} installed, ${MEM0_PIN.version} pinned` };
  if (sha256File(join(dir, "package-lock.json")) !== sha256File(join(LOCK, "mem0/package-lock.json")))
    return { installed: false, reason: "the installed lock differs from arms/lock/mem0/package-lock.json" };
  const shim = join(dir, "node_modules/better-sqlite3/index.js");
  if (!existsSync(shim) || sha256File(shim) !== sha256File(join(LOCK, "mem0/better-sqlite3-bun/index.js")))
    return { installed: false, reason: "the bun:sqlite shim is not in place; rerun --install" };
  return { installed: true, dir, version };
}

/** `npm ci --ignore-scripts` from the committed lock into the cache, then the bun:sqlite shim over better-sqlite3. */
export function installMem0(dir = mem0CacheDir()) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const file of ["package.json", "package-lock.json"]) cpSync(join(LOCK, "mem0", file), join(dir, file));
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit", timeout: 300_000 });
  rmSync(join(dir, "node_modules/better-sqlite3"), { recursive: true, force: true });
  cpSync(join(LOCK, "mem0/better-sqlite3-bun"), join(dir, "node_modules/better-sqlite3"), { recursive: true });
  const status = mem0Status(dir);
  if (!status.installed) throw new Error(`SessionBenchThirdParty: install did not verify: ${status.reason}`);
  return status;
}

/** Mem0's documented defaults the arm keeps, and the parts the harness sets (recorded in the arm's config hash). */
export const MEM0_ARM_CONFIG = Object.freeze({
  system: "mem0",
  version: MEM0_PIN.version,
  pattern: "add(user prompt, final answer) after every exchange; search(task prompt) before every task, top results in one context block",
  defaults: Object.freeze({
    extraction: "ADDITIVE_EXTRACTION_PROMPT (user-scoped)",
    vectorStore: "memory (SQLite)",
    historyStore: "sqlite",
    search: "topK 20, threshold 0.1, BM25 + entity boost",
    customInstructions: null,
  }),
  harness: Object.freeze({
    llm: "openai-compatible client → the run's worker model via the harness endpoint",
    embedder: "openai-compatible client → the run's embedder via the harness endpoint (offline: hashed bag of words)",
    scope: "userId = the Session-Bench session id",
    block: "User Memories:\\n- <memory> per result (the README's chat pattern)",
  }),
});

/**
 * The offline embedder: a hashed bag of lowercase words, L2-normalised, `dims` wide. Deterministic and local; it is a
 * mock for the offline validation, never a stand-in for Mem0's default embedder (the live run's embedder is named in the
 * gate record, plan 218.3 Task 11).
 */
export function hashEmbedder(dims = 256) {
  const embed = (text) => {
    const vector = new Array(dims).fill(0);
    for (const word of String(text)
      .toLowerCase()
      .match(/[a-z0-9_]+/g) ?? []) {
      const digest = createHash("sha1").update(word).digest();
      vector[digest.readUInt32BE(0) % dims] += digest[4] & 1 ? 1 : -1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  };
  return {
    dims,
    async embed(texts) {
      return { vectors: texts.map(embed), tokens: texts.reduce((sum, text) => sum + Math.ceil(String(text).length / 3.5), 0) };
    },
  };
}

/**
 * The live embedder (plan 218.3 Task 11, owner 2026-11-18): Gemini `gemini-embedding-001` through the native
 * `batchEmbedContents` API, at its default 3,072 dimensions (normalised by the model at that size). Mem0's own default
 * is OpenAI `text-embedding-3-small`; no OpenAI-compatible host the owner holds a balance on serves it, so this is a
 * recorded deviation from Mem0's defaults (G10), named in the gate record. The API reports no token usage, so tokens are
 * estimated at 3.5 characters per token, as offline. A 429 or 5xx waits and retries (`waitsMs`), then throws: Mem0
 * counts the failed call (`thirdPartyErrors`) and the agent's run goes on.
 */
export const GEMINI_EMBEDDER = Object.freeze({
  provider: "gemini",
  model: "gemini-embedding-001",
  dims: 3072,
  endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
  secret: "GEMINI_API_KEY",
  tokens: "estimated at 3.5 characters per token (the API reports no usage)",
  deviation:
    "Mem0's default embedder is OpenAI text-embedding-3-small; the owner holds no balance on a host that serves it and OpenCode Go / Ollama Cloud serve no embedding model, so Gemini gemini-embedding-001 is used (owner, 2026-11-18)",
});
const EMBED_RETRY = /^(429|5\d\d)$/;
export function geminiEmbedder({
  apiKey = process.env[GEMINI_EMBEDDER.secret],
  fetch: transport = fetch,
  waitsMs = [10_000, 30_000, 60_000, 120_000, 300_000],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!apiKey) throw new Error("SessionBenchThirdParty: the Gemini embedder needs GEMINI_API_KEY");
  const { model, dims, endpoint } = GEMINI_EMBEDDER;
  const self = {
    /** Set when the API answers a per-day quota 429 (free tier: 1,000 requests a day); every later call fails fast. */
    dailyCap: false,
    dims,
    model: `${GEMINI_EMBEDDER.provider}/${model}`,
    async embed(texts) {
      if (self.dailyCap) throw new Error("SessionBenchThirdParty: Gemini embeddings are at their daily cap");
      const vectors = [];
      // The API takes at most 100 requests per batch.
      for (let at = 0; at < texts.length; at += 100) {
        const batch = texts.slice(at, at + 100);
        const body = JSON.stringify({
          requests: batch.map((text) => ({ model: `models/${model}`, content: { parts: [{ text: String(text) }] } })),
        });
        for (let attempt = 0; ; attempt++) {
          let response;
          try {
            response = await transport(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
              body,
              signal: AbortSignal.timeout(60_000),
            });
          } catch (error) {
            if (attempt < waitsMs.length) {
              await sleep(waitsMs[attempt]);
              continue;
            }
            throw error;
          }
          if (response.ok) {
            const json = await response.json();
            for (const row of json.embeddings ?? []) vectors.push(row.values);
            break;
          }
          let text = "";
          if (response.status === 429) text = await response.text().catch(() => "");
          else await response.body?.cancel();
          // A daily cap does not reopen within a run (2026-11-18: the free tier's 1,000 requests a day ran out mid-arm and
          // Mem0 went on without memory): stop retrying, flag it, and let the runner pause.
          if (response.status === 429 && /per ?day|PerDay/i.test(text)) {
            self.dailyCap = true;
            throw new Error("SessionBenchThirdParty: Gemini embeddings are at their daily cap");
          }
          if (EMBED_RETRY.test(String(response.status)) && attempt < waitsMs.length) {
            await sleep(waitsMs[attempt]);
            continue;
          }
          throw new Error(`SessionBenchThirdParty: Gemini embeddings answered ${response.status}`);
        }
      }
      if (vectors.length !== texts.length) throw new Error("SessionBenchThirdParty: Gemini returned the wrong number of embeddings");
      return { vectors, tokens: texts.reduce((sum, text) => sum + Math.ceil(String(text).length / 3.5), 0) };
    },
  };
  return self;
}

/**
 * The screen's embedder (plan 218.3 Task 12; owner 2026-11-19: "Local embedder (G10 deviation)", then "I want BGE-M3
 * for retrieval quality"): BAAI `bge-m3` (MIT; the FP16 GGUF `gpustack/bge-m3-GGUF` at a pinned revision, checked by
 * sha256), dense vectors (CLS pooling, 1,024 dimensions, normalised here), served by llama.cpp's `llama-server` built
 * with the Vulkan backend at a pinned tag and run on the discrete AMD GPU (RX 6550M, Navi 24, 4 GB). Built and downloaded into the cache,
 * never the workspace (`--install-embedder`). Mem0's default embedder is OpenAI `text-embedding-3-small`; this is a
 * recorded G10 deviation. Token counts are llama-server's own (`usage.prompt_tokens`).
 */
export const LOCAL_EMBEDDER = Object.freeze({
  provider: "llama.cpp",
  runtime: "llama.cpp llama-server, Vulkan backend (RADV), GPU offload of every layer",
  llamaCpp: Object.freeze({ repo: "https://github.com/ggml-org/llama.cpp.git", tag: "b12533" }),
  // Header-only build inputs, pinned to the installed Vulkan loader (1.4.363), cloned into the cache: no system package.
  vulkanHeaders: Object.freeze({ repo: "https://github.com/KhronosGroup/Vulkan-Headers.git", tag: "v1.4.363" }),
  spirvHeaders: Object.freeze({ repo: "https://github.com/KhronosGroup/SPIRV-Headers.git", tag: "vulkan-sdk-1.4.363.0" }),
  build: Object.freeze([
    "-DGGML_VULKAN=ON",
    "-DLLAMA_CURL=OFF",
    "-DLLAMA_BUILD_TESTS=OFF",
    "-DLLAMA_BUILD_EXAMPLES=OFF",
    "-DLLAMA_BUILD_SERVER=ON",
    "-DCMAKE_BUILD_TYPE=Release",
  ]),
  model: "gpustack/bge-m3-GGUF",
  base: "BAAI/bge-m3 (MIT)",
  revision: "2d48f1737679ad900d5c26c5aad5410e9c70fdca",
  file: "bge-m3-FP16.gguf",
  sha256: "daec91ffb5dd0c27411bd71f29932917c49cf529a641d0168496c3a501e3062c",
  dims: 1024,
  pooling: "cls",
  normalize: true,
  contextTokens: 8192,
  device: "the discrete GPU (AMD Radeon RX 6550M, RADV NAVI24, 4 GB): the Vulkan device whose name matches /NAVI ?24/i",
  tokens: "llama-server's usage.prompt_tokens",
  deviation:
    "Mem0's default embedder is OpenAI text-embedding-3-small; Gemini's free tier (Task 11) caps at 1,000 requests a day, so the owner chose a local embedder (2026-11-19) and then BGE-M3 for retrieval quality, on the GPU through llama.cpp/Vulkan: recorded as a G10 deviation",
});

/** `$PRISM_CACHE_DIR/session-bench/embedder-llamacpp-<tag>`: the llama.cpp checkout and build, and `models/`. */
export function embedderCacheDir(env = process.env) {
  return join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "session-bench", `embedder-llamacpp-${LOCAL_EMBEDDER.llamaCpp.tag}`);
}
const serverBin = (dir) => join(dir, "src/build/bin/llama-server");
const modelPath = (dir) => join(dir, "models", LOCAL_EMBEDDER.file);

/** Whether the cache holds llama-server built at the pinned tag and the model file at its pinned sha256. */
export function localEmbedderStatus(dir = embedderCacheDir()) {
  if (!existsSync(serverBin(dir))) return { installed: false, reason: `not built (${dir}); run arms/third-party.mjs --install-embedder` };
  let tag = "";
  try {
    tag = execFileSync("git", ["-C", join(dir, "src"), "describe", "--tags", "--exact-match"], { encoding: "utf8" }).trim();
  } catch {}
  if (tag !== LOCAL_EMBEDDER.llamaCpp.tag)
    return { installed: false, reason: `llama.cpp checkout is ${tag || "untagged"}, ${LOCAL_EMBEDDER.llamaCpp.tag} pinned` };
  if (!existsSync(modelPath(dir)) || sha256File(modelPath(dir)) !== LOCAL_EMBEDDER.sha256)
    return { installed: false, reason: `model ${LOCAL_EMBEDDER.file} is missing or differs from its pin` };
  return { installed: true, dir, model: LOCAL_EMBEDDER.model, revision: LOCAL_EMBEDDER.revision, tag };
}

/**
 * Clone llama.cpp, Vulkan-Headers and SPIRV-Headers at their tags, install SPIRV-Headers into `prefix/`, build
 * llama-server with Vulkan (niced, 8 jobs), download the pinned model, verify. Needs the system's Vulkan loader, a
 * Vulkan driver, glslc, cmake, ninja and a C++ compiler.
 */
export function installLocalEmbedder(dir = embedderCacheDir()) {
  mkdirSync(join(dir, "models"), { recursive: true });
  const run = (cmd, args, cwd = dir) => execFileSync(cmd, args, { cwd, stdio: "inherit", timeout: 3_000_000 });
  const clone = ({ repo, tag }, into) => {
    if (!existsSync(join(dir, into))) run("git", ["clone", "-q", "--depth", "1", "--branch", tag, repo, into]);
  };
  clone(LOCAL_EMBEDDER.llamaCpp, "src");
  clone(LOCAL_EMBEDDER.vulkanHeaders, "vulkan-headers");
  clone(LOCAL_EMBEDDER.spirvHeaders, "spirv-headers-src");
  run("cmake", [
    "-S",
    "spirv-headers-src",
    "-B",
    "spirv-headers-src/build",
    "-G",
    "Ninja",
    `-DCMAKE_INSTALL_PREFIX=${join(dir, "prefix")}`,
    "-DSPIRV_HEADERS_ENABLE_TESTS=OFF",
  ]);
  run("cmake", ["--install", "spirv-headers-src/build"]);
  run(
    "cmake",
    [
      "-S",
      ".",
      "-B",
      "build",
      "-G",
      "Ninja",
      ...LOCAL_EMBEDDER.build,
      `-DVulkan_INCLUDE_DIR=${join(dir, "vulkan-headers/include")}`,
      `-DCMAKE_PREFIX_PATH=${join(dir, "prefix")}`,
    ],
    join(dir, "src"),
  );
  run("nice", ["-n", "10", "cmake", "--build", "build", "--target", "llama-server", "-j", "8"], join(dir, "src"));
  if (!existsSync(modelPath(dir)) || sha256File(modelPath(dir)) !== LOCAL_EMBEDDER.sha256) {
    const url = `https://huggingface.co/${LOCAL_EMBEDDER.model}/resolve/${LOCAL_EMBEDDER.revision}/${LOCAL_EMBEDDER.file}`;
    run("curl", ["-sSfL", "-o", modelPath(dir), url]);
  }
  const status = localEmbedderStatus(dir);
  if (!status.installed) throw new Error(`SessionBenchThirdParty: embedder install did not verify: ${status.reason}`);
  return status;
}

/** The Vulkan device id of the discrete GPU, from `llama-server --list-devices` (the iGPU is never chosen). */
export function gpuDevice(dir = embedderCacheDir(), listing = undefined) {
  const text = listing ?? execFileSync(serverBin(dir), ["--list-devices"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const line = text.split("\n").find((row) => /Vulkan\d+:/.test(row) && /NAVI ?24/i.test(row));
  if (!line) throw new Error("SessionBenchThirdParty: no discrete Vulkan GPU found for the embedder");
  return line.match(/(Vulkan\d+):/)[1];
}

const l2 = (vector) => {
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
};
/** Inputs above the model's context are cut (about 3 characters per token, under 8,192 tokens), never sent whole. */
const MAX_EMBED_CHARS = 20_000;

/**
 * The local embedder: one llama-server per process on 127.0.0.1 (an ephemeral port) with the model on the discrete
 * GPU, started on first use and stopped when the process exits. `embed(texts)` → `{ vectors, tokens }`.
 */
export async function localEmbedder({ dir = embedderCacheDir(), startTimeoutMs = 120_000 } = {}) {
  const status = localEmbedderStatus(dir);
  if (!status.installed) throw new Error(`SessionBenchThirdParty: local embedder ${status.reason}`);
  const { spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
    probe.on("error", reject);
  });
  const ctx = LOCAL_EMBEDDER.contextTokens;
  const child = spawn(
    serverBin(dir),
    [
      "-m",
      modelPath(dir),
      "--embeddings",
      "--pooling",
      LOCAL_EMBEDDER.pooling,
      "--device",
      gpuDevice(dir),
      "-ngl",
      "99",
      "-c",
      String(ctx),
      "-b",
      String(ctx),
      "-ub",
      String(ctx),
      "--parallel",
      "1",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-webui",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let tail = "";
  child.stderr.on("data", (chunk) => {
    tail = (tail + chunk).slice(-4000);
  });
  const stop = () => child.kill("SIGTERM");
  process.once("exit", stop);
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`SessionBenchThirdParty: llama-server exited (${child.exitCode}): ${tail.slice(-500)}`);
    const ok = await fetch(`${base}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    if (Date.now() - started > startTimeoutMs) {
      stop();
      throw new Error("SessionBenchThirdParty: llama-server did not become healthy");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    dims: LOCAL_EMBEDDER.dims,
    model: `${LOCAL_EMBEDDER.provider}/${LOCAL_EMBEDDER.model}`,
    stop,
    async embed(texts) {
      const vectors = [];
      let tokens = 0;
      for (let at = 0; at < texts.length; at += 16) {
        const input = texts.slice(at, at + 16).map((text) => String(text).slice(0, MAX_EMBED_CHARS));
        const response = await fetch(`${base}/v1/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input, model: "bge-m3" }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`SessionBenchThirdParty: llama-server answered ${response.status}`);
        const json = await response.json();
        const rows = [...json.data].sort((a, b) => a.index - b.index);
        for (const row of rows) vectors.push(l2(row.embedding));
        tokens += json.usage?.prompt_tokens ?? 0;
      }
      if (vectors.length !== texts.length) throw new Error("SessionBenchThirdParty: llama-server returned the wrong number of embeddings");
      return { vectors, tokens };
    },
  };
}

/**
 * A local OpenAI-compatible endpoint for one arm session (127.0.0.1, an ephemeral port): `POST /v1/chat/completions`
 * → `chat({ messages, responseFormat })` → `{ text, usage? }`; `POST /v1/embeddings` → `embed(texts)` →
 * `{ vectors, tokens }`. A `chat` that throws answers 400 with the error message (a window overflow reads as one).
 */
export function startModelEndpoint({ chat, embed, meter }) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: { message: "invalid JSON" } }, { status: 400 });
      }
      try {
        if (path.endsWith("/embeddings")) {
          const input = [body.input].flat().map(String);
          const { vectors, tokens } = await embed(input);
          meter.embeddings.calls++;
          meter.embeddings.inputTokens += tokens;
          return Response.json({
            object: "list",
            model: body.model,
            data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
            usage: { prompt_tokens: tokens, total_tokens: tokens },
          });
        }
        if (path.endsWith("/chat/completions")) {
          const { text, usage } = await chat({ messages: body.messages ?? [], responseFormat: body.response_format });
          return Response.json({
            id: `sb-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
            usage: {
              prompt_tokens: usage?.inputTokens ?? 0,
              completion_tokens: usage?.outputTokens ?? 0,
              total_tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
            },
          });
        }
        return Response.json({ error: { message: `no route ${path}` } }, { status: 404 });
      } catch (error) {
        meter.thirdPartyErrors++;
        return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 400 });
      }
    },
  });
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

/**
 * One Mem0 instance for one arm session, at its documented defaults, its model and embedder pointed at `baseURL`, its
 * SQLite files in a private temporary directory removed on `close`. Returns `add(messages)` and `retrieve(query)`
 * (the context block text, or null when nothing is found).
 */
export async function createMem0Session({ sessionId, baseURL, dims, workerModel, dir = mem0CacheDir() }) {
  const status = mem0Status(dir);
  if (!status.installed) throw new Error(`SessionBenchThirdParty: Mem0 ${status.reason}`);
  // Telemetry and notices read these at module load and at call time; set before the import, never unset (one process).
  process.env.MEM0_TELEMETRY = "false";
  const home = mkdtempSync(join(tmpdir(), "session-bench-mem0-"));
  process.env.MEM0_DIR ??= join(tmpdir(), "session-bench-mem0-dir");
  const { Memory } = await import(pathToFileURL(join(dir, "node_modules/mem0ai/dist/oss/index.mjs")).href);
  const memory = new Memory({
    embedder: { provider: "openai", config: { apiKey: "session-bench-local", baseURL } },
    vectorStore: { provider: "memory", config: { collectionName: "memories", dimension: dims, dbPath: join(home, "vector_store.db") } },
    llm: { provider: "openai", config: { apiKey: "session-bench-local", baseURL, model: workerModel } },
    historyStore: { provider: "sqlite", config: { historyDbPath: join(home, "history.db") } },
  });
  const userId = sessionId;
  return {
    async add(messages) {
      const usable = messages.filter((message) => typeof message.content === "string" && message.content.trim());
      if (!usable.length) return { results: [] };
      return memory.add(usable, { userId });
    },
    async retrieve(query) {
      const found = await memory.search(query, { filters: { user_id: userId } });
      const lines = (found?.results ?? []).map((row) => `- ${row.memory}`);
      return lines.length ? `User Memories:\n${lines.join("\n")}` : null;
    },
    close() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--install")) console.log(JSON.stringify(installMem0()));
  else if (argv.includes("--install-embedder")) console.log(JSON.stringify(installLocalEmbedder()));
  else if (argv.includes("--check-embedder")) {
    const status = localEmbedderStatus();
    console.log(JSON.stringify(status));
    if (!status.installed) process.exit(1);
  } else if (argv.includes("--check")) {
    const status = mem0Status();
    console.log(JSON.stringify(status));
    if (!status.installed) process.exit(1);
  } else {
    for (const row of THIRD_PARTY_CANDIDATES)
      console.log(`${row.included ? "include" : "exclude"} ${row.id} ${row.version}${row.reason ? `: ${row.reason}` : ""}`);
  }
}
