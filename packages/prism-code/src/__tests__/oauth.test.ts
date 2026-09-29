import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { OAuthProvider } from "@arnilo/prism";
import { createFileCredentialStore } from "@arnilo/prism-core/credentials/node";
import {
  createOAuthTokenSource,
  describeProviderCredentialStatus,
  formatProviderCredentialStatus,
  getShippedProvider,
  hasUsableProvider,
  logoutProvider,
  MemoryStoredCredentialStore,
  PrismCodeCredentialManager,
  resolveProvider,
} from "../index.js";

function makeManager(): PrismCodeCredentialManager {
  return new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
}

function fakeOAuthProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    id: "xai",
    login: () => ({ access: "login-token" }),
    ...overrides,
  };
}

test("an expired stored token refreshes exactly once under concurrent requests and persists the new token", async () => {
  const manager = makeManager();
  await manager.setOAuth("xai", { access: "old-token", refresh: "refresh-1", expires: Date.now() - 1_000 });

  let refreshCalls = 0;
  const provider = fakeOAuthProvider({
    refresh: async () => {
      refreshCalls += 1;
      return { access: "new-token", refresh: "refresh-2", expires: Date.now() + 3_600_000 };
    },
  });

  const source = createOAuthTokenSource("xai", provider, manager);
  const tokens = await Promise.all([source(), source(), source()]);

  assert.deepEqual(tokens, ["new-token", "new-token", "new-token"]);
  assert.equal(refreshCalls, 1);
  const stored = await manager.getOAuth("xai");
  assert.equal(stored?.access, "new-token");
  assert.equal(stored?.refresh, "refresh-2");
});

test("a valid token makes no refresh call", async () => {
  const manager = makeManager();
  await manager.setOAuth("xai", { access: "valid-token", refresh: "refresh-1", expires: Date.now() + 3_600_000 });

  let refreshCalls = 0;
  const source = createOAuthTokenSource(
    "xai",
    fakeOAuthProvider({
      refresh: async () => {
        refreshCalls += 1;
        return { access: "unused" };
      },
    }),
    manager,
  );

  assert.equal(await source(), "valid-token");
  assert.equal(refreshCalls, 0);
});

test("a failed refresh with an expired token rejects with a redacted, actionable note and keeps stored credentials", async () => {
  const manager = makeManager();
  await manager.setOAuth("xai", { access: "old-token", refresh: "refresh-1", expires: Date.now() - 1_000 });

  const source = createOAuthTokenSource(
    "xai",
    fakeOAuthProvider({
      refresh: async () => {
        throw new Error("upstream rejected old-token and refresh-1");
      },
    }),
    manager,
  );

  await assert.rejects(source, (error: Error) => {
    assert.ok(error.message.includes("Run /provider to log in again"), error.message);
    assert.ok(!error.message.includes("old-token"), "access token leaked into the error");
    assert.ok(!error.message.includes("refresh-1"), "refresh token leaked into the error");
    return true;
  });

  const stored = await manager.getOAuth("xai");
  assert.equal(stored?.access, "old-token");
  assert.equal(stored?.refresh, "refresh-1");
});

test("a failed proactive refresh keeps serving a token that is still valid", async () => {
  const manager = makeManager();
  // Within the 60 s skew but not yet expired.
  await manager.setOAuth("xai", { access: "short-lived-token", refresh: "refresh-1", expires: Date.now() + 30_000 });

  const source = createOAuthTokenSource(
    "xai",
    fakeOAuthProvider({
      refresh: async () => {
        throw new Error("transient network failure");
      },
    }),
    manager,
  );

  assert.equal(await source(), "short-lived-token");
});

test("logout revokes when supported, deletes stored OAuth and API key, and never touches env", async () => {
  const manager = makeManager();
  await manager.setOAuth("xai", { access: "logout-token", refresh: "refresh-1", expires: Date.now() + 60_000 });
  await manager.setApiKey("xai", "xai-key");

  let revocations = 0;
  const result = await logoutProvider(
    "xai",
    manager,
    fakeOAuthProvider({
      revoke: async () => {
        revocations += 1;
      },
    }),
  );

  assert.equal(result.oauthRevoked, true);
  assert.equal(result.oauthDeleted, true);
  assert.equal(result.apiKeyDeleted, true);
  assert.equal(revocations, 1);
  assert.equal(await manager.getOAuth("xai"), undefined);
  assert.equal(await manager.getStore().get({ name: "apiKey", provider: "xai" }), undefined);
});

test("logout deletes locally even when upstream revocation fails, with a redacted note", async () => {
  const manager = makeManager();
  await manager.setOAuth("xai", { access: "logout-token", refresh: "refresh-1", expires: Date.now() + 60_000 });

  const result = await logoutProvider(
    "xai",
    manager,
    fakeOAuthProvider({
      revoke: async () => {
        throw new Error("revoke endpoint rejected logout-token");
      },
    }),
  );

  assert.equal(result.oauthRevoked, false);
  assert.equal(result.oauthDeleted, true);
  assert.ok(result.revokeError, "expected a revocation failure note");
  assert.ok(!result.revokeError?.includes("logout-token"), "token leaked into the logout note");
  assert.equal(await manager.getOAuth("xai"), undefined);
});

test("/provider status reports store kind and expiry without leaking values, and reports 'not configured' after logout", async () => {
  const manager = makeManager();
  const xai = getShippedProvider("xai");
  const anthropic = getShippedProvider("anthropic");
  const codex = getShippedProvider("openai-codex");
  assert.ok(xai && anthropic && codex);

  await manager.setApiKey("xai", "sk-secret-value-xyz");
  const storedKey = formatProviderCredentialStatus(await describeProviderCredentialStatus(xai, manager, {}));
  assert.equal(storedKey, "stored key");
  assert.ok(!storedKey.includes("sk-secret-value-xyz"));

  await manager.setOAuth("openai-codex", { access: "tok-secret", expires: "2030-01-01T00:00:00.000Z" });
  const oauth = formatProviderCredentialStatus(await describeProviderCredentialStatus(codex, manager, {}));
  assert.equal(oauth, "oauth (expires 2030-01-01T00:00:00.000Z)");
  assert.ok(!oauth.includes("tok-secret"));

  const env = formatProviderCredentialStatus(await describeProviderCredentialStatus(anthropic, manager, { ANTHROPIC_API_KEY: "k" }));
  assert.equal(env, "env ANTHROPIC_API_KEY");

  await logoutProvider("openai-codex", manager);
  const afterLogout = formatProviderCredentialStatus(await describeProviderCredentialStatus(codex, manager, {}));
  assert.equal(afterLogout, "not configured");
});

test("resolveProvider builds a refreshing token source from stored OAuth instead of a frozen string", async () => {
  const manager = makeManager();
  await manager.setOAuth("openai-codex", { access: "seeded-token", refresh: "refresh-1", expires: Date.now() - 1_000 });

  const provider = await resolveProvider({ provider: "openai-codex", model: "gpt-5.1-codex" }, { credentialManager: manager });
  assert.equal(provider.id, "openai-codex");
});

test("stored OAuth alone makes an OAuth provider usable", async () => {
  const manager = makeManager();
  await manager.setOAuth("openai-codex", { access: "tok", refresh: "r", expires: Date.now() + 3_600_000 });

  const saved = { access: process.env.OPENAI_ACCESS_TOKEN, key: process.env.OPENAI_API_KEY };
  try {
    delete process.env.OPENAI_ACCESS_TOKEN;
    delete process.env.OPENAI_API_KEY;
    assert.equal(
      await hasUsableProvider({ model: { provider: "openai-codex", model: "gpt-5.1-codex" } }, { credentialManager: manager }),
      true,
    );
  } finally {
    if (saved.access === undefined) delete process.env.OPENAI_ACCESS_TOKEN;
    else process.env.OPENAI_ACCESS_TOKEN = saved.access;
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
  }
});

test("stored OAuth is refreshed end-to-end and the bearer token is persisted (subprocess)", async () => {
  const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
    ? resolve(__dirname, "../../../bin/prism-code.ts")
    : resolve(__dirname, "../../bin/prism-code.ts");
  const root = await mkdtemp(join(tmpdir(), "prism-code-oauth-"));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  await mkdir(home, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({ credentials: { store: "file" } }));

  const store = createFileCredentialStore({ path: join(home, "auth.json") });
  store.setOAuth("xai", { access: "stale-token", refresh: "refresh-1", expires: Date.now() - 1_000 });

  const captured = join(root, "captured.json");
  const preload = join(root, "preload.ts");
  const chatSse = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "oauth reply" } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  await writeFile(
    preload,
    [
      `import { appendFileSync } from "node:fs";`,
      `const captured = ${JSON.stringify(captured)};`,
      `const chatSse = ${JSON.stringify(chatSse)};`,
      `globalThis["fetch"] = (async (input, init) => {`,
      `  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;`,
      `  const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries());`,
      `  appendFileSync(captured, JSON.stringify({ url, authorization: headers.authorization ?? null }) + "\\n");`,
      `  if (url.includes("/oauth2/token") || url.includes("/oauth/token")) {`,
      `    return new Response(JSON.stringify({ access_token: "fresh-token", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });`,
      `  }`,
      `  return new Response(chatSse, { status: 200, headers: { "content-type": "text/event-stream" } });`,
      `});`,
    ].join("\n"),
  );

  try {
    const result = spawnSync(
      process.execPath,
      ["--preload", preload, binPath, "-p", "hi", "--mode", "print", "--provider", "xai", "--model", "grok-4.6"],
      {
        encoding: "utf8",
        cwd,
        env: { ...process.env, PRISM_HOME: home, XAI_API_KEY: "" },
      },
    );
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes("oauth reply"), `stdout: ${result.stdout}`);

    const calls = readFileSync(captured, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { url: string; authorization: string | null });
    const tokenCall = calls.find((call) => call.url.includes("/oauth2/token"));
    const chatCall = calls.find((call) => !call.url.includes("/oauth2/token"));
    assert.ok(tokenCall, `expected a refresh call, saw: ${calls.map((c) => c.url).join(", ")}`);
    assert.ok(chatCall, "expected a provider request");
    assert.equal(chatCall.authorization, "Bearer fresh-token");

    const reloaded = createFileCredentialStore({ path: join(home, "auth.json") });
    assert.equal(reloaded.getOAuth("xai")?.access, "fresh-token");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
