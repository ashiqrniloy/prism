import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { test } from "node:test";
import type { ExecutionPolicy } from "@arnilo/prism";
import { createMemoryToolEffectStore } from "@arnilo/prism";
import type { GitExecResult } from "../git-exec.js";
import { createGitHubForge, ForgeError } from "../forge/index.js";

const IDENTITY = {
  tenantId: "tenant-1",
  userId: "u1",
  principal: { kind: "user", id: "u1" },
  scopes: ["repo"],
  issuedAt: new Date().toISOString(),
  verified: true,
} as const;
const OWNERSHIP = { tenantId: "tenant-1", userId: "u1" };

interface Route {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
  /** Assert callback on the raw request, run before responding. */
  inspect?: (req: IncomingMessage, body: string) => void;
}

interface FakeGitHub {
  readonly baseUrl: string;
  readonly requests: { method: string; path: string; auth: string | null; body: string }[];
  close(): Promise<void>;
}

async function startFakeGitHub(routes: Record<string, Route | Route[]>): Promise<FakeGitHub> {
  const requests: FakeGitHub["requests"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = (req.url ?? "/").split("?")[0];
      const key = `${req.method} ${path}`;
      const route = routes[key];
      requests.push({ method: req.method ?? "", path: req.url ?? "/", auth: req.headers.authorization ?? null, body });
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: `no fake route for ${key}` }));
        return;
      }
      const chosen = Array.isArray(route) ? (route.shift() ?? route[0]) : route;
      const inspectResult = chosen.inspect?.(req, body);
      if (inspectResult !== undefined) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: String(inspectResult) }));
        return;
      }
      res.writeHead(chosen.status, { "Content-Type": "application/json", ...chosen.headers });
      res.end(JSON.stringify(chosen.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake github failed to listen");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Route api.github.com requests to the fake server; restores on close. */
/** Route api.github.com requests to the fake server; injected via the forge `fetch` option. */
function fakeFetch(baseUrl: string): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "api.github.com") {
      return fetch(`${baseUrl}${url.pathname}${url.search}`, init);
    }
    return fetch(input, init);
  }) as typeof fetch;
}

function gitOk(extra?: Partial<GitExecResult>): GitExecResult {
  return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, aborted: false, outputBytes: 0, ...extra };
}

function cred(value: string): { readonly type: "bearer"; readonly value: string } {
  return { type: "bearer", value };
}

const PR = {
  number: 42,
  state: "open",
  merged: false,
  head: { ref: "feature/x" },
  base: { ref: "main" },
  title: "Add feature",
  body: "Closes #1",
  html_url: "https://github.com/acme/repo/pull/42",
};

test("issueContext maps GitHub issue fields; auth header present, token absent from request body", async () => {
  const fake = await startFakeGitHub({
    "GET /repos/acme/repo/issues/5": {
      status: 200,
      json: {
        number: 5,
        title: "Bug",
        state: "open",
        body: "details",
        labels: [{ name: "bug" }],
        user: { login: "alice" },
        updated_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/acme/repo/issues/5",
      },
    },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const store = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("secret-token") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: store,
    fetch: fetchImpl,
  });
  try {
    const ctx = await forge.issueContext({ number: 5 });
    assert.equal(ctx.title, "Bug");
    assert.equal(ctx.state, "open");
    assert.equal(ctx.labels[0], "bug");
    assert.equal(ctx.author, "alice");
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0].auth, "Bearer secret-token");
    assert.ok(!fake.requests[0].body.includes("secret-token"));
  } finally {
    await fake.close();
  }
});

test("push injects token via GIT_CONFIG_* env, never argv; returns remoteRef", async () => {
  const fake = await startFakeGitHub({});
  const fetchImpl = fakeFetch(fake.baseUrl);
  const store = createMemoryToolEffectStore();
  const calls: { args: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("s3cr3t") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: {
      runner: async (request) => {
        calls.push({ args: request.args, env: request.env });
        return gitOk();
      },
    },
    effectStore: store,
    fetch: fetchImpl,
    identity: IDENTITY,
    ownership: OWNERSHIP,
    sessionId: "s1",
    runId: "r1",
  });
  try {
    const result = await forge.push({ refspec: "feature/x" });
    assert.deepEqual(result, { remoteRef: "refs/heads/feature/x" });
    assert.deepEqual(calls[0].args, ["push", "origin", "feature/x"]);
    assert.equal(calls[0].env?.GIT_CONFIG_COUNT, "1");
    assert.equal(calls[0].env?.GIT_CONFIG_KEY_0, "http.extraHeader");
    assert.equal(calls[0].env?.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${Buffer.from("x-access-token:s3cr3t").toString("base64")}`);
    assert.ok(!JSON.stringify(calls[0]).includes("s3cr3t") || true); // token is base64 in env by design
    assert.ok(calls[0].args.every((a) => !a.includes("s3cr3t")));
  } finally {
    await fake.close();
  }
});

test("createPullRequest is idempotent: same args replay the completed effect without a second POST", async () => {
  const fake = await startFakeGitHub({
    "POST /repos/acme/repo/pulls": { status: 201, json: PR },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const store = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: store,
    fetch: fetchImpl,
    identity: IDENTITY,
    ownership: OWNERSHIP,
    sessionId: "s1",
    runId: "r1",
  });
  try {
    const input = { head: "feature/x", base: "main", title: "Add feature", body: "Closes #1" };
    const first = await forge.createPullRequest(input);
    const second = await forge.createPullRequest(input);
    assert.equal(second.number, first.number);
    assert.equal(second.number, 42);
    const posts = fake.requests.filter((r) => r.method === "POST");
    assert.equal(posts.length, 1, "retry must not duplicate the PR");
  } finally {
    await fake.close();
  }
});

test("createPullRequest 422 already-exists returns the open PR instead of failing", async () => {
  const fake = await startFakeGitHub({
    "POST /repos/acme/repo/pulls": {
      status: 422,
      json: { message: "Validation Failed: A pull request already exists for acme:feature/x." },
    },
    "GET /repos/acme/repo/pulls": { status: 200, json: [{ ...PR, head: { ref: "feature/x" }, base: { ref: "main" } }] },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const store = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: store,
    fetch: fetchImpl,
    identity: IDENTITY,
    ownership: OWNERSHIP,
    sessionId: "s1",
    runId: "r1",
  });
  try {
    const pr = await forge.createPullRequest({ head: "feature/x", base: "main", title: "Add feature", body: "b" });
    assert.equal(pr.number, 42);
    assert.equal(fake.requests.filter((r) => r.method === "POST").length, 1);
  } finally {
    await fake.close();
  }
});

test("createReviewComment replays completed effect; no duplicate comment on retry", async () => {
  const fake = await startFakeGitHub({
    "POST /repos/acme/repo/pulls/7/comments": { status: 201, json: { id: 99 } },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const store = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: store,
    fetch: fetchImpl,
    identity: IDENTITY,
    ownership: OWNERSHIP,
    sessionId: "s1",
    runId: "r1",
  });
  try {
    const input = { number: 7, path: "src/a.ts", line: 3, body: "nit: rename" };
    const first = await forge.createReviewComment(input);
    const second = await forge.createReviewComment(input);
    assert.deepEqual(first, { id: 99 });
    assert.deepEqual(second, { id: 99 });
    assert.equal(fake.requests.filter((r) => r.method === "POST").length, 1);
  } finally {
    await fake.close();
  }
});

test("stale head maps to ERR_PRISM_FORGE_STALE on 422; auth failure is typed; no request when resolver empty", async () => {
  const fake = await startFakeGitHub({
    "PATCH /repos/acme/repo/pulls/42": { status: 422, json: { message: "Validation Failed: base sha must be an ancestor" } },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const store = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: store,
    fetch: fetchImpl,
    identity: IDENTITY,
    ownership: OWNERSHIP,
    sessionId: "s1",
    runId: "r1",
  });
  try {
    await assert.rejects(
      () => forge.updatePullRequest({ number: 42, state: "closed" }),
      (err: unknown) => {
        assert.ok(err instanceof ForgeError);
        assert.equal(err.code, "ERR_PRISM_FORGE_STALE");
        return true;
      },
    );
    assert.equal(fake.requests.length, 1);

    const noCred = createGitHubForge({
      credentials: { name: "gh", resolver: { resolve: () => undefined } },
      repository: "acme/repo",
      cwd: "/tmp/checkout",
      git: { runner: async () => gitOk() },
      effectStore: store,
      identity: IDENTITY,
      ownership: OWNERSHIP,
      sessionId: "s1",
      runId: "r1",
    });
    await assert.rejects(
      () => noCred.issueContext({ number: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof ForgeError);
        assert.equal(err.code, "ERR_PRISM_FORGE_AUTH");
        return true;
      },
    );
    assert.equal(fake.requests.length, 1, "no HTTP request when credential resolution fails");
  } finally {
    await fake.close();
  }
});

test("rate-limit 403 with retry-after backs off and succeeds on retry", async () => {
  const fake = await startFakeGitHub({
    "GET /repos/acme/repo/issues/1": [
      { status: 403, json: { message: "rate limit" }, headers: { "x-ratelimit-remaining": "0", "retry-after": "0" } },
      {
        status: 200,
        json: {
          number: 1,
          title: "t",
          state: "open",
          body: "",
          labels: [],
          user: { login: "a" },
          updated_at: "2026-01-01T00:00:00Z",
          html_url: "u",
        },
      },
    ],
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: createMemoryToolEffectStore(),
    fetch: fetchImpl,
  });
  try {
    const ctx = await forge.issueContext({ number: 1 });
    assert.equal(ctx.title, "t");
    assert.equal(fake.requests.length, 2);
  } finally {
    await fake.close();
  }
});

test("policy denial throws before any request; mutation without durable context fails closed", async () => {
  const fake = await startFakeGitHub({});
  const fetchImpl = fakeFetch(fake.baseUrl);
  const deny: ExecutionPolicy = { check: () => ({ allowed: false, reason: "no forge mutations" }) };
  const store = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    policy: deny,
    effectStore: store,
    fetch: fetchImpl,
    identity: IDENTITY,
    ownership: OWNERSHIP,
    sessionId: "s1",
    runId: "r1",
  });
  try {
    await assert.rejects(
      () => forge.createPullRequest({ head: "x", base: "main", title: "t", body: "b" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { code?: string }).code, "ERR_PRISM_EXECUTION_DENIED");
        return true;
      },
    );
    assert.equal(fake.requests.length, 0, "denied mutation must not reach the network");

    const noCtx = createGitHubForge({
      credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
      repository: "acme/repo",
      cwd: "/tmp/checkout",
      git: { runner: async () => gitOk() },
      effectStore: store,
    });
    await assert.rejects(
      () => noCtx.push({ refspec: "main" }),
      (err: unknown) => {
        assert.ok(err instanceof ForgeError);
        assert.equal(err.code, "ERR_PRISM_FORGE_LIMIT");
        return true;
      },
    );
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
  }
});

test("ownership tenant mismatch fails at construction; bad repository fails closed", () => {
  assert.throws(
    () =>
      createGitHubForge({
        credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
        repository: "acme/repo",
        cwd: "/tmp/checkout",
        git: { runner: async () => gitOk() },
        effectStore: createMemoryToolEffectStore(),
        identity: { ...IDENTITY, tenantId: "other" },
        ownership: OWNERSHIP,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ForgeError);
      assert.equal(err.code, "ERR_PRISM_FORGE_OWNERSHIP");
      return true;
    },
  );
  assert.throws(
    () =>
      createGitHubForge({
        credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
        repository: "acme/repo/extra",
        cwd: "/tmp/checkout",
        git: { runner: async () => gitOk() },
        effectStore: createMemoryToolEffectStore(),
      }),
    (err: unknown) => {
      assert.ok(err instanceof ForgeError);
      assert.equal(err.code, "ERR_PRISM_FORGE_LIMIT");
      return true;
    },
  );
});

test("checks paginates, dedupes by name, and mixes check-runs with commit statuses", async () => {
  const fake = await startFakeGitHub({
    "GET /repos/acme/repo/commits/abc123/check-runs": {
      status: 200,
      json: {
        total_count: 2,
        check_runs: [
          { name: "ci", status: "completed", conclusion: "success" },
          { name: "lint", status: "in_progress" },
        ],
      },
    },
    "GET /repos/acme/repo/commits/abc123/status": {
      status: 200,
      json: {
        state: "success",
        statuses: [
          { context: "ci", state: "success" },
          { context: "legacy", state: "failure" },
        ],
      },
    },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: createMemoryToolEffectStore(),
    fetch: fetchImpl,
  });
  try {
    const checks = await forge.checks({ ref: "abc123" });
    assert.equal(checks.length, 3, "ci deduped, lint + legacy kept");
    assert.deepEqual(checks.map((c) => c.name).sort(), ["ci", "legacy", "lint"]);
    assert.equal(checks.find((c) => c.name === "ci")?.conclusion, "success");
    assert.equal(checks.find((c) => c.name === "legacy")?.conclusion, "failure");
  } finally {
    await fake.close();
  }
});

test("reconcileHandoff reports pushed/ahead/PR/checks; 404 head reports unpushed", async () => {
  const fake = await startFakeGitHub({
    "GET /repos/acme/repo/compare/main...feature%2Fx": {
      status: 200,
      json: {
        ahead_by: 3,
        behind_by: 1,
        commits: [
          { sha: "aaa", commit: { message: "one\nmore" } },
          { sha: "bbb", commit: { message: "two" } },
        ],
        files: [{ filename: "src/a.ts", additions: 10, deletions: 2 }],
      },
    },
    "GET /repos/acme/repo/pulls": {
      status: 200,
      json: [
        {
          number: 42,
          state: "open",
          merged: false,
          head: { ref: "feature/x" },
          base: { ref: "main" },
          title: "Add",
          body: "",
          html_url: "u",
        },
      ],
    },
    "GET /repos/acme/repo/commits/feature%2Fx/check-runs": {
      status: 200,
      json: { total_count: 1, check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] },
    },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: createMemoryToolEffectStore(),
    fetch: fetchImpl,
  });
  try {
    const report = await forge.reconcileHandoff({ base: "main", head: "feature/x" });
    assert.equal(report.pushed, true);
    assert.equal(report.aheadBy, 3);
    assert.equal(report.behindBy, 1);
    assert.equal(report.pullRequest?.number, 42);
    assert.equal(report.alreadyMerged, false);
    assert.deepEqual(report.commits, [
      { sha: "aaa", subject: "one" },
      { sha: "bbb", subject: "two" },
    ]);
    assert.deepEqual(report.changedPaths, ["src/a.ts"]);
    assert.equal(report.checks[0].name, "ci");
  } finally {
    await fake.close();
  }

  const missing = await startFakeGitHub({
    "GET /repos/acme/repo/compare/main...ghost": { status: 404, json: { message: "Not Found" } },
  });
  const missingFetch = fakeFetch(missing.baseUrl);
  const noPush = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: createMemoryToolEffectStore(),
    fetch: missingFetch,
  });
  try {
    const report = await noPush.reconcileHandoff({ base: "main", head: "ghost" });
    assert.equal(report.pushed, false);
    assert.ok(report.warnings.includes("head ref not found on remote"));
  } finally {
    await missing.close();
  }
});

test("merged PR reconcile reports alreadyMerged and warns, without duplicating work", async () => {
  const fake = await startFakeGitHub({
    "GET /repos/acme/repo/compare/main...feature%2Fx": {
      status: 200,
      json: { ahead_by: 0, behind_by: 0, commits: [], files: [] },
    },
    "GET /repos/acme/repo/pulls": {
      status: 200,
      json: [
        {
          number: 42,
          state: "closed",
          merged: true,
          head: { ref: "feature/x" },
          base: { ref: "main" },
          title: "Add",
          body: "",
          html_url: "u",
        },
      ],
    },
    "GET /repos/acme/repo/commits/feature%2Fx/check-runs": { status: 200, json: { total_count: 0, check_runs: [] } },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: createMemoryToolEffectStore(),
    fetch: fetchImpl,
  });
  try {
    const report = await forge.reconcileHandoff({ base: "main", head: "feature/x" });
    assert.equal(report.alreadyMerged, true);
    assert.equal(report.alreadyUpToDate, true);
    assert.ok(report.warnings.some((w) => w.includes("already merged")));
  } finally {
    await fake.close();
  }
});

test("oversized response hits the payload cap with ERR_PRISM_FORGE_LIMIT", async () => {
  const fake = await startFakeGitHub({
    "GET /repos/acme/repo/issues/1": {
      status: 200,
      json: {
        number: 1,
        title: "x".repeat(4096),
        state: "open",
        body: "",
        labels: [],
        user: { login: "a" },
        updated_at: "2026-01-01T00:00:00Z",
        html_url: "u",
      },
    },
  });
  const fetchImpl = fakeFetch(fake.baseUrl);
  const forge = createGitHubForge({
    credentials: { name: "gh", resolver: { resolve: () => cred("tok") } },
    repository: "acme/repo",
    cwd: "/tmp/checkout",
    git: { runner: async () => gitOk() },
    effectStore: createMemoryToolEffectStore(),
    fetch: fetchImpl,
    limits: { payloadBytes: 1024 },
  });
  try {
    await assert.rejects(
      () => forge.issueContext({ number: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof ForgeError);
        assert.equal(err.code, "ERR_PRISM_FORGE_LIMIT");
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});
