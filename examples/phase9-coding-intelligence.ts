import { exec } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryToolEffectStore } from "@arnilo/prism";
import {
  createBoundGitRunner,
  createGitAwareRepositoryOperations,
  createGitHubForge,
  createLanguageIntelligence,
  createProcessSessions,
} from "@arnilo/prism-coding-agent";
import { createAllowListEgressProxy, createEgressPolicy } from "@arnilo/prism-coding-security";

/**
 * Network-free Phase 9 composed example (plan 009 Task 7).
 * One workspace: ignore-aware enumeration → approved LSP rename → managed
 * process session → idempotent forge PR (fake GitHub) → allow-list egress
 * (github+registry presets; unlisted host denied). No network, no credentials.
 */

const FAKE_LSP = fileURLToPath(new URL("../packages/coding-agent/src/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
const IDENTITY = {
  tenantId: "tenant-1",
  userId: "u1",
  principal: { kind: "user", id: "u1" },
  scopes: ["repo"],
  issuedAt: new Date().toISOString(),
  verified: true,
} as const;
const OWNERSHIP = { tenantId: "tenant-1", userId: "u1" };

function run(cwd: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error) => (error ? reject(error) : resolve()));
  });
}

function proxyGet(proxyPort: number, target: string, hostHeader: string): Promise<{ status: number; body: string }> {
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

async function main(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "phase9-example-"));
  const report: Record<string, unknown> = { status: "succeeded" };
  try {
    // 1. Git-aware enumeration: tracked files listed, ignored file excluded.
    const runner = await createBoundGitRunner();
    const git = async (...args: string[]) => {
      const r = await runner.exec({ args, cwd: root });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString("utf8") || `git ${args[0]} failed`);
    };
    await git("init");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const foo = 1;\n");
    await writeFile(join(root, ".gitignore"), "*.log\n");
    await writeFile(join(root, "run.log"), "ignored\n");
    await run(root, "git add -A");
    const repo = createGitAwareRepositoryOperations(root);
    const listed = await repo.list({ root, maxResults: 100 });
    const names = listed.entries.map((e) => e.path);
    report.enumerated = names.filter((n) => n.endsWith(".ts"));
    report.ignoredExcluded = !names.some((n) => n.includes("run.log"));

    // 2. LSP rename through the execution policy (approved) + atomic write.
    const language = createLanguageIntelligence({
      workspaceRoot: root,
      servers: { ts: { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"] } },
      policy: { check: async () => ({ allowed: true }) },
    });
    try {
      const edit = await language.rename({ file: join(root, "src", "a.ts"), line: 0, character: 11, newName: "renamed" });
      report.renamed = edit.edits.length >= 1 && (await readFile(join(root, "src", "a.ts"), "utf8")).includes("renamed");
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
      report.processCaptured = saw.includes("test run captured");
      await p.kill();
      await p.wait({ timeoutMs: 10_000 });
    } finally {
      await sessions.dispose();
    }

    // 4. Forge: push + PR with idempotent handoff (fake GitHub, fake git runner).
    const fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        void Buffer.concat(chunks).toString("utf8");
        if (req.method === "POST" && (req.url ?? "").startsWith("/repos/acme/repo/pulls")) {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              number: 7,
              html_url: "https://github.com/acme/repo/pull/7",
              state: "open",
              title: "t",
              body: "b",
              user: { login: "bot" },
              updated_at: "2026-01-01T00:00:00Z",
            }),
          );
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "no route" }));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const fakePort = (fake.address() as { port: number }).port;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.host === "api.github.com") return fetch(`http://127.0.0.1:${fakePort}${url.pathname}${url.search}`, init);
      return fetch(input, init);
    }) as typeof fetch;
    const forge = createGitHubForge({
      credentials: { name: "gh", resolver: { resolve: () => ({ type: "bearer", value: "example-token" }) } },
      repository: "acme/repo",
      cwd: root,
      git: {
        runner: async (request) => {
          if (request.args[0] === "rev-parse") {
            return {
              exitCode: 0,
              stdout: Buffer.from("refs/heads/main\n"),
              stderr: Buffer.alloc(0),
              timedOut: false,
              aborted: false,
              outputBytes: 0,
            };
          }
          return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, aborted: false, outputBytes: 0 };
        },
      },
      effectStore: createMemoryToolEffectStore(),
      fetch: fetchImpl,
      identity: IDENTITY,
      ownership: OWNERSHIP,
      sessionId: "s1",
      runId: "r1",
    });
    try {
      await forge.push({ refspec: "main" });
      const pr = await forge.createPullRequest({ title: "t", body: "b", head: "main", base: "main" });
      const prAgain = await forge.createPullRequest({ title: "t", body: "b", head: "main", base: "main" });
      report.prNumber = pr.number;
      report.idempotentReplay = prAgain.number === pr.number;
    } finally {
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }

    // 5. Egress: github+registry presets; listed host allowed, unlisted denied.
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("registry-ok");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const policy = createEgressPolicy({
      presets: ["github", "npm-registry"],
      allow: [{ host: "registry.npmjs.org", port: upstreamPort, protocol: "http", allowPrivate: true }],
    });
    const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
    const { port } = await proxy.start();
    try {
      const allowed = await proxyGet(port, `http://registry.npmjs.org:${upstreamPort}/`, `registry.npmjs.org:${upstreamPort}`);
      const denied = await proxyGet(port, "http://example.test:80/x", "example.test:80");
      report.egressAllowed = allowed.status === 200 && allowed.body.includes("registry-ok");
      report.egressDenied = denied.status === 403 && denied.body.includes("ERR_PRISM_EGRESS_DENIED");
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return report;
}

main()
  .then((report) => {
    console.log(JSON.stringify(report));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
