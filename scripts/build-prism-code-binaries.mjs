#!/usr/bin/env bun
// Prism Code standalone binaries (plan 140 Task 3): `bun build --compile` of
// packages/prism-code/bin/prism-code.ts into one self-contained executable per target.
//
//   bun scripts/build-prism-code-binaries.mjs                         # host target → dist-bin/<target>/prism-code
//   bun scripts/build-prism-code-binaries.mjs --self-test --archive   # + behavior checks + prism-code-<target>.tar.gz
//   bun scripts/build-prism-code-binaries.mjs --target linux-x64-musl --out dist-bin
//   bun scripts/build-prism-code-binaries.mjs --checksums dist-bin    # SHA256SUMS over dist-bin/*.tar.gz
//
// Native-runner model: each target is compiled on its own platform, so the platform packages the
// binary embeds (the OpenTUI native library, the @napi-rs/keyring addon) are the ones installed for
// that host. `--cross` allows a foreign `--target` (documented fallback, not the release path).
//
// Guards, all fail-closed:
//   - Bun must be the pinned release (`PINNED_BUN`), the runtime every binary embeds;
//   - the target's native packages must be installed;
//   - the output may link only system libraries. A distro-packaged Bun linked against the system
//     ICU would copy that dependency into every binary: build with the official Bun (CI's
//     setup-bun, or the oven/bun image locally).
//
// The binary differs from the Bun install only by the `PRISM_CODE_VERSION` define. It does not
// auto-load `.env` or `bunfig.toml` from the working directory: an agent runs inside arbitrary
// repositories, and a repository `bunfig.toml` `preload` would otherwise execute repository code
// in the agent process. `playwright-core` (the optional peer behind the opt-in Obscura native
// browser tools) stays external; the tools report it as missing, as in a Bun install without it.
//
// Archives are deterministic: a ustar stream (fixed order, owner 0/0, mtime = SOURCE_DATE_EPOCH or
// the HEAD commit time) gzipped with a zeroed header mtime.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCheckRecorder, createPrismCodeSandbox, runPrismCodeChecks } from "./lib/prism-code-checks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PINNED_BUN = "1.4.2";
const ENTRY = join(root, "packages", "prism-code", "bin", "prism-code.ts");
/** Plan 140 Task 3 targets: cold `--version` < 150 ms, TUI first frame < 500 ms. */
const VERSION_BUDGET_MS = 150;
const FIRST_FRAME_BUDGET_MS = 500;
/** Shared CI runners are several times slower than a developer machine (533 ms on macos-15-intel). */
const CI_FIRST_FRAME_BUDGET_MS = 2_500;

/** Release targets → Bun compile target and the native packages each binary must embed. */
export const TARGETS = {
  "linux-x64": { platform: "linux", arch: "x64", libc: "glibc", openTui: "linux-x64", keyring: "linux-x64-gnu" },
  "linux-arm64": { platform: "linux", arch: "arm64", libc: "glibc", openTui: "linux-arm64", keyring: "linux-arm64-gnu" },
  "linux-x64-musl": { platform: "linux", arch: "x64", libc: "musl", openTui: "linux-x64-musl", keyring: "linux-x64-musl" },
  "linux-arm64-musl": { platform: "linux", arch: "arm64", libc: "musl", openTui: "linux-arm64-musl", keyring: "linux-arm64-musl" },
  "darwin-x64": { platform: "darwin", arch: "x64", openTui: "darwin-x64", keyring: "darwin-x64" },
  "darwin-arm64": { platform: "darwin", arch: "arm64", openTui: "darwin-arm64", keyring: "darwin-arm64" },
};

/** Shared-library allow-list for the portability guard (`ldd` / `otool -L` output). */
const SYSTEM_LIBRARY = {
  // Loader paths come absolute from ldd on some hosts and bare on others, and the glibc loader is
  // ld-linux-<arch>.so.<n> on every Linux arch (x86-64 ships it under /lib64, aarch64 under /lib);
  // musl reports libc.musl-<arch>.so.<n> or /lib/ld-musl-<arch>.so.<n>. Both spellings must pass or
  // the build fails its own portability guard.
  linux:
    /^(linux-vdso\.so|linux-gate\.so|lib(c|pthread|dl|m|rt)\.so|(\/.*\/)?ld-linux[^/]*\.so|(\/.*\/)?ld-musl-[^/]*\.so|(\/.*\/)?libc\.musl-[^/]*\.so)/,
  // The official musl Bun runtime itself links the C++ runtime: Alpine hosts need
  // `apk add libstdc++ libgcc` (documented), exactly as for Bun on Alpine.
  musl: /^(libstdc\+\+\.so\.6|libgcc_s\.so\.1)$/,
  darwin: /^(\/usr\/lib\/|\/System\/Library\/)/,
};

function hostTarget() {
  if (process.platform === "linux") {
    const glibc = process.report?.getReport()?.header?.glibcVersionRuntime;
    return `linux-${process.arch}${typeof glibc === "string" ? "" : "-musl"}`;
  }
  return `${process.platform}-${process.arch}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", ...options });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Linked shared libraries outside the system allow-list (empty = portable). */
function foreignLibraries(binary, target) {
  const { platform, libc } = TARGETS[target];
  if (platform === "linux") {
    const result = spawnSync("ldd", [binary], { encoding: "utf8" });
    if (result.error) throw new Error("ldd is required for the Linux portability guard");
    // A fully static binary prints "not a dynamic executable" / "statically linked" (exit 1 on glibc).
    if (/not a dynamic executable|statically linked/.test(`${result.stdout}${result.stderr}`)) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => name && !SYSTEM_LIBRARY.linux.test(name) && !(libc === "musl" && SYSTEM_LIBRARY.musl.test(name)));
  }
  const out = run("otool", ["-L", binary], { quiet: true });
  return out
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name && !SYSTEM_LIBRARY.darwin.test(name));
}

/** Minimal deterministic ustar writer: regular files only, owner 0/0, fixed mtime. */
export function tarEntries(entries, mtime) {
  const blocks = [];
  for (const { name, data, mode } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write(`${mtime.toString(8).padStart(11, "0")}\0`, 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function archiveMtime() {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH);
  const commit = spawnSync("git", ["log", "-1", "--format=%ct"], { cwd: root, encoding: "utf8" });
  return commit.status === 0 ? Number(commit.stdout.trim()) : 0;
}

function writeArchive(binary, target, outDir) {
  const file = join(outDir, `prism-code-${target}.tar.gz`);
  const tar = tarEntries(
    [
      { name: "prism-code", data: readFileSync(binary), mode: 0o755 },
      { name: "LICENSE", data: readFileSync(join(root, "packages", "prism-code", "LICENSE")), mode: 0o644 },
    ],
    archiveMtime(),
  );
  writeFileSync(file, gzipSync(tar, { level: 9 }));
  return file;
}

/** `sha256sum`-compatible SHA256SUMS over every archive in `dir`. */
export function writeChecksums(dir) {
  const archives = readdirSync(dir)
    .filter((name) => name.startsWith("prism-code-") && name.endsWith(".tar.gz"))
    .sort();
  if (archives.length === 0) throw new Error(`no prism-code-*.tar.gz archives in ${dir}`);
  const body = archives.map((name) => `${sha256(join(dir, name))}  ${name}\n`).join("");
  writeFileSync(join(dir, "SHA256SUMS"), body);
  return { file: join(dir, "SHA256SUMS"), archives };
}

async function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    if (index === -1) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  };

  const checksumsDir = option("--checksums");
  if (checksumsDir) {
    const { file, archives } = writeChecksums(resolve(checksumsDir));
    console.log(`wrote ${relative(process.cwd(), file)} (${archives.length} archives)`);
    process.stdout.write(readFileSync(file, "utf8"));
    return 0;
  }

  const target = option("--target") ?? hostTarget();
  const spec = TARGETS[target];
  if (!spec) throw new Error(`unknown target ${target}; expected one of ${Object.keys(TARGETS).join(", ")}`);
  const host = hostTarget();
  const cross = argv.includes("--cross");
  if (target !== host && !cross) {
    throw new Error(`target ${target} is not the host target ${host}: build on a native runner, or pass --cross (unverified fallback)`);
  }
  if (Bun.version !== PINNED_BUN) throw new Error(`Bun ${Bun.version} is not the pinned ${PINNED_BUN} that binaries embed`);

  for (const pkg of [`@opentui/core-${spec.openTui}`, `@napi-rs/keyring-${spec.keyring}`]) {
    if (!existsSync(join(root, "node_modules", pkg, "package.json"))) {
      throw new Error(`${pkg} is not installed; run \`bun ci\` on a ${target} host`);
    }
  }

  const manifestVersion = JSON.parse(readFileSync(join(root, "packages", "prism-code", "package.json"), "utf8")).version;
  const version = option("--version") ?? manifestVersion;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`invalid version ${version}`);
  const outDir = resolve(option("--out") ?? join(root, "dist-bin"));
  const targetDir = join(outDir, target);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  const binary = join(targetDir, "prism-code");

  console.log(`prism-code binary: ${target} @ ${version} (bun ${Bun.version}${cross ? ", cross" : ""})`);
  const buildStart = performance.now();
  run(
    process.execPath,
    [
      "build",
      "--compile",
      "--minify",
      "--bytecode",
      "--format=esm",
      `--target=bun-${spec.platform}-${spec.arch}${spec.libc === "musl" ? "-musl" : ""}`,
      "--external",
      "playwright-core",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--define",
      `PRISM_CODE_VERSION=${JSON.stringify(version)}`,
      ENTRY,
      "--outfile",
      binary,
    ],
    { cwd: root },
  );
  chmodSync(binary, 0o755);
  const buildMs = performance.now() - buildStart;
  const size = statSync(binary).size;

  const foreign = cross ? [] : foreignLibraries(binary, target);
  if (foreign.length > 0) {
    throw new Error(
      `${binary} links non-system libraries (${foreign.join(", ")}); build with the official Bun ${PINNED_BUN} (setup-bun or oven/bun)`,
    );
  }

  const report = { target, version, bun: Bun.version, bytes: size, sha256: sha256(binary), buildMs: Math.round(buildMs) };
  let failed = [];
  if (argv.includes("--self-test")) {
    if (cross) throw new Error("--self-test runs the binary and cannot be combined with --cross");
    // No Bun on the child PATH: the binary must run on a host without Bun.
    const sandbox = createPrismCodeSandbox("prism-code-binary-selftest");
    const recorder = createCheckRecorder();
    try {
      const timings = await runPrismCodeChecks({
        bin: binary,
        version,
        channel: "binary",
        sandbox,
        check: recorder.check,
        versionBudgetMs: VERSION_BUDGET_MS,
        firstFrameBudgetMs: process.env.CI ? CI_FIRST_FRAME_BUDGET_MS : FIRST_FRAME_BUDGET_MS,
        keychainProbe: true,
        userToolModule: true,
      });
      report.versionMedianMs = Math.round(timings.versionMedianMs);
      if (timings.firstFrameMs !== undefined) report.firstFrameMs = Math.round(timings.firstFrameMs);
    } finally {
      sandbox.cleanup();
    }
    failed = recorder.failed();
    report.selfTest =
      failed.length === 0 ? `PASS ${recorder.checks.length}/${recorder.checks.length}` : `FAIL ${failed.length}/${recorder.checks.length}`;
  }

  if (argv.includes("--archive")) {
    const archive = writeArchive(binary, target, outDir);
    report.archive = relative(outDir, archive);
    report.archiveBytes = statSync(archive).size;
    report.archiveSha256 = sha256(archive);
  }
  writeFileSync(join(targetDir, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return failed.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`build-prism-code-binaries: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
