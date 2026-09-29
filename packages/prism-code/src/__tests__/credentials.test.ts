import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryStoredCredentialStore,
  PrismCodeCredentialManager,
  parsePrismCodeConfig,
  resolveProvider,
  selectCredentialStore,
} from "../index.js";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "prism-code-credentials-"));
}

const probeUnavailable = async () => ({ status: "unavailable" }) as const;
const probeAvailable = async () => ({ status: "available" }) as const;

test("explicit credentials.store skips the keychain probe and builds the named store", async () => {
  const home = makeHome();
  let probed = 0;
  try {
    const selection = await selectCredentialStore({
      config: parsePrismCodeConfig(JSON.stringify({ credentials: { store: "file" } })),
      state: {},
      home,
      probeKeychain: async () => {
        probed += 1;
        return { status: "unavailable" };
      },
    });
    assert.equal(selection.needsChoice, false);
    assert.equal(selection.choice, "file");
    assert.equal(probed, 0);

    await selection.manager.setApiKey("anthropic", "sk-ant-file");
    const path = join(home, "auth.json");
    assert.ok(readFileSync(path, "utf8").includes("sk-ant-file"));
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto uses the keychain when the probe succeeds and never persists a choice", async () => {
  const home = makeHome();
  try {
    const selection = await selectCredentialStore({ config: parsePrismCodeConfig("{}"), state: {}, home, probeKeychain: probeAvailable });
    assert.equal(selection.choice, "keychain");
    assert.equal(selection.needsChoice, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto with an unavailable keychain and no saved choice asks for a choice without prompting", async () => {
  const home = makeHome();
  try {
    const selection = await selectCredentialStore({
      config: parsePrismCodeConfig("{}"),
      state: {},
      home,
      probeKeychain: probeUnavailable,
    });
    assert.equal(selection.needsChoice, true);
    assert.equal(selection.choice, undefined);
    assert.ok(selection.notice?.includes("no credential store selected"));

    // Until the picker answer arrives the store fails closed, and getApiKey still sees ambient env.
    await assert.rejects(selection.manager.setApiKey("anthropic", "sk-ant-nope"), /no credential store selected/);
    const previous = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-ambient";
      assert.equal(await selection.manager.getApiKey("anthropic"), "sk-ant-ambient");
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }

    // The TUI picker answer installs the store on the same manager instance.
    await selection.apply("memory");
    await selection.manager.setApiKey("anthropic", "sk-ant-session");
    assert.equal(await selection.manager.getApiKey("anthropic"), "sk-ant-session");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a saved choice is used when the keychain probe is unavailable", async () => {
  const home = makeHome();
  try {
    writeFileSync(join(home, "auth.json"), JSON.stringify({ version: 1, entries: {} }), { mode: 0o600 });
    const selection = await selectCredentialStore({
      config: parsePrismCodeConfig("{}"),
      state: { credentialStore: "file" },
      home,
      probeKeychain: probeUnavailable,
    });
    assert.equal(selection.needsChoice, false);
    assert.equal(selection.choice, "file");
    await selection.manager.setApiKey("openai", "sk-openai-file");
    const reopened = await selectCredentialStore({
      config: parsePrismCodeConfig("{}"),
      state: { credentialStore: "file" },
      home,
      probeKeychain: probeUnavailable,
    });
    assert.equal(await reopened.manager.getApiKey("openai"), "sk-openai-file");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("encrypted-file without a passphrase fails with an actionable notice", async () => {
  const home = makeHome();
  try {
    const selection = await selectCredentialStore({
      config: parsePrismCodeConfig(JSON.stringify({ credentials: { store: "encrypted-file" } })),
      state: {},
      home,
      probeKeychain: probeUnavailable,
      env: {},
    });
    assert.equal(selection.choice, "encrypted-file");
    await assert.rejects(selection.manager.setApiKey("anthropic", "sk-ant-enc"), /PRISM_CREDENTIALS_PASSPHRASE/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("encrypted-file with PRISM_CREDENTIALS_PASSPHRASE round-trips through the manager", async () => {
  const home = makeHome();
  try {
    const env = { PRISM_CREDENTIALS_PASSPHRASE: "correct horse battery staple" };
    const first = await selectCredentialStore({
      config: parsePrismCodeConfig(JSON.stringify({ credentials: { store: "encrypted-file" } })),
      state: {},
      home,
      env,
      probeKeychain: probeUnavailable,
    });
    await first.manager.setApiKey("anthropic", "sk-ant-encrypted");

    const second = await selectCredentialStore({
      config: parsePrismCodeConfig(JSON.stringify({ credentials: { store: "encrypted-file" } })),
      state: {},
      home,
      env,
      probeKeychain: probeUnavailable,
    });
    assert.equal(await second.manager.getApiKey("anthropic"), "sk-ant-encrypted");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a key saved through the manager is found by getApiKey, createResolver, and provider resolution (OM worker path)", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
    await manager.setApiKey("anthropic", "sk-ant-stored");
    assert.equal(await manager.getApiKey("anthropic"), "sk-ant-stored");
    assert.equal((await manager.getStore().get({ name: "apiKey", provider: "anthropic" }))?.value, "sk-ant-stored");

    const resolver = manager.createResolver();
    assert.equal(await resolver("ANTHROPIC_API_KEY"), "sk-ant-stored");
    assert.equal(await resolver("SOME_OTHER_REF"), undefined);

    // Observational memory resolves its worker provider with exactly this resolver.
    const provider = await resolveProvider({ provider: "anthropic", model: "claude-sonnet-4-5" }, { resolver });
    assert.ok(provider);
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("one manager instance is shared across selection, resolver, and OM-facing credential reads", async () => {
  const manager = new PrismCodeCredentialManager({ disableKeychain: true });
  const resolver = manager.createResolver();
  await manager.setApiKey("xai", "xai-stored");
  assert.equal(await resolver("XAI_API_KEY"), "xai-stored");
  assert.equal(manager.getStore(), manager.getStore());
});
