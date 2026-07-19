import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { refreshOAuthCredential } from "@arnilo/prism";
import {
  CredentialDecryptError,
  CredentialStoreLockedError,
  CredentialStoreTimeoutError,
  CredentialStoreUnavailableError,
  HARD_MAX_ENVELOPE_FILE_BYTES,
  HARD_MAX_KEYCHAIN_PAYLOAD_BYTES,
  HARD_KEYCHAIN_TIMEOUT_MS,
  WeakKdfParametersError,
  createEncryptedCredentialStore,
  createOAuthCredentialStoreAdapter,
  createStoredCredentialResolver,
  decryptBytes,
  encryptBytes,
  openEncryptedCredentialStore,
  resolveScryptParameters,
  rotateEncryptedCredentialStorePassphrase,
} from "../index.js";
import { assertRestrictiveFileMode } from "../file-io.js";
import { runKeychainOperation } from "../keychain-store.js";
import { parseVault } from "../vault.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function tempCredentialPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-creds-"));
  tempDirs.push(dir);
  return join(dir, `${name}.vault`);
}

describe("encrypted credential envelope", () => {
  it("round-trips plaintext with authenticated encryption", async () => {
    const plaintext = Buffer.from(JSON.stringify({ secret: "value" }), "utf8");
    const envelope = await encryptBytes(plaintext, "correct-passphrase");
    const decrypted = await decryptBytes(envelope, "correct-passphrase");
    assert.equal(decrypted.toString("utf8"), plaintext.toString("utf8"));
    decrypted.fill(0);
  });

  it("fails closed on wrong passphrase", async () => {
    const envelope = await encryptBytes(Buffer.from("payload"), "correct-passphrase");
    await assert.rejects(decryptBytes(envelope, "wrong-passphrase"), CredentialDecryptError);
  });

  it("fails closed on tampered ciphertext", async () => {
    const envelope = await encryptBytes(Buffer.from("payload"), "pass");
    const tampered = {
      ...envelope,
      ciphertext: Buffer.from(envelope.ciphertext, "base64").subarray(0, -1).toString("base64"),
    };
    await assert.rejects(decryptBytes(tampered, "pass"), CredentialDecryptError);
  });

  it("rejects weak or excessive scrypt parameters before work", () => {
    for (const scrypt of [
      { N: 1024 },
      { N: 16_385 },
      { N: 524_288 },
      { r: 33 },
      { p: 17 },
      { keyLength: 64 },
      { N: 262_144, r: 8, p: 2 },
    ]) assert.throws(() => resolveScryptParameters(scrypt), WeakKdfParametersError);
    assert.throws(() => resolveScryptParameters(undefined, Infinity));
    assert.equal(resolveScryptParameters({ N: 262_144, r: 8, p: 1 }).N, 262_144);
  });

  it("rejects malformed envelope shapes and base64 before KDF", async () => {
    const envelope = await encryptBytes(Buffer.from("payload"), "pass");
    const malformed = [
      { ...envelope, version: 2 },
      { ...envelope, extra: true },
      { ...envelope, kdf: { ...envelope.kdf, extra: true } },
      { ...envelope, kdf: { ...envelope.kdf, salt: "not-base64" } },
      { ...envelope, cipher: { ...envelope.cipher, algorithm: "aes-128-gcm" } },
      { ...envelope, cipher: { ...envelope.cipher, iv: "AA==" } },
      { ...envelope, ciphertext: "" },
      { ...envelope, kdf: { ...envelope.kdf, keyLength: 64 } },
    ];
    for (const value of malformed) await assert.rejects(decryptBytes(value as typeof envelope, "pass"));
    await assert.rejects(decryptBytes(envelope, "pass", { maxVaultBytes: 1 }), CredentialDecryptError);
  });

  it("bounds and validates decrypted vault JSON", () => {
    assert.throws(() => parseVault(Buffer.alloc(65), 64), /exceeds byte limit/);
    assert.throws(() => parseVault(Buffer.from(JSON.stringify({ version: 1, entries: {}, extra: true }))));
    assert.throws(() => parseVault(Buffer.from(JSON.stringify({
      version: 1,
      entries: { bad: { kind: "credential", name: "api", credential: { type: "api_key", value: "value" }, updatedAt: "now" } },
    }))));
  });

  it("runs scrypt without blocking the event loop", async () => {
    let timerAdvanced = false;
    const timer = setTimeout(() => { timerAdvanced = true; }, 0);
    await encryptBytes(Buffer.from("payload"), "pass");
    clearTimeout(timer);
    assert.equal(timerAdvanced, true);
  });
});

describe("createEncryptedCredentialStore", () => {
  it("persists credentials across reopen", async () => {
    const path = tempCredentialPath("roundtrip");
    const first = await openEncryptedCredentialStore({ path, getPassphrase: () => "phase-4-pass" });
    await first.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "secret-value" } });
    await first.setOAuth("demo", { access: "access-token", refresh: "refresh-token", accountId: "acct-1" }, "acct-1");

    const second = await openEncryptedCredentialStore({ path, getPassphrase: () => "phase-4-pass" });
    const credential = await second.get({ name: "apiKey", provider: "demo" });
    assert.equal(credential?.value, "secret-value");
    const oauth = await second.getOAuth("demo", "acct-1");
    assert.equal(oauth?.access, "access-token");
    assert.equal(oauth?.refresh, "refresh-token");
  });

  it("isolates namespaces by provider and account", async () => {
    const path = tempCredentialPath("namespace");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    await store.set({ name: "apiKey", provider: "alpha", credential: { type: "api_key", value: "alpha-key" } });
    await store.set({ name: "apiKey", provider: "beta", credential: { type: "api_key", value: "beta-key" } });
    await store.setOAuth("alpha", { access: "alpha-access" }, "one");
    await store.setOAuth("alpha", { access: "alpha-two" }, "two");

    assert.equal((await store.get({ name: "apiKey", provider: "alpha" }))?.value, "alpha-key");
    assert.equal((await store.get({ name: "apiKey", provider: "beta" }))?.value, "beta-key");
    assert.equal((await store.getOAuth("alpha", "one"))?.access, "alpha-access");
    assert.equal((await store.getOAuth("alpha", "two"))?.access, "alpha-two");
  });

  it("deletes credentials and oauth rows", async () => {
    const path = tempCredentialPath("delete");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    await store.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "secret" } });
    await store.setOAuth("demo", { access: "token" });
    assert.equal(await store.delete({ name: "apiKey", provider: "demo" }), true);
    assert.equal(await store.deleteOAuth("demo"), true);
    assert.equal(await store.get({ name: "apiKey", provider: "demo" }), undefined);
    assert.equal(await store.getOAuth("demo"), undefined);
  });

  it("resolves credentials through createStoredCredentialResolver", async () => {
    const path = tempCredentialPath("resolver");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    await store.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "resolved" } });
    const resolver = createStoredCredentialResolver(store);
    const credential = await resolver.resolve({ name: "apiKey", provider: "demo" });
    assert.equal(credential?.value, "resolved");
  });

  it("integrates with refreshOAuthCredential via OAuth adapter", async () => {
    const path = tempCredentialPath("oauth");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    const oauthStore = createOAuthCredentialStoreAdapter(store);
    await oauthStore.set("demo", { access: "old", refresh: "refresh" });
    const refreshed = await refreshOAuthCredential({
      provider: {
        id: "demo",
        login: async () => ({ access: "unused" }),
        refresh: async () => ({ access: "new", refresh: "refresh" }),
      },
      credentials: { access: "old", refresh: "refresh" },
      store: oauthStore,
    });
    assert.equal(refreshed.access, "new");
    assert.equal((await oauthStore.get("demo"))?.access, "new");
  });

  it("rotates passphrase while preserving records", async () => {
    const path = tempCredentialPath("rotate");
    const first = await openEncryptedCredentialStore({ path, getPassphrase: () => "old-pass" });
    await first.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "kept" } });

    await rotateEncryptedCredentialStorePassphrase({
      path,
      getCurrentPassphrase: () => "old-pass",
      getNewPassphrase: () => "new-pass",
    });

    await assert.rejects(
      () => openEncryptedCredentialStore({ path, getPassphrase: () => "old-pass" }),
      CredentialDecryptError,
    );
    const reopened = await openEncryptedCredentialStore({ path, getPassphrase: () => "new-pass" });
    assert.equal((await reopened.get({ name: "apiKey", provider: "demo" }))?.value, "kept");
  });

  it("writes credential files with restrictive permissions on unix", async () => {
    if (process.platform === "win32") return;
    const path = tempCredentialPath("mode");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass", fileMode: 0o600 });
    await store.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "secret" } });
    assertRestrictiveFileMode(path);
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("does not write plaintext secrets to disk", async () => {
    const path = tempCredentialPath("plaintext-scan");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    await store.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "super-secret-token" } });
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("super-secret-token"), false);
    assert.equal(raw.includes("apiKey"), false);
  });

  it("survives crash-safe atomic rewrite pattern", async () => {
    const path = tempCredentialPath("atomic");
    const store = createEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    await store.set({ name: "one", provider: "demo", credential: { type: "api_key", value: "first" } });
    await store.set({ name: "two", provider: "demo", credential: { type: "api_key", value: "second" } });
    const reopened = await openEncryptedCredentialStore({ path, getPassphrase: () => "pass" });
    assert.deepEqual(
      (await reopened.list()).map((row) => row.name).sort(),
      ["one", "two"],
    );
  });

  it("rejects reopen with wrong passphrase", async () => {
    const path = tempCredentialPath("wrong-key");
    const store = await openEncryptedCredentialStore({ path, getPassphrase: () => "good" });
    await store.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "secret" } });
    await assert.rejects(
      openEncryptedCredentialStore({ path, getPassphrase: () => "bad" }),
      CredentialDecryptError,
    );
  });

  it("rejects oversized files before parse or passphrase retrieval", async () => {
    const path = tempCredentialPath("oversized");
    writeFileSync(path, "x", { mode: 0o600 });
    truncateSync(path, 1025);
    let requested = false;
    await assert.rejects(
      openEncryptedCredentialStore({
        path,
        getPassphrase: () => { requested = true; return "pass"; },
        limits: { maxFileBytes: 1024 },
      }),
      /exceeds 1024 byte limit/,
    );
    assert.equal(requested, false);
  });

  it("rejects malformed JSON and unknown envelope fields before passphrase retrieval", async () => {
    for (const raw of ["{", JSON.stringify({ version: 1, extra: true })]) {
      const path = tempCredentialPath("malformed");
      writeFileSync(path, raw, { mode: 0o600 });
      let requested = false;
      await assert.rejects(openEncryptedCredentialStore({
        path,
        getPassphrase: () => { requested = true; return "pass"; },
      }), CredentialDecryptError);
      assert.equal(requested, false);
    }
  });

  it("fails closed on permissive existing files before passphrase retrieval", async () => {
    if (process.platform === "win32") return;
    const path = tempCredentialPath("permissive");
    writeFileSync(path, "{}", { mode: 0o644 });
    chmodSync(path, 0o644);
    let requested = false;
    await assert.rejects(openEncryptedCredentialStore({
      path,
      getPassphrase: () => { requested = true; return "pass"; },
    }), /permissions are too permissive/);
    assert.equal(requested, false);
  });

  it("validates file, vault, KDF-memory, and file-mode limits at construction", () => {
    const path = tempCredentialPath("limits");
    for (const limits of [
      { maxFileBytes: 0 },
      { maxFileBytes: HARD_MAX_ENVELOPE_FILE_BYTES + 1 },
      { maxVaultBytes: Infinity },
      { maxScryptMemoryBytes: 0 },
      { maxScryptMemoryBytes: 1 },
    ]) assert.throws(() => createEncryptedCredentialStore({ path, getPassphrase: () => "pass", limits }));
    assert.throws(() => createEncryptedCredentialStore({ path, getPassphrase: () => "pass", fileMode: 0o644 }));
  });

  it("sanitizes passphrase retrieval failures without mutating state", async () => {
    const path = tempCredentialPath("passphrase-error");
    const store = createEncryptedCredentialStore({ path, getPassphrase: () => { throw new Error("secret-value"); } });
    try {
      await store.set({ name: "api", credential: { type: "api_key", value: "value" } });
      assert.fail("expected passphrase failure");
    } catch (error) {
      assert.equal(String(error).includes("secret-value"), false);
    }
    assert.deepEqual(await store.list(), []);
  });

  it("rejects oversized plaintext before writing and leaves no temp file", async () => {
    const path = tempCredentialPath("vault-limit");
    const store = createEncryptedCredentialStore({
      path,
      getPassphrase: () => "pass",
      limits: { maxVaultBytes: 64 },
    });
    await assert.rejects(async () => store.set({
      name: "apiKey",
      provider: "demo",
      credential: { type: "api_key", value: "x".repeat(100) },
    }), /vault exceeds byte limit/i);
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(readdirSync(join(path, "..")), []);
  });
});

describe("keychain credential store", () => {
  it("aborts and rejects a hung async operation at the finite timeout", async () => {
    let aborted = false;
    const started = Date.now();
    await assert.rejects(
      runKeychainOperation((signal) => new Promise<never>(() => {
        signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      }), 20),
      CredentialStoreTimeoutError,
    );
    assert.equal(aborted, true);
    assert.ok(Date.now() - started < 1000);
  });

  it("maps locked and unknown native failures without leaking their messages", async () => {
    await assert.rejects(
      runKeychainOperation(() => Promise.reject(new Error("permission denied: secret-value")), 100),
      CredentialStoreLockedError,
    );
    try {
      await runKeychainOperation(() => Promise.reject(new Error("native crash: secret-value")), 100);
      assert.fail("expected unavailable error");
    } catch (error) {
      assert.ok(error instanceof CredentialStoreUnavailableError);
      assert.equal(error.message.includes("secret-value"), false);
    }
  });

  it("rejects invalid timeout and payload limits before native keychain access", async () => {
    const { createKeychainCredentialStore } = await import("../keychain-store.js");
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: HARD_KEYCHAIN_TIMEOUT_MS + 1 },
      { maxPayloadBytes: Infinity },
      { maxPayloadBytes: HARD_MAX_KEYCHAIN_PAYLOAD_BYTES + 1 },
    ]) assert.throws(() => createKeychainCredentialStore({ service: "test", ...options }));
  });

  it("round-trips when PRISM_TEST_KEYCHAIN=1", async () => {
    if (process.env.PRISM_TEST_KEYCHAIN !== "1") return;
    const { createKeychainCredentialStore } = await import("../keychain-store.js");
    const service = `prism-test-${Date.now()}`;
    const store = createKeychainCredentialStore({ service, namespace: "task4", timeoutMs: 5000 });
    await store.set({ name: "apiKey", provider: "demo", credential: { type: "api_key", value: "keychain-secret" } });
    assert.equal((await store.get({ name: "apiKey", provider: "demo" }))?.value, "keychain-secret");
    await store.setOAuth("demo", { access: "oauth-access" }, "acct");
    assert.equal((await store.getOAuth("demo", "acct"))?.access, "oauth-access");
    assert.equal(await store.delete({ name: "apiKey", provider: "demo" }), true);
    assert.equal(await store.deleteOAuth("demo", "acct"), true);
  });
});
