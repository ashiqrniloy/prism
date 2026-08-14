/**
 * Phase 12 packed-install coding journey (plan 012 Task 3).
 * Runs INSIDE a fresh consumer that installed @arnilo tarballs (npm pack),
 * so every import below resolves from the consumer's node_modules — this
 * file itself must never import workspace paths.
 *
 * Composed journey using only public exports:
 *   ACP editor session (init capability negotiation, session new + load/resume)
 *   → bounded coding tools (git-aware list/search, glob, read-before-write
 *   write, delete, move) → sandboxed process session → forge handoff with
 *   idempotent PR creation.
 * Denial paths: execution-policy deny and read-before-write reject fail
 * closed.
 *
 * Run: node fixtures/e2e-coding-journey.mjs (inside the packed consumer)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingLifecycleEmitter } from "@arnilo/prism-coding-agent";
import { createMemoryToolEffectStore, createSecretRedactor, createToolRegistry, dispatchToolCall } from "@arnilo/prism";
import { createCodingApprovalPolicy } from "@arnilo/prism-coding-security";
import {
  createDeleteTool,
  createGitAwareRepositoryOperations,
  createGitHubForge,
  createGlobTool,
  createMoveTool,
  createProcessSessions,
  createReadPathSet,
  createWriteTool,
} from "@arnilo/prism-coding-agent";
import { createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const SECRET = "packed-coding-secret";
const redactor = createSecretRedactor([SECRET]);
const workspace = mkdtempSync(join(tmpdir(), "prism-coding-journey-"));
const started = Date.now();

function okResult(stdout = "") {
  return { exitCode: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
}

async function startFakeGitHub(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "/").split("?")[0];
      const key = `${req.method} ${path}`;
      const route = routes[key];
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "/",
        auth: req.headers.authorization ?? null,
      });
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: `no fake route for ${key}` }));
        return;
      }
      res.writeHead(route.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(route.json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function fakeFetch(baseUrl) {
  return (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "api.github.com") return fetch(`${baseUrl}${url.pathname}${url.search}`, init);
    return fetch(input, init);
  };
}

const ownership = {
  tenantId: "tenant-coding",
  accountId: "account-1",
  userId: "user-1",
};
const identity = {
  tenantId: "tenant-coding",
  accountId: "account-1",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["tools:execute"],
  verified: true,
  issuedAt: new Date().toISOString(),
};

try {
  // 1. ACP editor session: init capability negotiation, session new, load/resume.
  const emitter = createCodingLifecycleEmitter();
  const sessions = new Map(); // sessionId -> { id, cwd, stream }
  sessions.set("stored-session", {
    id: "stored-session",
    cwd: "/workspace",
    async *stream(prompt) {
      const text = typeof prompt === "string" ? prompt : (prompt?.content?.[0]?.text ?? "");
      if (!text.includes("edit")) {
        yield {
          type: "message_delta",
          sessionId: "stored-session",
          runId: "stored-run",
          content: { type: "text", text: "stored turn" },
        };
      }
      yield {
        type: "agent_done",
        sessionId: "stored-session",
        runId: "stored-run",
        reason: "end_turn",
      };
    },
  });
  const bindingFor = (entry) => ({
    session: {
      id: entry.id,
      async *stream(prompt) {
        yield* entry.stream(prompt);
      },
    },
  });
  const acpAgent = createPrismAcpAgent({
    authorize: () => ({ ownership }),
    lifecycle: {
      async *resumeStream(ref, resume, _opts) {
        const entry = sessions.get(ref.sessionId);
        if (!entry) throw new Error(`no session ${ref.sessionId}`);
        for (const decision of resume.decisions ?? []) {
          if (decision.outcome === "allow_once" || decision.outcome === "allow_for_run") {
            yield {
              type: "tool_call",
              sessionId: ref.sessionId,
              runId: ref.runId,
              call: {
                id: decision.approvalId,
                name: "write",
                arguments: { path: "/workspace/a.txt", content: "ok" },
              },
            };
            yield {
              type: "tool_result",
              sessionId: ref.sessionId,
              runId: ref.runId,
              result: {
                toolCallId: decision.approvalId,
                name: "write",
                content: "wrote",
              },
            };
          }
        }
        yield {
          type: "agent_done",
          sessionId: ref.sessionId,
          runId: ref.runId,
          reason: "end_turn",
        };
      },
    },
    sessionFactory: (input) => {
      const id = input.sessionId ?? `host-${sessions.size + 1}`;
      sessions.set(id, {
        id,
        cwd: input.cwd,
        async *stream(prompt) {
          const text = typeof prompt === "string" ? prompt : (prompt?.content?.[0]?.text ?? "");
          if (text.includes("edit")) {
            // Host-side approval path: suspend with a four-outcome decision.
            yield {
              type: "agent_suspended",
              sessionId: id,
              runId: `run-${id}`,
              version: 1,
              interruption: {
                kind: "tool_approval",
                reason: "edit the file",
                toolCallId: "tool-1",
                pendingDecisions: [
                  {
                    approvalId: "appr-1",
                    kind: "tool_approval",
                    toolCallId: "tool-1",
                    scope: { toolName: "write" },
                    reason: "edit the file",
                  },
                ],
              },
            };
            return;
          }
          yield {
            type: "agent_done",
            sessionId: id,
            runId: `run-${id}`,
            reason: "end_turn",
          };
        },
      });
      return bindingFor(sessions.get(id));
    },
    sessions: {
      async load({ sessionId }) {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        return bindingFor(entry);
      },
      async list({ cwd }) {
        return [...sessions.entries()].filter(([, e]) => !cwd || e.cwd === cwd).map(([sessionId, e]) => ({ sessionId, cwd: e.cwd }));
      },
      async resume({ sessionId }) {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        return bindingFor(entry);
      },
      async delete({ sessionId }) {
        sessions.delete(sessionId);
      },
    },
    modes: {
      modes: [
        { id: "edit", name: "Edit" },
        { id: "review", name: "Review" },
      ],
      defaultModeId: "edit",
    },
    coding: { lifecycle: emitter },
  });
  const permissionOptions = [];
  await client({ name: "journey-client" })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      permissionOptions.push(params.options.map((option) => option.kind));
      return { outcome: { outcome: "selected", optionId: "allow-once" } };
    })
    .connectWith(acpAgent, async (connection) => {
      const initialize = await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
      });
      assert.equal(initialize.protocolVersion, PROTOCOL_VERSION);
      assert.ok(initialize.agentCapabilities.loadSession, "loadSession advertised");
      assert.deepEqual(initialize.agentCapabilities.sessionCapabilities, {
        close: {},
        list: {},
        resume: {},
        delete: {},
      });

      const created = await connection.request(methods.agent.session.new, {
        cwd: "/workspace",
        mcpServers: [],
      });
      assert.deepEqual(created.modes, {
        currentModeId: "edit",
        availableModes: [
          { id: "edit", name: "Edit" },
          { id: "review", name: "Review" },
        ],
      });

      const resumed = await connection.request(methods.agent.session.load, {
        sessionId: "stored-session",
        cwd: "/workspace",
        mcpServers: [],
      });
      assert.deepEqual(
        resumed.modes?.availableModes?.map((m) => m.id),
        ["edit", "review"],
        "load resumes the stored session state",
      );

      // Edit via the four-outcome approval path.
      const edit = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "edit the file" }],
      });
      assert.equal(edit.stopReason, "end_turn");
      assert.equal(permissionOptions.length, 1, "edit prompted one permission request");
      assert.deepEqual(permissionOptions[0], ["allow_once", "allow_always", "reject_once", "reject_always"]);
    });

  // 2. Bounded coding tools: git-aware list/search, glob, read-before-write write, delete, move.
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "export const foo = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const bar = 2;\n");
  writeFileSync(join(workspace, ".gitignore"), "*.log\n");
  writeFileSync(join(workspace, "run.log"), "ignored\n");
  const { execSync } = await import("node:child_process");
  execSync("git init -q", { cwd: workspace });
  execSync("git add -A", { cwd: workspace });
  const repo = createGitAwareRepositoryOperations(workspace);
  const listed = await repo.list({ root: workspace, maxResults: 100 });
  assert.ok(listed.entries.some((e) => e.path === "src/a.ts"));
  assert.ok(!listed.entries.some((e) => e.path.includes("run.log")), "gitignore respected");
  const found = await repo.search({
    root: workspace,
    query: "foo",
    maxResults: 10,
  });
  assert.ok(
    found.matches.some((m) => m.path.endsWith("a.ts")),
    "search finds tracked content",
  );

  const readPaths = createReadPathSet();
  const policy = createCodingApprovalPolicy({
    roots: [workspace],
    readOnly: false,
    readBeforeWrite: true,
    readPathSet: readPaths,
    approve: async () => true,
  });
  const registry = createToolRegistry([
    createWriteTool(workspace, {
      executionPolicy: policy,
      requireReadBeforeWrite: true,
      readPathSet: readPaths,
    }),
    createGlobTool(workspace, { executionPolicy: policy }),
    createDeleteTool(workspace, { executionPolicy: policy }),
    createMoveTool(workspace, { executionPolicy: policy }),
  ]);
  const context = (id) => ({
    sessionId: "s-1",
    runId: "r-1",
    toolCallId: id,
    signal: new AbortController().signal,
    metadata: {},
  });
  // Write without read first → read-before-write reject (fail closed).
  const refused = await dispatchToolCall({
    call: {
      id: "w1",
      name: "write",
      arguments: {
        path: join(workspace, "src", "new.ts"),
        content: "export const n = 1;\n",
      },
    },
    registry,
    context: context("w1"),
    identity,
    redactor,
  });
  assert.match(JSON.stringify(refused), /not read in this session/i, "read-before-write must refuse");
  readPaths.add(join(workspace, "src", "new.ts"));
  const written = await dispatchToolCall({
    call: {
      id: "w2",
      name: "write",
      arguments: {
        path: join(workspace, "src", "new.ts"),
        content: "export const n = 1;\n",
      },
    },
    registry,
    context: context("w2"),
    identity,
    redactor,
  });
  assert.ok(written.content);
  const globbed = await dispatchToolCall({
    call: { id: "g1", name: "glob", arguments: { pattern: "src/**/*.ts" } },
    registry,
    context: context("g1"),
    identity,
    redactor,
  });
  assert.match(JSON.stringify(globbed), /new\.ts/);
  // Execution-policy deny (path outside roots) fails closed.
  const denied = await dispatchToolCall({
    call: {
      id: "d1",
      name: "write",
      arguments: { path: "/etc/prism-evil", content: "x" },
    },
    registry,
    context: context("d1"),
    identity,
    redactor,
  });
  assert.match(JSON.stringify(denied), /outside trusted roots|denied/i, "path outside trusted roots must be denied");

  // 3. Sandboxed process session.
  const sessions2 = createProcessSessions({
    cwd: workspace,
    sandbox: {
      async status() {
        return { state: "running" };
      },
      async startProcess(request) {
        const child = spawn(request.file, [...request.args], {
          cwd: request.cwd,
          env: { ...process.env, ...(request.env ?? {}) },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const onData = (buf) => request.onData?.(buf);
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        let exited = false;
        let exitCode = null;
        const waiters = [];
        child.on("exit", (code) => {
          exited = true;
          exitCode = code;
          for (const w of waiters) w();
        });
        return {
          async write(data) {
            await new Promise((resolveWrite, rejectWrite) => {
              child.stdin.write(Buffer.from(data), (err) => (err ? rejectWrite(err) : resolveWrite()));
            });
          },
          async signal() {},
          async kill() {
            child.kill("SIGKILL");
          },
          async wait() {
            if (exited) return { exitCode };
            await new Promise((resolve) => waiters.push(resolve));
            return { exitCode };
          },
        };
      },
    },
  });
  const p = await sessions2.start({
    command: process.execPath,
    args: ["-e", "console.log('sandboxed run captured'); setTimeout(()=>{}, 5000)"],
    lifetimeMs: 30_000,
  });
  let cursor = 0;
  let saw = "";
  for (let i = 0; i < 50; i += 1) {
    const chunk = await p.output({ cursor, maxBytes: 64 });
    saw += chunk.data;
    cursor = chunk.cursor;
    if (saw.includes("sandboxed run captured")) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(saw, /sandboxed run captured/);
  await p.kill();
  const exit = await p.wait({ timeoutMs: 10_000 });
  assert.equal(exit.state, "killed");
  await sessions2.dispose();

  // 4. Forge handoff: push + idempotent PR create + handoff reconcile.
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
    "GET /repos/acme/repo/pulls/7": {
      status: 200,
      json: {
        number: 7,
        state: "open",
        mergeable: true,
        html_url: "https://github.com/acme/repo/pull/7",
        user: { login: "bot" },
        updated_at: "2026-01-01T00:00:00Z",
      },
    },
  });
  const forgeStore = createMemoryToolEffectStore();
  const forge = createGitHubForge({
    credentials: {
      name: "gh",
      resolver: { resolve: () => ({ type: "bearer", value: SECRET }) },
    },
    repository: "acme/repo",
    cwd: workspace,
    git: {
      runner: async (request) => {
        if (request.args[0] === "rev-parse") return okResult("refs/heads/main\n");
        return okResult();
      },
    },
    effectStore: forgeStore,
    fetch: fakeFetch(fake.baseUrl),
    identity,
    ownership,
    sessionId: "s-forge",
    runId: "r-forge",
  });
  const pushed = await forge.push({ refspec: "main" });
  assert.equal(pushed.remoteRef, "refs/heads/main");
  const pr = await forge.createPullRequest({
    title: "t",
    body: "b",
    head: "main",
    base: "main",
  });
  assert.equal(pr.number, 7);
  const prAgain = await forge.createPullRequest({
    title: "t",
    body: "b",
    head: "main",
    base: "main",
  });
  assert.equal(prAgain.number, 7, "idempotent replay returns recorded result");
  const posts = fake.requests.filter((r) => r.method === "POST" && r.path.startsWith("/repos/acme/repo/pulls"));
  assert.equal(posts.length, 1, "replay must not re-POST");
  const reconciled = await forge.reconcileHandoff({
    base: "main",
    head: "main",
  });
  assert.ok(reconciled, "handoff reconciliation completed");
  await fake.close();

  console.log(`CODING JOURNEY OK in ${Date.now() - started}ms`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
