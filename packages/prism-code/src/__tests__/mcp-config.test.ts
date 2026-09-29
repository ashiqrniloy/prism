// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${env:NAME}`/`${credential:NAME}` header syntax is the feature under test.
import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpClientAuth } from "@arnilo/prism-mcp";
import { parsePrismCodeConfigLayer } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import {
  createMcpAuthOptions,
  createMcpAuthState,
  isMcpServerTrusted,
  mcpServerFingerprint,
  mcpServerOrigins,
  readMcpTrust,
  resolveMcpHeaderValue,
  resolveMcpServers,
  validateGlobalPrismCodeConfigLayer,
  writeMcpTrustDecision,
} from "../index.js";
import { parseMcpHeaderReference } from "../mcp.js";

function tempHome(): { readonly home: string; readonly cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "prism-code-mcp-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function manager(): PrismCodeCredentialManager {
  return new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

test("url servers default allow to the URL origin and keep explicit fields", () => {
  const layer = parsePrismCodeConfigLayer(
    JSON.stringify({
      mcp: {
        servers: [
          {
            serverId: "github",
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: "Bearer ${env:GITHUB_TOKEN}", "X-Client": "prism" },
            connectTimeoutMs: 5000,
          },
        ],
      },
    }),
    "/repo",
  );
  const server = layer.mcp?.servers?.[0];
  assert.equal(server?.allow, "https://api.githubcopilot.com");
  assert.equal(server?.connectTimeoutMs, 5000);
  assert.deepEqual(server?.headers, { Authorization: "Bearer ${env:GITHUB_TOKEN}", "X-Client": "prism" });
});

test("stdio servers default allow to stdio; command plus url and unknown server keys fail", () => {
  const layer = parsePrismCodeConfigLayer(JSON.stringify({ mcp: { servers: [{ serverId: "fs", command: "npx" }] } }));
  assert.equal(layer.mcp?.servers?.[0]?.allow, "stdio");

  assert.throws(() => parsePrismCodeConfigLayer(JSON.stringify({ mcp: { servers: [{ serverId: "x", command: "npx", rogue: true }] } })));
  assert.throws(() =>
    parsePrismCodeConfigLayer(JSON.stringify({ mcp: { servers: [{ serverId: "x", command: "npx", url: "https://example.com/mcp" }] } })),
  );
  assert.throws(() =>
    parsePrismCodeConfigLayer(JSON.stringify({ mcp: { servers: [{ serverId: "x", url: "https://example.com/mcp", transport: "acp" }] } })),
  );
  assert.throws(() =>
    parsePrismCodeConfigLayer(
      JSON.stringify({ mcp: { servers: [{ serverId: "x", url: "https://example.com/mcp", connectTimeoutMs: 0 }] } }),
    ),
  );
  assert.throws(() =>
    parsePrismCodeConfigLayer(JSON.stringify({ mcp: { servers: [{ serverId: "x", url: "https://example.com/mcp", auth: "basic" }] } })),
  );
});

test("project configs reject literal secret headers; global configs and references are accepted", () => {
  const literal = JSON.stringify({
    mcp: { servers: [{ serverId: "github", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-123" } }] },
  });
  assert.throws(
    () => parsePrismCodeConfigLayer(literal, "/repo"),
    (error: unknown) => {
      assert(error instanceof Error);
      assert(error.message.includes("literal secret headers"));
      return true;
    },
  );
  // The same literal is allowed in the global config (the user's own file).
  const globalLayer = validateGlobalPrismCodeConfigLayer(JSON.parse(literal), "/home/user/.prism", "config.json");
  assert.equal(globalLayer.mcp?.servers?.[0]?.headers?.Authorization, "Bearer sk-live-123");

  const reference = JSON.stringify({
    mcp: {
      servers: [{ serverId: "github", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${env:GITHUB_TOKEN}" } }],
    },
  });
  assert.ok(parsePrismCodeConfigLayer(reference, "/repo").mcp?.servers?.[0]?.headers?.Authorization);
  assert.throws(() =>
    parsePrismCodeConfigLayer(
      JSON.stringify({
        mcp: { servers: [{ serverId: "github", url: "https://api.example.com/mcp", headers: { Authorization: "${env:}" } }] },
      }),
      "/repo",
    ),
  );
});

test("mcpServerOrigins keeps the last layer that declares a serverId", () => {
  const global = parsePrismCodeConfigLayer(JSON.stringify({ mcp: { servers: [{ serverId: "a", command: "global-a" }] } }));
  const project = parsePrismCodeConfigLayer(
    JSON.stringify({
      mcp: {
        servers: [
          { serverId: "a", command: "project-a" },
          { serverId: "b", command: "b" },
        ],
      },
    }),
    "/repo",
  );
  const origins = mcpServerOrigins([
    { layer: global, origin: "global" },
    { layer: project, origin: "project" },
  ]);
  assert.equal(origins.get("a"), "project");
  assert.equal(origins.get("b"), "project");
});

// ---------------------------------------------------------------------------
// Header references
// ---------------------------------------------------------------------------

test("reference parsing and resolution cover literals, embedded env/credential refs, and malformed values", () => {
  assert.deepEqual(parseMcpHeaderReference("plain"), { kind: "literal" });
  assert.deepEqual(parseMcpHeaderReference("${env:TOKEN}"), { kind: "references" });
  assert.deepEqual(parseMcpHeaderReference("Bearer ${credential:openai}"), { kind: "references" });
  assert.deepEqual(parseMcpHeaderReference("${env:}"), { kind: "malformed" });

  assert.deepEqual(
    resolveMcpHeaderValue("plain", () => undefined),
    { value: "plain" },
  );
  assert.deepEqual(
    resolveMcpHeaderValue("Bearer ${env:TOKEN}", (kind, name) => (kind === "env" && name === "TOKEN" ? "secret" : undefined)),
    { value: "Bearer secret" },
  );
  assert.deepEqual(
    resolveMcpHeaderValue("Bearer ${env:TOKEN}", () => undefined),
    { error: "${env:TOKEN} did not resolve" },
  );
  assert.deepEqual(
    resolveMcpHeaderValue("${nope:TOKEN}", () => "x"),
    { error: "header value has a malformed reference" },
  );
});

// ---------------------------------------------------------------------------
// Trust gate and server resolution
// ---------------------------------------------------------------------------

test("global servers are trusted without a prompt; project servers are skipped in headless mode", async () => {
  const { home, cleanup } = tempHome();
  try {
    const servers = [
      { serverId: "global-fs", command: "global-fs" },
      { serverId: "repo-fs", command: "repo-fs" },
    ];
    const origins = new Map([
      ["global-fs", "global" as const],
      ["repo-fs", "project" as const],
    ]);
    const resolved = await resolveMcpServers({
      servers,
      origins,
      mode: "skip",
      home,
      workspaceRoot: "/repo",
      credentialManager: manager(),
    });
    assert.deepEqual(
      resolved.servers.map((s) => s.serverId),
      ["global-fs", "repo-fs"],
    );
    const firstServer = resolved.servers[0];
    assert.ok(firstServer);
    assert.equal("disabledReason" in firstServer ? firstServer.disabledReason : undefined, undefined);
    const repo = resolved.servers[1];
    assert.ok(repo && "disabledReason" in repo && repo.disabledReason?.includes("not trusted"));
    assert.ok(resolved.notes.some((note) => note.includes("repo-fs")));
    assert.equal(existsSync(join(home, "trust.json")), false);
  } finally {
    cleanup();
  }
});

test("prompt acceptance persists a fingerprinted trust decision in 0600 trust.json and stops re-prompting", async () => {
  const { home, cleanup } = tempHome();
  try {
    const servers = [
      { serverId: "repo-fs", command: "npx", args: ["-y", "server-fs"] },
      { serverId: "other-fs", command: "npx", args: ["-y", "server-other"] },
    ];
    const origins = new Map([
      ["repo-fs", "project" as const],
      ["other-fs", "project" as const],
    ]);
    const prompts: string[] = [];
    const first = await resolveMcpServers({
      servers,
      origins,
      mode: "prompt",
      home,
      workspaceRoot: "/repo",
      credentialManager: manager(),
      promptTrust: async (server) => {
        prompts.push(server.serverId);
        return server.serverId === "repo-fs";
      },
    });
    assert.deepEqual(prompts, ["repo-fs", "other-fs"]);
    const trusted = first.servers[0];
    assert.ok(trusted);
    assert.equal("disabledReason" in trusted, false);
    const untrusted = first.servers[1];
    assert.ok(untrusted && "disabledReason" in untrusted);
    assert.ok(untrusted.disabledReason?.includes("not trusted"));

    const trustPath = join(home, "trust.json");
    assert.equal(existsSync(trustPath), true);
    assert.equal(statSync(trustPath).mode & 0o777, 0o600);
    assert.equal(isMcpServerTrusted(readMcpTrust(home).trust, "/repo", servers[0] ?? { serverId: "repo-fs" }), true);

    // Second run: the fingerprint matches, so only the still-untrusted server prompts.
    const secondPrompts: string[] = [];
    const second = await resolveMcpServers({
      servers,
      origins,
      mode: "prompt",
      home,
      workspaceRoot: "/repo",
      credentialManager: manager(),
      promptTrust: async (server) => {
        secondPrompts.push(server.serverId);
        return true;
      },
    });
    assert.deepEqual(secondPrompts, ["other-fs"]);
    assert.equal(second.servers.length, 2);

    // A changed args list changes the fingerprint and re-prompts.
    const changed = [servers[0] && { ...servers[0], args: ["-y", "server-fs@2"] }, servers[1]];
    const thirdPrompts: string[] = [];
    await resolveMcpServers({
      servers: changed.filter((server): server is NonNullable<typeof server> => server !== undefined),
      origins,
      mode: "prompt",
      home,
      workspaceRoot: "/repo",
      credentialManager: manager(),
      promptTrust: async (server) => {
        thirdPrompts.push(server.serverId);
        return true;
      },
    });
    assert.ok(thirdPrompts.includes("repo-fs"));
  } finally {
    cleanup();
  }
});

test("mode allow trusts project servers for the run without writing trust.json", async () => {
  const { home, cleanup } = tempHome();
  try {
    const resolved = await resolveMcpServers({
      servers: [{ serverId: "repo-fs", command: "npx" }],
      origins: new Map([["repo-fs", "project" as const]]),
      mode: "allow",
      home,
      workspaceRoot: "/repo",
      credentialManager: manager(),
    });
    const unmanaged = resolved.servers[0];
    assert.ok(unmanaged);
    assert.equal("disabledReason" in unmanaged ? unmanaged.disabledReason : undefined, undefined);
    assert.equal(existsSync(join(home, "trust.json")), false);
  } finally {
    cleanup();
  }
});

test("enabled:false becomes a disabled stub and unresolved header references fail preflight", async () => {
  const { home, cleanup } = tempHome();
  try {
    const credentials = manager();
    const resolved = await resolveMcpServers({
      servers: [
        { serverId: "off", command: "npx", enabled: false },
        { serverId: "missing-env", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${env:PRISM_TEST_MISSING}" } },
      ],
      origins: new Map(),
      mode: "allow",
      home,
      workspaceRoot: "/repo",
      credentialManager: credentials,
    });
    const off = resolved.servers[0];
    assert.ok(off && "disabledReason" in off);
    assert.equal(off.disabledReason, "disabled in configuration");
    const missing = resolved.servers[1];
    assert.ok(missing && "preflightError" in missing);
    assert.ok(missing.preflightError?.includes("PRISM_TEST_MISSING"));
  } finally {
    cleanup();
  }
});

test("credential references resolve through the credential manager", async () => {
  const { home, cleanup } = tempHome();
  try {
    const credentials = manager();
    await credentials.setApiKey("github", "gh-token-1");
    const resolved = await resolveMcpServers({
      servers: [{ serverId: "github", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${credential:github}" } }],
      origins: new Map(),
      mode: "allow",
      home,
      workspaceRoot: "/repo",
      credentialManager: credentials,
    });
    const server = resolved.servers[0];
    assert.ok(server && "headers" in server);
    assert.equal(server.headers?.Authorization, "Bearer gh-token-1");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// OAuth persistence
// ---------------------------------------------------------------------------

test("oauth: auth state round-trips every chunk in the mcp:<id> credential slot", async () => {
  const credentials = manager();
  const state = createMcpAuthState(credentials, "linear");
  await state.saveTokens({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", issuer: "https://as.example" });
  await state.saveDiscovery({ authorizationServerUrl: "https://as.example" });
  await state.saveClientInformation({ client_id: "c-1", issuer: "https://as.example" });
  await state.saveCodeVerifier("verifier-1");
  await state.saveAuthorizationState?.({ state: "s-1", authorizationServerUrl: "https://as.example" });

  assert.equal((await state.loadTokens())?.access_token, "at-1");
  assert.equal((await state.loadTokens("https://other.example"))?.access_token, undefined);
  assert.equal((await state.loadTokens("https://as.example"))?.access_token, "at-1");
  assert.ok(await state.loadDiscovery());
  assert.equal((await state.loadClientInformation())?.client_id, "c-1");
  assert.equal(await state.loadCodeVerifier(), "verifier-1");
  assert.equal((await state.loadAuthorizationState?.())?.state, "s-1");

  const stored = await credentials.getOAuth("mcp:linear");
  assert.equal(stored?.access, "at-1");
  assert.equal(stored?.refresh, "rt-1");

  await state.clear("tokens");
  assert.equal(await state.loadTokens(), undefined);
  assert.ok(await state.loadClientInformation());

  await state.clear("all");
  assert.equal(await credentials.getOAuth("mcp:linear"), undefined);
});

test("oauth: login flow stores tokens under mcp:<id> and the next authorize uses them", async () => {
  const credentials = manager();
  const origin = "http://127.0.0.1:9";
  const server = { serverId: "linear", url: `${origin}/mcp` };
  let authorizationUrl: URL | undefined;
  const authOptions = createMcpAuthOptions(server, {
    credentials,
    redirectUri: `${origin}/oauth/callback`,
    onRedirectRequired: (url) => {
      authorizationUrl = url;
    },
  });
  const requests: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return json({ authorization_servers: [origin], resource: `${origin}/mcp` });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register") {
      // RFC 7591 §3.2.1: the response carries the registered metadata back.
      return json({ ...JSON.parse(String(init?.body ?? "{}")), client_id: "client-1" });
    }
    if (url.pathname === "/token") {
      return json({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  };

  const auth = createMcpClientAuth(authOptions, { serverUrl: `${origin}/mcp`, fetch: fakeFetch });
  assert.equal(await auth.ensureAuthorized(), "REDIRECT");
  assert.ok(authorizationUrl, "redirect URL captured");
  const persisted = await authOptions.state.loadAuthorizationState?.();
  assert.ok(persisted);
  await auth.finishAuth(new URLSearchParams({ state: persisted.state, code: "test-code", iss: origin }));

  const stored = await credentials.getOAuth("mcp:linear");
  assert.equal(stored?.access, "at-1");
  assert.equal(stored?.refresh, "rt-1");
  assert.equal(await auth.ensureAuthorized(), "AUTHORIZED");
});

test("fingerprint includes args and env keys but not env values", () => {
  const base = { serverId: "fs", command: "npx", args: ["-y", "fs"], env: { TOKEN: "a" } };
  assert.equal(mcpServerFingerprint(base), mcpServerFingerprint({ ...base, env: { TOKEN: "b" } }));
  assert.notEqual(mcpServerFingerprint(base), mcpServerFingerprint({ ...base, args: ["-y", "fs@2"] }));
  assert.notEqual(mcpServerFingerprint(base), mcpServerFingerprint({ ...base, env: { TOKEN: "a", OTHER: "x" } }));
});

test("writeMcpTrustDecision records the fingerprint in the workspace repo key", () => {
  const { home, cleanup } = tempHome();
  try {
    const server = { serverId: "fs", command: "npx", args: ["-y", "fs"] };
    const written = writeMcpTrustDecision(home, "/repo", server);
    assert.equal(written.notice, undefined);
    const trust = readMcpTrust(home).trust;
    assert.equal(isMcpServerTrusted(trust, "/repo", server), true);
    assert.equal(isMcpServerTrusted(trust, "/other", server), false);
    assert.equal(statSync(join(home, "trust.json")).mode & 0o777, 0o600);
  } finally {
    cleanup();
  }
});
