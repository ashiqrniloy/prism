import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrismCodeConfig, PrismCodeConfigError, parsePrismCodeConfig, validatePrismCodeConfig } from "../index.js";

test("rejects invalid JSON with PrismCodeConfigError", () => {
  assert.throws(
    () => parsePrismCodeConfig("{ invalid json"),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert.equal(err.code, "ERR_PRISM_CODE_CONFIG");
      assert(err.message.includes("invalid JSON"));
      return true;
    },
  );
});

test("rejects non-object root config", () => {
  assert.throws(
    () => validatePrismCodeConfig("not an object"),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("config must be a JSON object"));
      return true;
    },
  );
});

test("accepts credentials.store values and rejects anything else", () => {
  for (const store of ["auto", "keychain", "file", "encrypted-file", "memory"] as const) {
    assert.equal(parsePrismCodeConfig(JSON.stringify({ credentials: { store } })).credentials?.store, store);
  }
  assert.throws(
    () => parsePrismCodeConfig(JSON.stringify({ credentials: { store: "plaintext" } })),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert.match(err.message, /credentials\.store must be one of/);
      return true;
    },
  );
  assert.throws(
    () => parsePrismCodeConfig(JSON.stringify({ credentials: { path: "/tmp/x" } })),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert.match(err.message, /unknown key\(s\): path/);
      return true;
    },
  );
});

test("rejects unknown root keys with key name", () => {
  assert.throws(
    () => validatePrismCodeConfig({ userId: "local", bogusKey: 123 }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("unknown key(s): bogusKey"));
      return true;
    },
  );
});

test("accepts store.type sqlite without path and store.type memory", () => {
  assert.deepEqual(parsePrismCodeConfig(JSON.stringify({ store: { type: "sqlite" } })).store, { type: "sqlite" });
  assert.deepEqual(parsePrismCodeConfig(JSON.stringify({ store: { type: "memory" } })).store, { type: "memory" });
});

test("rejects unknown nested keys in tools, mcp, and store", () => {
  assert.throws(
    () => validatePrismCodeConfig({ tools: { rogue: true } }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("unknown key(s): rogue"));
      return true;
    },
  );

  assert.throws(
    () => validatePrismCodeConfig({ mcp: { servers: [], invalid: true } }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("unknown key(s): invalid"));
      return true;
    },
  );

  assert.throws(
    () => validatePrismCodeConfig({ store: { type: "sqlite", path: "test.db", extra: 1 } }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("unknown key(s): extra"));
      return true;
    },
  );
});

test("rejects invalid credentialRef with control characters or excessive length", () => {
  assert.throws(
    () => validatePrismCodeConfig({ credentialRef: "KEY\nVALUE" }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("control characters"));
      return true;
    },
  );

  assert.throws(
    () => validatePrismCodeConfig({ credentialRef: "A".repeat(300) }),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("exceeds maximum length"));
      return true;
    },
  );
});

test("resolves relative paths in cwd, store, skills, hooks, and instructions against baseDir", () => {
  const tmp = join(tmpdir(), `prism-code-config-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(join(tmp, "sub-workspace"), { recursive: true });

  try {
    const raw = {
      cwd: "sub-workspace",
      store: { type: "sqlite", path: "sessions.db" },
      skills: { dirs: ["skills-dir"] },
      hooks: { file: "hooks.json" },
      instructions: {
        agentsMd: "CUSTOM_AGENTS.md",
        systemMd: "CUSTOM_SYSTEM.md",
      },
      tools: {
        add: ["./tools/custom.mjs#myTool"],
        replace: { read: "./tools/read.mjs" },
      },
    };

    const validated = validatePrismCodeConfig(raw, tmp);

    assert.equal(validated.cwd, join(tmp, "sub-workspace"));
    assert.equal(validated.store?.type, "sqlite");
    if (validated.store?.type === "sqlite") {
      assert.equal(validated.store.path, join(tmp, "sessions.db"));
    }
    assert.deepEqual(validated.skills?.dirs, [join(tmp, "skills-dir")]);
    assert.equal(validated.hooks?.file, join(tmp, "hooks.json"));
    assert.equal(validated.instructions?.agentsMd, join(tmp, "CUSTOM_AGENTS.md"));
    assert.equal(validated.instructions?.systemMd, join(tmp, "CUSTOM_SYSTEM.md"));
    assert.deepEqual(validated.tools?.add, [join(tmp, "tools/custom.mjs#myTool")]);
    assert.deepEqual(validated.tools?.replace, { read: join(tmp, "tools/read.mjs") });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadPrismCodeConfig loads and parses config file from disk", () => {
  const tmp = join(tmpdir(), `prism-code-load-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const cfgPath = join(tmp, "prism-code.json");

  try {
    writeFileSync(
      cfgPath,
      JSON.stringify({
        userId: "test-user",
        model: { provider: "mock", model: "test-model" },
      }),
      "utf8",
    );

    const loaded = loadPrismCodeConfig(cfgPath);
    assert.equal(loaded.userId, "test-user");
    assert.equal(loaded.model?.provider, "mock");
    assert.equal(loaded.model?.model, "test-model");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadPrismCodeConfig fails closed when file does not exist", () => {
  assert.throws(
    () => loadPrismCodeConfig("/nonexistent/prism-code.json"),
    (err: unknown) => {
      assert(err instanceof PrismCodeConfigError);
      assert(err.message.includes("cannot read config file"));
      return true;
    },
  );
});
