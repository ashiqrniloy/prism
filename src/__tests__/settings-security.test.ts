import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPermission,
  assertTrusted,
  createChainedCredentialResolver,
  createChainedSettingsProvider,
  createMemoryCredentialStore,
  createSecretRedactor,
  createStaticPermissionPolicy,
  createStaticSettingsProvider,
  createStaticTrustPolicy,
  dispatchToolCall,
  loadTextResource,
  resolveCredentialValue,
  createToolRegistry,
} from "../index.js";
import { loadSettingsFiles } from "../node/settings.js";
import { createPathTrustPolicy, isPathInside, isPathInsideReal } from "../node/trust.js";

const tmp = () => mkdtemp(join(tmpdir(), "prism-test-"));

describe("settings auth trust security", () => {
  it("reads static chained and explicit node settings", async () => {
    const dir = await tmp();
    const file = join(dir, "settings.json");
    await writeFile(file, JSON.stringify({ demo: { enabled: true } }));

    const staticSettings = createStaticSettingsProvider({ demo: { enabled: false } });
    const nodeSettings = await loadSettingsFiles([{ name: "test", path: file }]);
    const chained = createChainedSettingsProvider([nodeSettings, staticSettings]);

    assert.equal(await chained.get("demo.enabled"), true);
    assert.equal(await loadSettingsFiles([{ name: "missing", path: join(dir, "missing.json"), optional: true }]).then((s) => s.get("x")), undefined);
  });

  it("resolves memory credentials and chains resolvers without env lookup", async () => {
    const store = createMemoryCredentialStore();
    store.set({ name: "api", provider: "demo", credential: { type: "api_key", value: "token-value" } });
    const chained = createChainedCredentialResolver([{ resolve: () => undefined }, store]);

    assert.equal(await resolveCredentialValue(chained, { name: "api", provider: "demo" }), "token-value");
    assert.equal(store.delete({ name: "api", provider: "demo" }), true);
    assert.equal(await resolveCredentialValue(store, { name: "api", provider: "demo" }), undefined);
  });

  it("denies trust permissions and resource loads before side effects", async () => {
    await assert.rejects(() => assertTrusted(createStaticTrustPolicy(false), { kind: "resource", target: "x" }), /Untrusted/);
    await assert.rejects(() => assertPermission(createStaticPermissionPolicy({ allow: ["tool:echo:execute"] }), { kind: "tool", target: "other", action: "execute" }), /Permission/);

    let loaded = false;
    await assert.rejects(
      () => loadTextResource({ load: async (uri) => { loaded = true; return { uri, text: "x" }; } }, "memory:x", { permission: createStaticPermissionPolicy(false) }),
      /Permission denied/,
    );
    assert.equal(loaded, false);
  });

  it("checks normalized path trust roots", async () => {
    const dir = await tmp();
    const root = join(dir, "root");
    const file = join(root, "file");
    await mkdir(root, { recursive: true });
    await writeFile(file, "");

    assert.equal(isPathInside(root, file), true);
    assert.equal(isPathInside(root, join(root, "..", "sibling")), false);
    assert.equal((await createPathTrustPolicy({ trustedRoots: [root] }).check({ kind: "resource", target: file })).trusted, true);
  });

  it("rejects symlink escape from trusted root", async () => {
    const dir = await tmp();
    const root = join(dir, "root");
    const outside = join(dir, "outside");
    const link = join(root, "escape");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, link);

    const target = join(link, "secret.txt");
    assert.equal(isPathInside(root, target), true);
    assert.equal(await isPathInsideReal(root, target), false);
    const decision = await createPathTrustPolicy({ trustedRoots: [root] }).check({ kind: "resource", target });
    assert.equal(decision.trusted, false);
  });

  it("accepts realpath inside trusted root through symlinked root", async () => {
    const dir = await tmp();
    const root = join(dir, "root");
    const file = join(root, "file");
    await mkdir(root, { recursive: true });
    await writeFile(file, "");
    const link = join(dir, "link");
    await symlink(root, link);

    assert.equal(await isPathInsideReal(link, file), true);
    assert.equal((await createPathTrustPolicy({ trustedRoots: [link] }).check({ kind: "resource", target: file })).trusted, true);
  });

  it("fails closed when trusted root cannot be resolved", async () => {
    assert.equal(await isPathInsideReal("/nonexistent/root", "/nonexistent/root/file"), false);
  });

  it("blocks extension setup before side effects", async () => {
    const { createExtensionKernel } = await import("../index.js");
    let setup = false;
    const kernel = createExtensionKernel({ permission: createStaticPermissionPolicy(false) });

    await kernel.load([{ name: "demo", setup: () => { setup = true; } }]);

    assert.equal(setup, false);
  });

  it("blocks tool permission before validation and execution", async () => {
    let validated = false;
    let executed = false;
    const result = await dispatchToolCall({
      call: { type: "tool_call", id: "c1", name: "echo", arguments: {} },
      registry: createToolRegistry([{ name: "echo", execute: () => { executed = true; return { toolCallId: "c1", name: "echo" }; } }]),
      context: { sessionId: "s1", runId: "r1", toolCallId: "c1" },
      permission: createStaticPermissionPolicy(false),
      validate: () => { validated = true; },
    });

    assert.equal(result.error?.code, "ERR_PRISM_PERMISSION_DENIED");
    assert.equal(validated, false);
    assert.equal(executed, false);
  });

  it("redacts known secrets through redactor helper", () => {
    const redactor = createSecretRedactor(["token-value"]);
    assert.deepEqual(redactor.redact({ text: "token-value" }), { text: "[REDACTED]" });
  });
});
