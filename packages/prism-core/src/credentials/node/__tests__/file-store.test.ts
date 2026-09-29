import { afterEach, describe, it, mock } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCredentialStore } from "../file-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-file-store-"));
  tempDirs.push(dir);
  return join(dir, "auth.json");
}

describe("file credential store", () => {
  it("round-trips API keys and OAuth entries through a 0600 file with a 0700 parent", () => {
    const path = tempStorePath();
    const store = createFileCredentialStore({ path });
    assert.deepEqual(store.list(), []);

    store.set({ name: "apiKey", provider: "anthropic", credential: { type: "api_key", value: "sk-ant-test" } });
    store.setOAuth("openai-codex", { access: "access-token", refresh: "refresh-token" }, "acct_1");

    assert.equal(store.get({ name: "apiKey", provider: "anthropic" })?.value, "sk-ant-test");
    assert.equal(store.getOAuth("openai-codex", "acct_1")?.access, "access-token");
    assert.equal(store.list().length, 1);
    assert.equal(store.listOAuth().length, 1);

    // A second store instance reads the persisted file.
    const reopened = createFileCredentialStore({ path });
    assert.equal(reopened.get({ name: "apiKey", provider: "anthropic" })?.value, "sk-ant-test");
    assert.equal(reopened.getOAuth("openai-codex", "acct_1")?.refresh, "refresh-token");

    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700);
    }

    assert.equal(store.delete({ name: "apiKey", provider: "anthropic" }), true);
    assert.equal(store.delete({ name: "apiKey", provider: "anthropic" }), false);
    assert.equal(store.deleteOAuth("openai-codex", "acct_1"), true);
    assert.equal(store.list().length, 0);
    assert.equal(store.listOAuth().length, 0);
  });

  it("refuses a group-readable file on read and names the fix", () => {
    if (process.platform === "win32") return;
    const path = tempStorePath();
    createFileCredentialStore({ path }).set({ name: "apiKey", credential: { type: "api_key", value: "secret" } });
    chmodSync(path, 0o644);
    assert.throws(
      () => createFileCredentialStore({ path }),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /permissions are too permissive/);
        assert.match(error.message, /chmod 600/);
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
  });

  it("rejects invalid limits and file modes before touching disk", () => {
    assert.throws(() => createFileCredentialStore({ path: tempStorePath(), fileMode: 0o644 }), /too permissive/);
    assert.throws(() => createFileCredentialStore({ path: tempStorePath(), limits: { maxVaultBytes: 0 } }), RangeError);
  });

  it("probeKeychainAvailability reports unavailable from a failing backend without writing or leaking details", async () => {
    let writes = 0;
    mock.module("@napi-rs/keyring", () => ({
      AsyncEntry: class {
        async getSecret(): Promise<Uint8Array | undefined> {
          throw new Error("secret-value");
        }
        async setSecret(): Promise<void> {
          writes += 1;
        }
        async deleteCredential(): Promise<void> {
          writes += 1;
        }
      },
    }));
    const { probeKeychainAvailability } = await import("../keychain-store.js");
    const result = await probeKeychainAvailability({ service: "prism-code" });
    assert.equal(result.status, "unavailable");
    assert.equal(result.status === "unavailable" && result.message.includes("secret-value"), false);
    assert.equal(writes, 0);
  });

  it("constructs a store whose parent directory is created owner-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-file-store-nested-"));
    tempDirs.push(dir);
    const path = join(dir, "nested", "auth.json");
    const store = createFileCredentialStore({ path });
    store.set({ name: "apiKey", credential: { type: "api_key", value: "v" } });
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "nested")).mode & 0o777, 0o700);
    assert.equal(store.get({ name: "apiKey" })?.value, "v");
  });
});
