/**
 * Plan 218.1 Task 2: the pinned Compact-Bench checkout and dataset.
 *
 * Compact-Bench (arXiv 2610.31710, Apache-2.0) is untrusted upstream code. It is fetched into its own cache directory,
 * never into the Prism tree, at a pinned commit; its dataset is fetched at a pinned Hugging Face revision and every file
 * is checked against the revision's `SHA256SUMS`, whose own hash is pinned here. Any mismatch is refused and the bad
 * bytes are deleted. Upstream then reads the data through `CB_DATA_MIRROR` (a strictly local copy), so it never
 * downloads anything itself.
 *
 * ```sh
 * bun scripts/memory-bench/external/compact-bench/fetch.mjs [--revision <hf-commit>] [--sums-sha256 <hex>]
 * ```
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/** The pins (checkout and download of 2026-11-13). A new pin is a criteria amendment, never a silent update. */
export const COMPACT_BENCH_PIN = Object.freeze({
  code: Object.freeze({
    repository: "https://github.com/cai-jianfeng/compact-bench",
    commit: "9dd9a3f5a91b2de5acdf56cee2fc0a4d16dcefc5",
  }),
  dataset: Object.freeze({
    repository: "caijanfeng/compact-bench",
    revision: "ff20521e6a2293ba74317efb076f0c338ca5fb6b",
    /** sha256 of the revision's `SHA256SUMS` file. */
    sha256sums: "94a7c6975d773538ca7122313fa21015fdc13b82fadbc33afc9cfbd08bb620fc",
  }),
});

export class CompactBenchFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "CompactBenchFetchError";
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** The cache root: `$PRISM_CACHE_DIR/compact-bench` (default `~/.cache/prism/compact-bench`). */
export function compactBenchCacheRoot(env = process.env) {
  return join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "compact-bench");
}

/** Where a pin lives on disk: the checkout and the data mirror, each named by its pinned revision. */
export function compactBenchPaths(pin = COMPACT_BENCH_PIN, root = compactBenchCacheRoot()) {
  return {
    root,
    code: join(root, `code-${pin.code.commit}`),
    data: join(root, `data-${pin.dataset.revision}`),
  };
}

/**
 * Parse `SHA256SUMS` (`<hex>  <relative path>` per line). Refuses anything that is not a plain relative path under the
 * dataset, so a hostile list cannot name a file outside the mirror.
 */
export function parseSha256Sums(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) [ *]?(.+)$/.exec(line.trim());
    if (!match) throw new CompactBenchFetchError(`SHA256SUMS: malformed line ${JSON.stringify(line.slice(0, 80))}`);
    const path = match[2];
    if (path.startsWith("/") || path.includes("\\") || path.includes(":") || path.split("/").some((part) => part === ".." || part === ""))
      throw new CompactBenchFetchError(`SHA256SUMS: refused path ${JSON.stringify(path)}`);
    entries.push({ sha256: match[1], path });
  }
  if (!entries.length) throw new CompactBenchFetchError("SHA256SUMS: empty");
  return entries;
}

function assertPin(pin) {
  if (!HEX40.test(pin.code.commit)) throw new CompactBenchFetchError("pin: code commit must be a full 40-hex commit");
  if (!HEX40.test(pin.dataset.revision))
    throw new CompactBenchFetchError("pin: dataset revision must be a full 40-hex commit, not a branch");
  if (!HEX64.test(pin.dataset.sha256sums)) throw new CompactBenchFetchError("pin: SHA256SUMS hash must be 64-hex");
}

const resolveUrl = (pin, path) =>
  `https://huggingface.co/datasets/${pin.dataset.repository}/resolve/${pin.dataset.revision}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function download(transport, url) {
  const response = await transport(url, { headers: { "user-agent": "prism-memory-bench" } });
  if (!response.ok) throw new CompactBenchFetchError(`download ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Fetch (or re-verify) the pinned dataset into `dir`. Files already present are re-hashed; a present file with the
 * wrong hash is refused, never overwritten silently. Returns the parsed sums and the `SHA256SUMS` hash.
 */
export async function fetchCompactBenchData({ pin = COMPACT_BENCH_PIN, dir, fetch: transport = fetch } = {}) {
  assertPin(pin);
  const target = resolve(dir);
  await mkdir(target, { recursive: true });
  const sumsPath = join(target, "SHA256SUMS");
  const sumsBytes = existsSync(sumsPath) ? await readFile(sumsPath) : await download(transport, resolveUrl(pin, "SHA256SUMS"));
  const sumsHash = sha256(sumsBytes);
  if (sumsHash !== pin.dataset.sha256sums) {
    await rm(sumsPath, { force: true });
    throw new CompactBenchFetchError(`SHA256SUMS hash ${sumsHash} does not match the pin ${pin.dataset.sha256sums}`);
  }
  if (!existsSync(sumsPath)) await writeFile(sumsPath, sumsBytes);
  const entries = parseSha256Sums(new TextDecoder().decode(sumsBytes));
  for (const entry of entries) {
    const file = join(target, entry.path);
    if (!file.startsWith(target + sep)) throw new CompactBenchFetchError(`refused path ${entry.path}`);
    if (existsSync(file)) {
      const actual = sha256(await readFile(file));
      if (actual !== entry.sha256) throw new CompactBenchFetchError(`${entry.path}: sha256 ${actual} does not match SHA256SUMS`);
      continue;
    }
    const bytes = await download(transport, resolveUrl(pin, entry.path));
    const actual = sha256(bytes);
    if (actual !== entry.sha256) throw new CompactBenchFetchError(`${entry.path}: downloaded sha256 ${actual} does not match SHA256SUMS`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.part`, bytes);
    await rename(`${file}.part`, file);
  }
  return { entries, sha256sums: sumsHash };
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 }).trim();

/**
 * Clone (or re-verify) the pinned checkout. Refuses a checkout whose HEAD is not the pin, one with local changes, and
 * one carrying a `.env` (upstream's `run.py` would load credentials from it).
 */
export function fetchCompactBenchCode({ pin = COMPACT_BENCH_PIN, dir } = {}) {
  assertPin(pin);
  const target = resolve(dir);
  if (!existsSync(join(target, ".git"))) {
    execFileSync("git", ["clone", "--quiet", "--no-checkout", pin.code.repository, target], { stdio: "ignore", timeout: 300_000 });
    git(["-c", "advice.detachedHead=false", "checkout", "--quiet", pin.code.commit], target);
  }
  verifyCompactBenchCode({ pin, dir: target });
  return { commit: pin.code.commit };
}

export function verifyCompactBenchCode({ pin = COMPACT_BENCH_PIN, dir }) {
  const head = git(["rev-parse", "HEAD"], dir);
  if (head !== pin.code.commit) throw new CompactBenchFetchError(`checkout HEAD ${head} is not the pinned ${pin.code.commit}`);
  if (git(["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)results", ":(exclude)work", ":(exclude)data"], dir))
    throw new CompactBenchFetchError("checkout has local changes");
  if (existsSync(join(dir, ".env"))) throw new CompactBenchFetchError("checkout carries a .env; upstream would load it");
}

/** Fetch both pins. */
export async function fetchCompactBench({ pin = COMPACT_BENCH_PIN, root = compactBenchCacheRoot(), fetch: transport = fetch } = {}) {
  const paths = compactBenchPaths(pin, root);
  fetchCompactBenchCode({ pin, dir: paths.code });
  const data = await fetchCompactBenchData({ pin, dir: paths.data, fetch: transport });
  return {
    paths,
    codeRevision: pin.code.commit,
    datasetRevision: pin.dataset.revision,
    sha256sums: data.sha256sums,
    files: data.entries.length,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const pin = {
    code: COMPACT_BENCH_PIN.code,
    dataset: {
      ...COMPACT_BENCH_PIN.dataset,
      ...(flag("--revision") ? { revision: flag("--revision") } : {}),
      ...(flag("--sums-sha256") ? { sha256sums: flag("--sums-sha256") } : {}),
    },
  };
  const result = await fetchCompactBench({ pin });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
