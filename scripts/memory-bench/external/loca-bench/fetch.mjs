/**
 * Plan 218.1 Task 4: the pinned LOCA-Bench checkout and its locked environment.
 *
 * LOCA-Bench (HKUST, arXiv 2602.07962, MIT) is untrusted upstream code. It is cloned into its own cache directory,
 * never into the Prism tree, at a pinned commit, and its MIT licence file is checked by hash. Its environment is built
 * only from the locks committed beside this file, so nothing resolves at run time:
 *
 * - Python 3.12 (upstream requires `>=3.10,<3.13`) with every dependency from `lock/requirements.lock`, installed with
 *   `--require-hashes`. The lock was resolved with `--exclude-newer 2026-04-29` (the pinned commit's date), so it is the
 *   environment upstream ran in, not today's;
 * - `excel-mcp-server` in a venv of its own (`lock/excel.lock`): it needs an `mcp` that `fastmcp` 3.x refuses, so the
 *   two cannot share one environment (`uvx` would isolate it the same way);
 * - the two npm MCP servers upstream starts with `npx` (`lock/node-package-lock.json`, `npm ci --ignore-scripts`);
 * - the `cl100k_base` tiktoken file upstream's ReAct loop loads, checked by hash;
 * - a `.pth` file that puts the checkout on the venv's path, which is what upstream's `pip install -e .` does (its
 *   preprocessing scripts run as subprocesses and import `gem`). The checkout itself is never written to.
 *
 * ```sh
 * timeout 1800 bun scripts/memory-bench/external/loca-bench/fetch.mjs
 * ```
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LOCK_DIR = new URL("./lock/", import.meta.url);
const lockPath = (name) => new URL(name, LOCK_DIR).pathname;

/** The pins (checkout of 2026-11-17). A new pin is a criteria amendment, never a silent update. */
export const LOCA_BENCH_PIN = Object.freeze({
  code: Object.freeze({
    repository: "https://github.com/hkust-nlp/LOCA-bench",
    commit: "8b6fac49d9edd92922593e703b74ea255357c3ec",
    /** sha256 of the checkout's `LICENSE` (MIT License, "Copyright (c) 2025 LOCA-bench Contributors"). */
    licenseSha256: "2bb75401bf1c737039d17c6defda15c2f37eb2b5eb62facbf6dea50bf72811c2",
  }),
  python: "3.12",
  /** The bootstrap `uv` that builds the venvs (installed with pip into a throwaway venv of the system Python). */
  uv: "0.13.8",
  /** `tiktoken`'s cache file for `cl100k_base` (named by the sha1 of its URL), by content hash. */
  tiktoken: Object.freeze({
    file: "9b5ad71b2ce5302211f9c61530b329a4922fc6a4",
    sha256: "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
  }),
});

export class LocaBenchFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocaBenchFetchError";
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** The committed lock files, by name, and one hash over all of them (it names the environment directory). */
export function locaBenchLocks() {
  const names = ["requirements.lock", "excel.lock", "node-package.json", "node-package-lock.json"];
  const files = Object.fromEntries(names.map((name) => [name, sha256(readFileSync(lockPath(name)))]));
  return { files, hash: sha256(JSON.stringify(files)) };
}

/** The cache root: `$PRISM_CACHE_DIR/loca-bench` (default `~/.cache/prism/loca-bench`). */
export function locaBenchCacheRoot(env = process.env) {
  return join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "loca-bench");
}

/** Where a pin lives on disk: the checkout (by commit) and the environment (by the locks' hash). */
export function locaBenchPaths(pin = LOCA_BENCH_PIN, root = locaBenchCacheRoot(), locks = locaBenchLocks()) {
  const env = join(root, `env-${locks.hash.slice(0, 16)}`);
  return {
    root,
    code: join(root, `code-${pin.code.commit}`),
    env,
    venv: join(env, "venv"),
    python: join(env, "venv", "bin", "python"),
    excelVenv: join(env, "venv-excel"),
    nodeModules: join(env, "node", "node_modules"),
    tiktoken: join(env, "tiktoken"),
    bootstrap: join(root, `bootstrap-uv-${pin.uv}`),
    pythonInstalls: join(root, "python"),
    uvCache: join(root, "uv-cache"),
    marker: join(env, "ready.json"),
  };
}

function assertPin(pin) {
  if (!HEX40.test(pin.code.commit)) throw new LocaBenchFetchError("pin: code commit must be a full 40-hex commit");
  if (!HEX64.test(pin.code.licenseSha256)) throw new LocaBenchFetchError("pin: licence hash must be 64-hex");
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 }).trim();

/**
 * Refuse any tree but the pinned one: HEAD must be the pinned commit, the tree clean (upstream's own output
 * directories excepted), no `.env` (upstream's runner calls `load_dotenv()`; the seam disables it, and this is the
 * second fence), and the `LICENSE` file present, MIT, and byte-identical to the pinned hash.
 */
export function verifyLocaBenchCode({ pin = LOCA_BENCH_PIN, dir }) {
  assertPin(pin);
  if (!existsSync(join(dir, ".git"))) throw new LocaBenchFetchError(`${dir} is not a checkout`);
  const head = git(["rev-parse", "HEAD"], dir);
  if (head !== pin.code.commit) throw new LocaBenchFetchError(`checkout HEAD ${head} is not the pinned ${pin.code.commit}`);
  if (git(["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)outputs", ":(exclude)tasks"], dir))
    throw new LocaBenchFetchError("checkout has local changes");
  if (existsSync(join(dir, ".env"))) throw new LocaBenchFetchError("checkout carries a .env; upstream would load it");
  const license = join(dir, "LICENSE");
  if (!existsSync(license)) throw new LocaBenchFetchError("checkout has no LICENSE file");
  const bytes = readFileSync(license);
  if (!bytes.toString("utf8").startsWith("MIT License")) throw new LocaBenchFetchError("LICENSE is not the MIT licence");
  const hash = sha256(bytes);
  if (hash !== pin.code.licenseSha256) throw new LocaBenchFetchError(`LICENSE sha256 ${hash} does not match the pin`);
  return { commit: head, licenseSha256: hash };
}

/** Clone (or re-verify) the pinned checkout. */
export function fetchLocaBenchCode({ pin = LOCA_BENCH_PIN, dir } = {}) {
  assertPin(pin);
  const target = resolve(dir);
  if (!existsSync(join(target, ".git"))) {
    execFileSync("git", ["clone", "--quiet", "--no-checkout", pin.code.repository, target], { stdio: "ignore", timeout: 600_000 });
    git(["-c", "advice.detachedHead=false", "checkout", "--quiet", pin.code.commit], target);
  }
  return verifyLocaBenchCode({ pin, dir: target });
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: ["ignore", "inherit", "inherit"], timeout: 1_800_000, ...options });

/** The environment the build tools see: no credentials, no user site, the cache directories. */
function buildEnv(paths) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: homedir(),
    LANG: "C.UTF-8",
    UV_CACHE_DIR: paths.uvCache,
    UV_PYTHON_INSTALL_DIR: paths.pythonInstalls,
    UV_NO_CONFIG: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
  };
}

/** Build (or re-verify) the locked environment. A finished build is recorded in `ready.json` with the locks' hashes. */
export function buildLocaBenchEnv({ pin = LOCA_BENCH_PIN, paths = locaBenchPaths(pin), locks = locaBenchLocks() } = {}) {
  if (existsSync(paths.marker)) {
    const ready = JSON.parse(readFileSync(paths.marker, "utf8"));
    if (ready.locks === locks.hash && ready.commit === pin.code.commit) return verifyLocaBenchEnv({ pin, paths });
    throw new LocaBenchFetchError(`${paths.env} was built from other locks; remove it to rebuild`);
  }
  const env = buildEnv(paths);
  mkdirSync(paths.env, { recursive: true });
  const uv = join(paths.bootstrap, "bin", "uv");
  if (!existsSync(uv)) {
    run("python3", ["-m", "venv", paths.bootstrap], { env });
    run(join(paths.bootstrap, "bin", "pip"), ["install", "--quiet", `uv==${pin.uv}`], { env });
  }
  for (const [venv, lock] of [
    [paths.venv, "requirements.lock"],
    [paths.excelVenv, "excel.lock"],
  ]) {
    if (!existsSync(join(venv, "bin", "python"))) run(uv, ["venv", "--quiet", "--python", pin.python, venv], { env });
    run(uv, ["pip", "sync", "--quiet", "--require-hashes", "--python", join(venv, "bin", "python"), lockPath(lock)], { env });
  }
  // What upstream's `pip install -e .` adds: the checkout on the venv's path (its preprocessing subprocesses import gem).
  const site = join(paths.venv, "lib", `python${pin.python}`, "site-packages");
  writeFileSync(join(site, "loca_bench_checkout.pth"), `${join(paths.root, `code-${pin.code.commit}`)}\n`);
  const node = join(paths.env, "node");
  mkdirSync(node, { recursive: true });
  copyFileSync(lockPath("node-package.json"), join(node, "package.json"));
  copyFileSync(lockPath("node-package-lock.json"), join(node, "package-lock.json"));
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: node, env });
  mkdirSync(paths.tiktoken, { recursive: true });
  run(paths.python, ["-I", "-c", "import tiktoken; tiktoken.get_encoding('cl100k_base')"], {
    env: { ...env, TIKTOKEN_CACHE_DIR: paths.tiktoken },
  });
  const verified = verifyLocaBenchEnv({ pin, paths });
  writeFileSync(
    paths.marker,
    `${JSON.stringify({ commit: pin.code.commit, locks: locks.hash, lockFiles: locks.files, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return verified;
}

/** The pieces the seam runs: both venvs, the npm servers, the tiktoken file by hash, the `.pth` naming the checkout. */
export function verifyLocaBenchEnv({ pin = LOCA_BENCH_PIN, paths = locaBenchPaths(pin) } = {}) {
  const required = [
    paths.python,
    join(paths.venv, "bin", "pdf-tools-mcp"),
    join(paths.venv, "bin", "cli-mcp-server"),
    join(paths.excelVenv, "bin", "excel-mcp-server"),
    join(paths.nodeModules, ".bin", "mcp-server-filesystem"),
    join(paths.nodeModules, ".bin", "mcp-server-memory"),
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length) throw new LocaBenchFetchError(`environment incomplete: ${missing.join(", ")}`);
  const tiktoken = join(paths.tiktoken, pin.tiktoken.file);
  if (!existsSync(tiktoken) || sha256(readFileSync(tiktoken)) !== pin.tiktoken.sha256)
    throw new LocaBenchFetchError("tiktoken cl100k_base file missing or not the pinned bytes");
  const extra = readdirSync(paths.tiktoken).filter((name) => name !== pin.tiktoken.file && !name.endsWith(".tmp"));
  if (extra.length) throw new LocaBenchFetchError(`tiktoken cache holds unpinned files: ${extra.join(", ")}`);
  const pth = join(paths.venv, "lib", `python${pin.python}`, "site-packages", "loca_bench_checkout.pth");
  if (!existsSync(pth) || readFileSync(pth, "utf8").trim() !== paths.code)
    throw new LocaBenchFetchError("the venv's .pth does not name the pinned checkout");
  return { env: paths.env };
}

/** The seam's own check that the pinned upstream still has the lines it relies on. */
export function locaSeamSelfCheck({ paths = locaBenchPaths() } = {}) {
  const out = execFileSync(paths.python, ["-I", new URL("./seam.py", import.meta.url).pathname, "self-check", "--code", paths.code], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    timeout: 120_000,
  });
  return JSON.parse(out);
}

/** Fetch the checkout, build the environment, run the seam self-check. */
export function fetchLocaBench({ pin = LOCA_BENCH_PIN, root = locaBenchCacheRoot() } = {}) {
  const locks = locaBenchLocks();
  const paths = locaBenchPaths(pin, root, locks);
  const code = fetchLocaBenchCode({ pin, dir: paths.code });
  buildLocaBenchEnv({ pin, paths, locks });
  const seam = locaSeamSelfCheck({ paths });
  return { paths, codeRevision: code.commit, licenseSha256: code.licenseSha256, locks: locks.hash, lockFiles: locks.files, seam };
}

if (import.meta.main) {
  const result = fetchLocaBench();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
