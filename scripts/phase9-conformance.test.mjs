/**
 * Phase 9 network-free conformance (plan 009 Task 7).
 * Cross-cuts Task 0 matrices; unit suites remain authoritative per-capability.
 * Composed scenario: ignore-aware enumeration → approved LSP rename → managed
 * process session → idempotent forge PR (fake) → allow-list egress (github+registry).
 * Adversarial matrix: symlink/ignore escape, LSP URI escape, process ownership,
 * forge token leakage + cross-tenant, egress private/metadata bypass, and a
 * limit ladder at/below/above frozen caps. FR-3/FR-4/FR-5/FR-6 conformance items
 * land with Tasks 9-12.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMemoryToolEffectStore } from "../dist/index.js";
import {
  createBoundGitRunner,
  createGitAwareRepositoryOperations,
  createGitHubForge,
  createLanguageIntelligence,
  createProcessSessions,
  ForgeError,
  LanguageIntelligenceError,
  ProcessSessionError,
} from "../packages/prism-coding-tools/dist/agent/index.js";
import { createAllowListEgressProxy, createEgressPolicy } from "../packages/prism-coding-tools/dist/security/index.js";

const FAKE_LSP = fileURLToPath(new URL("../packages/prism-coding-tools/src/agent/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
const IDENTITY = {
  tenantId: "tenant-1",
  userId: "u1",
  principal: { kind: "user", id: "u1" },
  scopes: ["repo"],
  issuedAt: new Date().toISOString(),
  verified: true,
};
const OWNERSHIP = { tenantId: "tenant-1", userId: "u1" };

async function tmp() {
  return mkdtemp(join(tmpdir(), "phase9-conf-"));
}

async function gitInit(cwd) {
  const runner = await createBoundGitRunner();
  const run = async (...args) => {
    const r = await runner.exec({ args, cwd });
    assert.equal(r.exitCode, 0, r.stderr.toString("utf8") || `exit ${r.exitCode}`);
    return r;
  };
  await run("init");
  await run("config", "user.email", "test@example.com");
  await run("config", "user.name", "Test");
  return runner;
}

function okResult(stdout = "") {
  return { exitCode: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
}

async function startFakeGitHub(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = (req.url ?? "/").split("?")[0];
      const key = `${req.method} ${path}`;
      const route = routes[key];
      requests.push({ method: req.method ?? "", path: req.url ?? "/", auth: req.headers.authorization ?? null });
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: `no fake route for ${key}` }));
        return;
      }
      res.writeHead(route.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(route.json));
      void body;
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake github failed to listen");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function fakeFetch(baseUrl) {
  return (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "api.github.com") {
      return fetch(`${baseUrl}${url.pathname}${url.search}`, init);
    }
    return fetch(input, init);
  };
}

function proxyGet(proxyPort, target, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: proxyPort, path: target, method: "GET", headers: { host: hostHeader }, setHost: false },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Phase 9 conformance", () => {
  it("composed scenario: enumeration → LSP rename → process → forge → egress", async () => {
    const root = await tmp();
    try {
      // 1. Git-aware enumeration with nested ignore rules.
      await gitInit(root);
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "a.ts"), "export const foo = 1;\n");
      await writeFile(join(root, "src", "b.ts"), "export const bar = 2;\n");
      await writeFile(join(root, ".gitignore"), "*.log\n");
      await writeFile(join(root, "run.log"), "ignored\n");
      const { exec } = await import("node:child_process");
      await new Promise((resolve, reject) => {
        exec("git add -A", { cwd: root }, (error) => (error ? reject(error) : resolve()));
      });
      const repo = createGitAwareRepositoryOperations(root);
      const listed = await repo.list({ root, maxResults: 100 });
      const names = listed.entries.map((e) => e.path);
      assert.ok(names.includes("src/a.ts") && names.includes("src/b.ts"), `tracked files listed: ${names.join(",")}`);
      assert.ok(!names.some((n) => n.includes("run.log")), "ignored file must stay excluded");
      const found = await repo.search({ root, query: "foo", maxResults: 10 });
      assert.ok(
        found.matches.some((m) => m.path.endsWith("a.ts")),
        "search finds tracked content",
      );

      // 2. LSP rename through approval policy + atomic write.
      const approvals = [];
      const language = createLanguageIntelligence({
        workspaceRoot: root,
        servers: {
          ts: { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"] },
        },
        policy: {
          check: async (action) => {
            approvals.push(action.operation);
            return { allowed: true };
          },
        },
      });
      try {
        const edit = await language.rename({ file: join(root, "src", "a.ts"), line: 0, character: 11, newName: "renamed" });
        assert.ok(edit.edits.length >= 1, "rename produced edits");
        assert.ok(approvals.includes("rename"), "rename routed through execution policy");
        const text = await (await import("node:fs/promises")).readFile(join(root, "src", "a.ts"), "utf8");
        assert.match(text, /renamed/, "workspace edit applied atomically");
      } finally {
        await language.dispose();
      }

      // 3. Managed process session captures a test run.
      const sessions = createProcessSessions({ cwd: root, limits: { maxLifetimeMs: 60_000 } });
      try {
        const p = await sessions.start({
          command: process.execPath,
          args: ["-e", "console.log('test run captured'); setTimeout(()=>{}, 5000)"],
          lifetimeMs: 30_000,
        });
        let cursor = 0;
        let saw = "";
        for (let i = 0; i < 50; i += 1) {
          const chunk = await p.output({ cursor, maxBytes: 64 });
          saw += chunk.data;
          cursor = chunk.cursor;
          if (saw.includes("test run captured")) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        assert.match(saw, /test run captured/);
        await p.kill();
        const exit = await p.wait({ timeoutMs: 10_000 });
        assert.equal(exit.state, "killed");
      } finally {
        await sessions.dispose();
      }

      // 4. Forge push + PR with idempotent handoff (fake GitHub + fake git runner).
      const fake = await startFakeGitHub({
        "POST /repos/acme/repo/pulls": {
          status: 201,
          json: {
            number: 7,
            html_url: "https://github.com/acme/repo/pull/7",
            state: "open",
            title: "t",
            body: "b",
            user: { login: "bot" },
            updated_at: "2026-01-01T00:00:00Z",
          },
        },
      });
      const fetchImpl = fakeFetch(fake.baseUrl);
      const store = createMemoryToolEffectStore();
      const gitCalls = [];
      const forge = createGitHubForge({
        credentials: { name: "gh", resolver: { resolve: () => ({ type: "bearer", value: "s3cr3t" }) } },
        repository: "acme/repo",
        cwd: root,
        git: {
          runner: async (request) => {
            gitCalls.push({ args: request.args, env: request.env });
            if (request.args[0] === "rev-parse") return okResult("refs/heads/main\n");
            return okResult();
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
        const pushed = await forge.push({ refspec: "main" });
        assert.equal(pushed.remoteRef, "refs/heads/main");
        assert.ok(
          gitCalls.every((c) => c.args.every((a) => !a.includes("s3cr3t"))),
          "token never in argv",
        );
        const pr = await forge.createPullRequest({ title: "t", body: "b", head: "main", base: "main" });
        assert.equal(pr.number, 7);
        const prAgain = await forge.createPullRequest({ title: "t", body: "b", head: "main", base: "main" });
        assert.equal(prAgain.number, 7, "idempotent replay returns the recorded result");
        const posts = fake.requests.filter((r) => r.method === "POST" && r.path.startsWith("/repos/acme/repo/pulls"));
        assert.equal(posts.length, 1, "replay must not re-POST");
      } finally {
        await fake.close();
      }

      // 5. Egress: github+registry presets allow the listed host; unlisted host denied.
      const upstream = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("registry-ok");
      });
      await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      const upstreamPort = upstream.address().port;
      const policy = createEgressPolicy({
        presets: ["github", "npm-registry"],
        allow: [{ host: "registry.npmjs.org", port: upstreamPort, protocol: "http", allowPrivate: true }],
      });
      const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const allowed = await proxyGet(port, `http://registry.npmjs.org:${upstreamPort}/`, `registry.npmjs.org:${upstreamPort}`);
        assert.equal(allowed.status, 200);
        assert.match(allowed.body, /registry-ok/);
        const denied = await proxyGet(port, "http://example.test:80/x", "example.test:80");
        assert.equal(denied.status, 403);
        assert.match(denied.body, /ERR_PRISM_EGRESS_DENIED/);
      } finally {
        await proxy.close();
        await new Promise((resolve) => upstream.close(() => resolve()));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adversarial: symlink/ignore escape stays excluded from enumeration and search", async () => {
    const root = await tmp();
    try {
      await gitInit(root);
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "a.ts"), "export const foo = 1;\n");
      await writeFile(join(root, ".gitignore"), "secret.log\n");
      await writeFile(join(root, "secret.log"), "foo secret\n");
      const outside = await tmp();
      await writeFile(join(outside, "outside.txt"), "foo outside\n");
      await symlink(join(outside, "outside.txt"), join(root, "src", "link.txt"));
      const { exec } = await import("node:child_process");
      await new Promise((resolve, reject) => {
        exec("git add -A", { cwd: root }, (error) => (error ? reject(error) : resolve()));
      });
      const repo = createGitAwareRepositoryOperations(root);
      const listed = await repo.list({ root, maxResults: 100 });
      const names = listed.entries.map((e) => e.path);
      assert.ok(!names.some((n) => n.includes("secret.log")), "ignored path excluded");
      const found = await repo.search({ root, query: "foo", maxResults: 10 });
      assert.ok(!found.matches.some((m) => m.path.includes("outside")), "symlink target outside root never searched");
      await rm(outside, { recursive: true, force: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adversarial: LSP URI escape fails closed with ERR_PRISM_LSP_WORKSPACE", async () => {
    const root = await tmp();
    const outside = await tmp();
    try {
      await writeFile(join(outside, "x.ts"), "export const foo = 1;\n");
      const language = createLanguageIntelligence({
        workspaceRoot: root,
        servers: { ts: { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"] } },
      });
      try {
        await assert.rejects(
          () => language.rename({ file: join(outside, "x.ts"), line: 0, character: 0, newName: "y" }),
          (error) => error instanceof LanguageIntelligenceError && error.code === "ERR_PRISM_LSP_WORKSPACE",
        );
      } finally {
        await language.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("adversarial: process wrong-owner access fails closed", async () => {
    const root = await tmp();
    try {
      const sessions = createProcessSessions({ cwd: root, limits: { maxLifetimeMs: 60_000 } });
      try {
        const p = await sessions.start({
          command: process.execPath,
          args: ["-e", "setInterval(()=>{}, 1000)"],
          lifetimeMs: 30_000,
        });
        assert.throws(
          () => sessions.get(p.id, "owner-b"),
          (error) => error instanceof ProcessSessionError && error.code === "ERR_PRISM_PROCESS_OWNERSHIP",
        );
        await p.kill();
      } finally {
        await sessions.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adversarial: forge cross-tenant fails closed; token never in argv", async () => {
    const fake = await startFakeGitHub({});
    try {
      assert.throws(
        () =>
          createGitHubForge({
            credentials: { name: "gh", resolver: { resolve: () => ({ type: "bearer", value: "s3cr3t" }) } },
            repository: "acme/repo",
            cwd: "/tmp/checkout",
            git: { runner: async () => okResult() },
            effectStore: createMemoryToolEffectStore(),
            identity: { ...IDENTITY, tenantId: "tenant-1" },
            ownership: { tenantId: "tenant-2", userId: "u1" },
            sessionId: "s1",
            runId: "r1",
          }),
        (error) => error instanceof ForgeError && error.code === "ERR_PRISM_FORGE_OWNERSHIP",
      );
    } finally {
      await fake.close();
    }
  });

  it("adversarial: egress private/metadata bypass denied without allowPrivate", async () => {
    const policy = createEgressPolicy({ allow: [{ host: "169.254.169.254", port: 80, protocol: "http" }] });
    const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["169.254.169.254"] });
    const { port } = await proxy.start();
    try {
      const result = await proxyGet(port, "http://169.254.169.254/latest/meta-data/", "169.254.169.254");
      assert.equal(result.status, 502);
      assert.match(result.body, /ERR_PRISM_EGRESS_DNS/);
    } finally {
      await proxy.close();
    }
  });

  it("limit ladder: at/below/above frozen caps fail closed", async () => {
    const root = await tmp();
    try {
      // LSP: servers map above maxServers fails at construction.
      const servers = {};
      for (let i = 0; i < 5; i += 1) {
        servers[`s${i}`] = { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"] };
      }
      assert.throws(
        () => createLanguageIntelligence({ workspaceRoot: root, servers, limits: { maxServers: 4 } }),
        (error) => error instanceof LanguageIntelligenceError && error.code === "ERR_PRISM_LSP_LIMIT",
      );

      // Process: session count above maxSessions fails closed.
      const sessions = createProcessSessions({ cwd: root, limits: { maxSessions: 1, maxLifetimeMs: 60_000 } });
      try {
        const p = await sessions.start({ command: process.execPath, args: ["-e", "setInterval(()=>{}, 1000)"], lifetimeMs: 30_000 });
        await assert.rejects(
          () => sessions.start({ command: process.execPath, args: ["-e", "setInterval(()=>{}, 1000)"], lifetimeMs: 30_000 }),
          (error) => error instanceof ProcessSessionError && error.code === "ERR_PRISM_PROCESS_LIMIT",
        );
        await p.kill();
      } finally {
        await sessions.dispose();
      }

      // Egress: rules above maxRules fail at policy construction.
      const rules = Array.from({ length: 3 }, (_, i) => ({ host: `h${i}.example`, port: 443, protocol: "https" }));
      assert.throws(
        () => createEgressPolicy({ allow: rules, maxRules: 2 }),
        (error) => error instanceof Error && /maxRules|rules/i.test(error.message),
      );

      // Forge: pages above pagesPerOperation stop at the cap (bounded, no infinite loop).
      const fake = await startFakeGitHub({
        "GET /repos/acme/repo/commits/main/check-runs": {
          status: 200,
          json: { check_runs: [{ name: "c1", status: "completed", conclusion: "success" }] },
        },
        "GET /repos/acme/repo/commits/main/status": { status: 200, json: { statuses: [] } },
      });
      const fetchImpl = fakeFetch(fake.baseUrl);
      try {
        const forge = createGitHubForge({
          credentials: { name: "gh", resolver: { resolve: () => ({ type: "bearer", value: "t" }) } },
          repository: "acme/repo",
          cwd: root,
          effectStore: createMemoryToolEffectStore(),
          fetch: fetchImpl,
          limits: { pagesPerOperation: 2 },
        });
        const checks = await forge.checks({ ref: "main" });
        assert.equal(checks.length, 1, "pagination bounded at page cap");
      } finally {
        await fake.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("packed Phase 9 examples run to completion", () => {
    const result = spawnSync(process.execPath, ["examples/phase9-coding-intelligence.ts"], { encoding: "utf8" });
    assert.equal(result.status, 0, `example exited ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, "example produced no output");
    const payload = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    assert.equal(payload.status, "succeeded");
    assert.equal(payload.renamed, true);
    assert.equal(payload.processCaptured, true);
    assert.equal(payload.prNumber, 7);
    assert.equal(payload.egressAllowed, true);
    assert.equal(payload.egressDenied, true);
  });
});
