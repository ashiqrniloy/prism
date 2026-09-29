/**
 * Plan 140 Task 4: `install.sh` against a local HTTPS fixture server (a test-only self-signed cert
 * is generated with openssl at test time, so no private key is committed). Covers success,
 * latest-version resolution, pinned versions, checksum mismatch, upgrade-in-place, uninstall, PATH
 * handling (`--modify-path`), and unsupported platforms.
 *
 * The host `sh` leg runs in the gate chain (no network, no docker) and covers the glibc path. The
 * Alpine musl leg runs when `PRISM_INSTALL_SH_DOCKER=1` and docker is available — the binaries
 * workflow sets it; `apk add curl` is the only network access there.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { TARGETS, tarEntries } from "./build-prism-code-binaries.mjs";

const ROOT = join(import.meta.dirname, "..");
const INSTALL_SH = join(ROOT, "install.sh");
const RELEASES_PATH = "/releases/download";
const DOCKER = process.env.PRISM_TEST_DOCKER_BIN ?? "docker";

const state = { latest: "0.4.0", corruptChecksums: false, requests: [] };
const tempDirs = [];
let certPath = "";
let server;
let port = 0;
let base = "";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Fake release binary: a shell script, so every host and container can run it. */
function archive(version) {
  return gzipSync(
    tarEntries(
      [
        { name: "prism-code", data: Buffer.from(`#!/bin/sh\necho "${version} (binary)"\n`), mode: 0o755 },
        { name: "LICENSE", data: Buffer.from("MIT\n"), mode: 0o644 },
      ],
      1_790_640_000,
    ),
  );
}

function handleRequest(request, response) {
  const url = request.url ?? "";
  state.requests.push(url);
  if (url === "/@arnilo/prism-code/latest") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ name: "@arnilo/prism-code", version: state.latest }));
    return;
  }
  const match = url.match(/^\/releases\/download\/prism-code-v([^/]+)\/(prism-code-.+\.tar\.gz|SHA256SUMS)$/);
  if (!match) {
    response.writeHead(404);
    response.end();
    return;
  }
  const [, version, name] = match;
  if (name === "SHA256SUMS") {
    const body = Object.keys(TARGETS)
      .sort()
      .map((target) => `${state.corruptChecksums ? "0".repeat(64) : sha256(archive(version))}  prism-code-${target}.tar.gz\n`)
      .join("");
    response.writeHead(200);
    response.end(body);
    return;
  }
  response.writeHead(200);
  response.end(archive(version));
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-install-sh-cert-"));
  tempDirs.push(dir);
  const keyPath = join(dir, "key.pem");
  certPath = join(dir, "cert.pem");
  const opensslConfig = join(dir, "openssl.cnf");
  writeFileSync(
    opensslConfig,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = v3",
      "prompt = no",
      "[dn]",
      "CN = localhost",
      "[v3]",
      "subjectAltName = DNS:localhost, IP:127.0.0.1",
      "",
    ].join("\n"),
  );
  const generated = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "3650", "-config", opensslConfig],
    { encoding: "utf8" },
  );
  if (generated.status !== 0) throw new Error(`openssl is required for the HTTPS fixture server: ${generated.stderr}`);
  server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  base = `https://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  state.latest = "0.4.0";
  state.corruptChecksums = false;
  state.requests.length = 0;
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "prism-install-sh-"));
  tempDirs.push(home);
  return home;
}

function installerEnv(home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    PRISM_HOME: join(home, ".prism"),
    SHELL: "/bin/bash",
    LANG: "C.UTF-8",
    CURL_CA_BUNDLE: certPath,
    PRISM_CODE_REGISTRY_BASE_URL: base,
    PRISM_CODE_RELEASE_BASE_URL: `${base}${RELEASES_PATH}`,
    ...extra,
  };
}

async function runInstaller(home, { args = [], env = {}, shell = "sh" } = {}) {
  const child = Bun.spawn([shell, INSTALL_SH, ...args], {
    env: installerEnv(home, env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, status };
}

function installedBin(home) {
  return join(home, ".prism", "bin", "prism-code");
}

function expectedHostTarget() {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const musl = os === "linux" && !process.report?.getReport()?.header?.glibcVersionRuntime;
  return `${os}-${arch}${musl ? "-musl" : ""}`;
}

function requestedRows() {
  return state.requests.filter((url) => url.endsWith(".tar.gz"));
}

describe("install.sh", () => {
  it("installs the latest version atomically with a verified checksum", async () => {
    const home = makeHome();
    const result = await runInstaller(home);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const bin = installedBin(home);
    expect(statSync(bin).mode & 0o777).toBe(0o755);
    expect(statSync(join(home, ".prism")).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, ".prism", "bin")).mode & 0o777).toBe(0o700);
    expect(spawnSync(bin, { encoding: "utf8" }).stdout.trim()).toBe("0.4.0 (binary)");
    // One version request, one archive, one checksum download.
    expect(state.requests.filter((url) => url.endsWith("/latest")).length).toBe(1);
    expect(requestedRows()).toEqual([`${RELEASES_PATH}/prism-code-v0.4.0/prism-code-${expectedHostTarget()}.tar.gz`]);
    expect(state.requests.filter((url) => url.endsWith("/SHA256SUMS")).length).toBe(1);
    // PATH hint for the detected shell, and no rc edit without --modify-path.
    expect(result.stdout).toContain(`export PATH="${join(home, ".prism", "bin")}:$PATH"`);
    expect(result.stdout).toContain("--modify-path");
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
  });

  it("pins --version and skips the registry", async () => {
    const home = makeHome();
    state.latest = "9.9.9";
    const result = await runInstaller(home, { args: ["--version", "0.4.0"] });
    expect(result.status).toBe(0);
    expect(state.requests.some((url) => url.endsWith("/latest"))).toBe(false);
    expect(spawnSync(installedBin(home), { encoding: "utf8" }).stdout.trim()).toBe("0.4.0 (binary)");
  });

  it("rejects a non-semver version before building any URL", async () => {
    const home = makeHome();
    const result = await runInstaller(home, { args: ["--version", "0.4.0; touch pwned"] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid version");
    expect(state.requests).toEqual([]);
    expect(existsSync(installedBin(home))).toBe(false);
  });

  it("aborts on a checksum mismatch and leaves the installed binary alone", async () => {
    const home = makeHome();
    expect((await runInstaller(home)).status).toBe(0);
    const before = readFileSync(installedBin(home));
    state.latest = "0.4.1";
    state.corruptChecksums = true;
    const result = await runInstaller(home);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("checksum mismatch");
    expect(readFileSync(installedBin(home))).toEqual(before);
  });

  it("upgrades in place and removes the binary (not user data) with --uninstall", async () => {
    const home = makeHome();
    expect((await runInstaller(home)).status).toBe(0);
    state.latest = "0.4.1";
    expect((await runInstaller(home)).status).toBe(0);
    expect(spawnSync(installedBin(home), { encoding: "utf8" }).stdout.trim()).toBe("0.4.1 (binary)");
    mkdirSync(join(home, ".prism", "sessions"), { recursive: true });
    writeFileSync(join(home, ".prism", "config.json"), "{}\n");
    const uninstall = await runInstaller(home, { args: ["--uninstall"] });
    expect(uninstall.status).toBe(0);
    expect(existsSync(installedBin(home))).toBe(false);
    expect(existsSync(join(home, ".prism", "config.json"))).toBe(true);
    expect(uninstall.stdout).toContain(`rm -rf "${join(home, ".prism")}"`);
  });

  it("edits the shell rc only with --modify-path, once", async () => {
    const home = makeHome();
    expect((await runInstaller(home, { args: ["--modify-path"] })).status).toBe(0);
    const rc = join(home, ".bashrc");
    const line = `export PATH="${join(home, ".prism", "bin")}:$PATH"`;
    expect(readFileSync(rc, "utf8")).toContain(line);
    expect((await runInstaller(home, { args: ["--modify-path"] })).status).toBe(0);
    expect(readFileSync(rc, "utf8").split(line).length - 1).toBe(1);
    // fish gets fish_add_path in its own rc.
    const fishHome = makeHome();
    expect((await runInstaller(fishHome, { args: ["--modify-path"], env: { SHELL: "/usr/bin/fish" } })).status).toBe(0);
    const fishRc = join(fishHome, ".config", "fish", "config.fish");
    expect(readFileSync(fishRc, "utf8")).toContain(`fish_add_path "${join(fishHome, ".prism", "bin")}"`);
  });

  it("rejects unsupported platforms with the Bun-channel pointer", async () => {
    const home = makeHome();
    const shim = join(home, "shim");
    mkdirSync(shim, { recursive: true });
    const stub = (body) => {
      const file = join(shim, "uname");
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
    };
    stub('case "$1" in -s) echo MINGW64_NT-10.0 ;; *) echo x86_64 ;; esac');
    let result = await runInstaller(home, { env: { PATH: `${shim}:${process.env.PATH}` } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bun add -g @arnilo/prism-code");
    stub('case "$1" in -s) echo Linux ;; *) echo riscv64 ;; esac');
    result = await runInstaller(home, { env: { PATH: `${shim}:${process.env.PATH}` } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsupported architecture");
  });
});

const dockerEnabled =
  process.platform === "linux" &&
  process.env.PRISM_INSTALL_SH_DOCKER === "1" &&
  spawnSync(DOCKER, ["info"], { stdio: "ignore" }).status === 0;
const dockerIt = dockerEnabled ? it : it.skip;

async function runInContainer(image, { alpine = false } = {}) {
  const home = makeHome();
  const command = alpine ? "apk add --no-cache curl >/dev/null 2>&1 && sh /repo/install.sh" : "sh /repo/install.sh";
  const child = Bun.spawn(
    [
      DOCKER,
      "run",
      "--rm",
      "--network",
      "host",
      "-v",
      `${ROOT}:/repo:ro`,
      "-v",
      `${certPath}:/cert.pem:ro`,
      "-v",
      `${home}:/work`,
      "-e",
      "CURL_CA_BUNDLE=/cert.pem",
      "-e",
      `PRISM_CODE_REGISTRY_BASE_URL=${base}`,
      "-e",
      `PRISM_CODE_RELEASE_BASE_URL=${base}${RELEASES_PATH}`,
      "-e",
      "PRISM_HOME=/work/.prism",
      "-e",
      "HOME=/work",
      "-e",
      "SHELL=/bin/sh",
      image,
      "sh",
      "-ec",
      command,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
  return home;
}

dockerIt(
  "installs inside a musl container and detects musl",
  async () => {
    state.latest = "0.4.0";
    const home = await runInContainer("oven/bun:1.4.2-alpine", { alpine: true });
    expect(requestedRows().at(-1)).toContain(`prism-code-linux-${process.arch === "arm64" ? "arm64" : "x64"}-musl.tar.gz`);
    expect(readFileSync(installedBin(home), "utf8")).toContain("0.4.0");
  },
  300_000,
);
