import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyFlagOverlay,
  ensureHomeDir,
  mergePrismCodeConfigLayers,
  PrismCodeConfigError,
  parseFlags,
  parsePrismCodeConfigLayer,
  readGlobalConfig,
  readState,
  resolvePrismCodeVersion,
  resolvePrismHome,
  writeState,
} from "../index.js";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "prism-code-home-"));
}

test("resolvePrismHome honors an absolute PRISM_HOME and rejects a relative one", () => {
  assert.equal(resolvePrismHome({ PRISM_HOME: "/tmp/custom-prism" }), "/tmp/custom-prism");
  assert.throws(
    () => resolvePrismHome({ PRISM_HOME: "relative/home" }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("PRISM_HOME must be an absolute path"));
      return true;
    },
  );
  assert.match(resolvePrismHome({}), /[\\/]\.prism$/);
});

test("ensureHomeDir creates a 0700 home", () => {
  const home = join(makeHome(), "nested", "prism-home");
  try {
    assert.equal(ensureHomeDir(home), home);
    assert.ok(statSync(home).isDirectory());
    if (process.platform !== "win32") assert.equal(statSync(home).mode & 0o777, 0o700);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readGlobalConfig parses the global layer and resolves relative paths against the home", () => {
  const home = makeHome();
  try {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        userId: "alice",
        store: { type: "sqlite", path: "sessions.db" },
        model: { provider: "anthropic", model: "claude-sonnet-4-5" },
      }),
      "utf8",
    );
    const global = readGlobalConfig(home);
    assert.ok(global);
    assert.equal(global.config.userId, "alice");
    assert.equal(global.config.store?.type === "sqlite" ? global.config.store.path : undefined, join(home, "sessions.db"));
    assert.equal(global.config.cwd, undefined);
    assert.equal(global.path, join(home, "config.json"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readGlobalConfig rejects cwd and unknown keys, naming the file", () => {
  const home = makeHome();
  try {
    const path = join(home, "config.json");
    writeFileSync(path, JSON.stringify({ cwd: "." }), "utf8");
    assert.throws(
      () => readGlobalConfig(home),
      (err: unknown) => {
        assert(err instanceof PrismCodeConfigError);
        assert(err.message.includes(path));
        assert(err.message.includes("project-only"));
        return true;
      },
    );

    writeFileSync(path, JSON.stringify({ bogusKey: 1 }), "utf8");
    assert.throws(
      () => readGlobalConfig(home),
      (err: unknown) => {
        assert(err instanceof PrismCodeConfigError);
        assert(err.message.includes(path));
        assert(err.message.includes("unknown key(s): bogusKey"));
        return true;
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("layer precedence: project overrides global, CLI flags override both; absent layer keys do not clobber", () => {
  const global = parsePrismCodeConfigLayer(JSON.stringify({ userId: "alice", model: { provider: "anthropic", model: "global" } }));
  const project = parsePrismCodeConfigLayer(JSON.stringify({ model: { provider: "openai", model: "project" } }), "/repo");
  const merged = mergePrismCodeConfigLayers([global, project], "/workspace");
  assert.equal(merged.userId, "alice");
  assert.equal(merged.cwd, "/workspace");
  assert.equal(merged.model?.provider, "openai");
  assert.equal(merged.model?.model, "project");

  const flagged = applyFlagOverlay(merged, parseFlags(["--model", "xai/grok-4"]));
  assert.equal(flagged.model?.provider, "xai");
  assert.equal(flagged.model?.model, "grok-4");
});

test("mcp.servers concatenate across layers and a duplicate serverId is replaced by the later layer", () => {
  const global = parsePrismCodeConfigLayer(
    JSON.stringify({
      mcp: {
        servers: [
          { serverId: "a", command: "global-a" },
          { serverId: "b", command: "global-b" },
        ],
      },
    }),
  );
  const project = parsePrismCodeConfigLayer(
    JSON.stringify({
      mcp: {
        servers: [
          { serverId: "b", command: "project-b" },
          { serverId: "c", command: "project-c" },
        ],
      },
    }),
    "/repo",
  );
  const merged = mergePrismCodeConfigLayers([global, project]);
  assert.deepEqual(
    merged.mcp?.servers?.map((s) => s.serverId),
    ["a", "b", "c"],
  );
  const b = merged.mcp?.servers?.find((s) => s.serverId === "b");
  assert.ok(b && "command" in b && b.command === "project-b");
});

test("skills.dirs concatenate across layers and de-duplicate by path", () => {
  const global = parsePrismCodeConfigLayer(JSON.stringify({ skills: { dirs: ["/shared/skills"] } }));
  const project = parsePrismCodeConfigLayer(JSON.stringify({ skills: { dirs: ["/shared/skills", "/repo/skills"] } }), "/repo");
  const merged = mergePrismCodeConfigLayers([global, project]);
  assert.deepEqual(merged.skills?.dirs, ["/shared/skills", "/repo/skills"]);
});

test("corrupt state.json is backed up, ignored with a notice, and never fatal", () => {
  const home = makeHome();
  try {
    writeFileSync(join(home, "state.json"), "{ not json", "utf8");
    const { state, notice } = readState(home);
    assert.deepEqual(state, {});
    assert.ok(notice?.includes("corrupt state file"));
    assert.ok(existsSync(join(home, "state.json.bak")));
    assert.ok(!existsSync(join(home, "state.json")));

    // Non-object root counts as corrupt too.
    writeFileSync(join(home, "state.json"), "[1,2,3]", "utf8");
    assert.deepEqual(readState(home).state, {});
    assert.ok(existsSync(join(home, "state.json.bak")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("state writes are 0600, round-trip, and merge partial patches", () => {
  const home = makeHome();
  try {
    writeState(home, { lastModel: { provider: "anthropic", model: "claude-sonnet-4-5" } });
    writeState(home, { lastEffort: "high" });
    const path = join(home, "state.json");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).lastModel.provider, "anthropic");
    assert.equal(readState(home).state.lastEffort, "high");
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolvePrismCodeVersion matches the package manifest", () => {
  let dir = dirname(fileURLToPath(import.meta.url));
  let version: string | undefined;
  for (let depth = 0; depth < 4 && version === undefined; depth++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
      if (manifest.name === "@arnilo/prism-code") version = manifest.version;
    }
    dir = dirname(dir);
  }
  assert.ok(version);
  assert.equal(resolvePrismCodeVersion(), version);
});

test("the bin prints the manifest version for --version without touching the home", () => {
  const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
    ? resolve(__dirname, "../../../bin/prism-code.ts")
    : resolve(__dirname, "../../bin/prism-code.ts");
  const home = makeHome();
  try {
    const result = spawnSync(process.execPath, [binPath, "--version"], {
      encoding: "utf8",
      env: { ...process.env, PRISM_HOME: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `${resolvePrismCodeVersion()} (bun)`);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
