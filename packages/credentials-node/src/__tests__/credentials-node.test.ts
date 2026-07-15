import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { refreshOAuthCredential } from "@arnilo/prism";
import {
  CredentialDecryptError,
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
  it("round-trips plaintext with authenticated encryption", () => {
    const plaintext = Buffer.from(JSON.stringify({ secret: "value" }), "utf8");
    const envelope = encryptBytes(plaintext, "correct-passphrase");
    const decrypted = decryptBytes(envelope, "correct-passphrase");
    assert.equal(decrypted.toString("utf8"), plaintext.toString("utf8"));
  });

  it("fails closed on wrong passphrase", () => {
    const envelope = encryptBytes(Buffer.from("payload"), "correct-passphrase");
    assert.throws(() => decryptBytes(envelope, "wrong-passphrase"), CredentialDecryptError);
  });

  it("fails closed on tampered ciphertext", () => {
    const envelope = encryptBytes(Buffer.from("payload"), "pass");
    const tampered = {
      ...envelope,
      ciphertext: Buffer.from(envelope.ciphertext, "base64").subarray(0, -1).toString("base64"),
    };
    assert.throws(() => decryptBytes(tampered, "pass"), CredentialDecryptError);
  });

  it("rejects weak scrypt parameters", () => {
    assert.throws(() => resolveScryptParameters({ N: 1024 }), WeakKdfParametersError);
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
});

describe("keychain credential store", () => {
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
