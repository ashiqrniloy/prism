/**
 * Phase 26 (plan 026 Task 7) protected real coding-agent release journey.
 * Runs INSIDE a fresh packed consumer (see scripts/phase26-coding-journey.test.mjs),
 * so every package import resolves from the consumer node_modules — never
 * workspace source paths. Every leg uses real host services:
 *
 *   provider    real LLM provider call through the Prism AIProvider contract
 *               (PRISM_CODING_PROVIDER = absolute path to a host adapter module
 *               exporting createJourneyProvider() -> { provider, request } and
 *               optionally journeySecrets() -> string[] for the leak scan)
 *   docker      digest-pinned Docker sandbox (PRISM_TEST_DOCKER_BIN/IMAGE)
 *   workspace   durable Postgres checkpoints/leases + worktree lifecycle
 *   agent-edit  real provider-driven edit through ACP with policy approval
 *   check-diagnostics  real named check + host parser + diagnosticDelta
 *   patch-review       patch artifact over the server ArtifactService + review
 *   process-recovery   durable process restart/replica with attach-if-attested
 *   durable-cancel     ownership/version/fence-checked ACP cancellation
 *   forge       real GitHub push + lookup-before-create PR + reconcile + cleanup
 *   browser     host Playwright browser inspection (PRISM_LIVE_PLAYWRIGHT)
 *   pty         host PTY adapter when PRISM_TEST_PTY_BACKEND is set
 *
 * Side effects carry the unique run suffix; cleanup is idempotent and every
 * cleanup step is recorded. Unknown cleanup blocks the journey. The report
 * (PRISM_PHASE26_JOURNEY_REPORT) carries timings, states, and ids/hashes only —
 * never prompts, source bodies, terminal output, tokens, or browser storage.
 *
 * Run: node journey.mjs (orchestrated by scripts/phase26-coding-journey.test.mjs)
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import {
  createAgent,
  createAgentRunLifecycle,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
} from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import { ACP_RUN_CANCEL_NAMESPACE, createAcpRunRecovery, createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
import {
  assertCodingPatchAccepted,
  createCodingCheckTool,
  createCodingPatchReviewManifest,
  createCodingWorkspaceLifecycle,
  createGitHubForge,
  createGitOperations,
  createProcessSessions,
  createReadPathSet,
  createReadTool,
  createWriteTool,
  diagnosticDelta,
  normalizeDiagnostics,
} from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy, createDockerSandbox } from "@arnilo/prism-coding-security";
import { createArtifactService } from "@arnilo/prism-core/runtime/server";
import { createPostgresPersistence } from "@arnilo/prism-core/sessions/postgres";
import { createBrowserManager, createBrowserTools } from "@arnilo/prism-web-tools/browser";

const env = process.env;
const suffix = env.PRISM_JOURNEY_SUFFIX ?? `j${Date.now().toString(36)}${randomBytes(4).toString("hex")}`; // random suffix (CodeQL js/insecure-randomness, alerts 52-55)
const ws = env.PRISM_JOURNEY_WORKSPACE ?? join(tmpdir(), `prism-journey-${suffix}`);
const reportPath = env.PRISM_PHASE26_JOURNEY_REPORT ?? join(ws, "report.json");
const startedAt = Date.now();

const legs = [];
const cleanups = [];
let blocked = false;
let blockReason = "";

function fail(id, message) {
  blocked = true;
  blockReason = `${id}: ${message}`;
  console.error(`PROTECTED JOURNEY leg ${id} blocked: ${message}`);
}

async function leg(id, run) {
  const at = Date.now();
  try {
    const ids = await run();
    legs.push({ id, state: "pass", ms: Date.now() - at, ids });
    console.log(`PROTECTED JOURNEY leg ${id} pass (${Date.now() - at}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    legs.push({ id, state: "blocked", ms: Date.now() - at, error: message.slice(0, 400) });
    fail(id, message);
  }
}

async function cleanup(id, run) {
  const at = Date.now();
  try {
    await run();
    cleanups.push({ id, state: "pass", ms: Date.now() - at });
    console.log(`PROTECTED JOURNEY cleanup ${id} pass (${Date.now() - at}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cleanups.push({ id, state: "blocked", ms: Date.now() - at, error: message.slice(0, 400) });
    blocked = true;
    blockReason = `cleanup ${id}: ${message}`;
    console.error(`PROTECTED JOURNEY cleanup ${id} blocked: ${message}`);
  }
}

const ownership = { tenantId: "tenant-journey", accountId: "account-1", userId: "user-1" };
const identity = {
  tenantId: "tenant-journey",
  accountId: "account-1",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["tools:execute"],
  verified: true,
  issuedAt: new Date().toISOString(),
};

const forgeToken = env.PRISM_CODING_FORGE_TOKEN ?? "";
const forgeRepository = env.PRISM_CODING_FORGE_REPOSITORY ?? "";
const secrets = [forgeToken, env.PRISM_TEST_DOCKER_IMAGE ?? "", env.PRISM_TEST_POSTGRES_URL ?? ""];
const redactor = createSecretRedactor(secrets.filter(Boolean));

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${forgeToken}`).toString("base64")}`,
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

let pg = null;
let sandbox = null;
let lifecycle = null;
let gitOps = null;
let workspaceTaskId = "";
let worktreePath = "";
let prismAgent = null;
let acpStore = null;
let artifactService = null;
let artifactId = "";
let replicaA = null;
let replicaB = null;
let replicaC = null;
let ptySessions = null;
let browserManager = null;
let forge = null;
let prNumber = 0;
let spawnedChildren = 0;
let repoRoot = "";
let branch = "";
const ids = { suffix };

try {
  mkdirSync(ws, { recursive: true });
  repoRoot = join(ws, "repo");
  const worktreeRoot = join(ws, "worktrees");
  branch = `prism-journey-${suffix}`;
  ids.branch = branch;

  // ---------------------------------------------------------------- postgres
  pg = await createPostgresPersistence({
    connectionString: env.PRISM_TEST_POSTGRES_URL,
    schema: `journey_${suffix.replace(/[^a-z0-9_]/gi, "").slice(0, 40)}`,
  });
  // ---------------------------------------------------------------- provider
  await leg("provider", async () => {
    assert.ok(env.PRISM_CODING_PROVIDER, "PRISM_CODING_PROVIDER required");
    const adapter = await import(pathToFileURL(env.PRISM_CODING_PROVIDER).href);
    const { provider, request } = adapter.createJourneyProvider();
    assert.ok(provider?.generate, "adapter must export createJourneyProvider() -> { provider, request }");
    const events = await collectProviderEvents(provider, request);
    const text = events
      .filter((e) => e.type === "content_delta" && e.content.type === "text")
      .map((e) => e.content.text)
      .join("");
    assert.ok(text.length > 0, "provider returned no text");
    const adapterSecrets = typeof adapter.journeySecrets === "function" ? adapter.journeySecrets() : [];
    for (const secret of adapterSecrets.filter(Boolean)) {
      if (secret && JSON.stringify(events).includes(secret)) throw new Error("provider event stream leaked a credential");
    }
    ids.providerModel = request.model?.model ?? "host";
    return { model: ids.providerModel };
  });

  // ---------------------------------------------------------------- docker
  await leg("docker", async () => {
    assert.ok(env.PRISM_TEST_DOCKER_BIN && env.PRISM_TEST_DOCKER_IMAGE, "PRISM_TEST_DOCKER_BIN/IMAGE required");
    assert.ok(env.PRISM_TEST_DOCKER_IMAGE.includes("@sha256:"), "PRISM_TEST_DOCKER_IMAGE must be digest-pinned");
    sandbox = await createDockerSandbox({
      docker: env.PRISM_TEST_DOCKER_BIN,
      image: env.PRISM_TEST_DOCKER_IMAGE,
      sourceRoot: ws,
      user: env.PRISM_TEST_DOCKER_USER ?? "10001:10001",
      env: { PRISM_JOURNEY_SUFFIX: suffix },
      labels: { "prism.journey": suffix },
      secrets,
    });
    ids.container = sandbox.id;
    const output = [];
    const result = await sandbox.execFile({
      file: "sh",
      args: ["-c", `test -n "${suffix}" && echo PRISM_DOCKER_OK`],
      timeout: 60_000,
      onData: (chunk) => output.push(chunk.toString("utf8")),
    });
    assert.equal(result.exitCode, 0, `sandbox command failed: ${output.join("")}`);
    assert.ok(output.join("").includes("PRISM_DOCKER_OK"), "sandbox output missing PRISM_DOCKER_OK");
    const cap = await sandbox.status();
    assert.equal(cap.state, "running");
    return { container: ids.container };
  });

  // ---------------------------------------------------------------- workspace
  await leg("workspace", async () => {
    assert.ok(forgeRepository && forgeToken, "PRISM_CODING_FORGE_REPOSITORY and PRISM_CODING_FORGE_TOKEN required");
    mkdirSync(repoRoot, { recursive: true });
    git(ws, ["clone", "--depth=1", `https://github.com/${forgeRepository}.git`, repoRoot]);
    // The seed commit lands on main; the lifecycle creates the run branch as a
    // linked worktree (git worktree add -b), so no branch exists here yet.
    writeFileSync(join(repoRoot, "counter.ts"), "export const count = 1;\n");
    git(repoRoot, ["add", "counter.ts"]);
    git(repoRoot, [
      "-c",
      "user.name=prism-journey",
      "-c",
      "user.email=journey@prism.local",
      "commit",
      "-q",
      "-m",
      `journey seed ${suffix}`,
    ]);
    const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim() || "/usr/bin/git";
    gitOps = await createGitOperations({ cwd: repoRoot, gitPath });
    const fp = await gitOps.fingerprint();
    ids.remoteFingerprint = fp.remoteFingerprint;
    mkdirSync(worktreeRoot, { recursive: true });
    lifecycle = createCodingWorkspaceLifecycle({
      checkpoints: pg.checkpoints,
      leases: pg.leases,
      ownerId: "replica-a",
      ownership,
      repositories: { app: { root: repoRoot, git: gitOps } },
      worktreeRoots: [worktreeRoot],
      // The run-owned worktree legitimately advances its head (the journey
      // edit); the host policy explicitly allows removing a head-mismatched
      // own worktree — the refusal matrix stays intact for everything else.
      policy: { allowMismatchedCleanup: true },
    });
    const created = await lifecycle.create({
      taskId: `journey-${suffix}`,
      repositories: [{ repositoryId: "app", branch }],
    });
    workspaceTaskId = `journey-${suffix}`;
    worktreePath = created.repositories[0].worktreePath;
    assert.ok(existsSync(join(worktreePath, "counter.ts")), "worktree checkout missing counter.ts");
    await lifecycle.verify({ taskId: workspaceTaskId, ownership });
    ids.workspaceId = created.workspaceId;
    ids.worktree = worktreePath;
    return { workspaceId: created.workspaceId, worktree: worktreePath };
  });

  // ---------------------------------------------------------------- agent edit
  await leg("agent-edit", async () => {
    const readPaths = createReadPathSet();
    const toolPolicy = createCodingApprovalPolicy({
      roots: [worktreePath],
      readOnly: false,
      readBeforeWrite: true,
      readPathSet: readPaths,
      approve: async () => true,
    });
    const tools = [
      createReadTool(worktreePath, { executionPolicy: toolPolicy, readPathSet: readPaths }),
      createWriteTool(worktreePath, {
        executionPolicy: toolPolicy,
        requireReadBeforeWrite: true,
        readPathSet: readPaths,
      }),
    ];
    const providerAdapter = await import(pathToFileURL(env.PRISM_CODING_PROVIDER).href);
    const { provider, request } = providerAdapter.createJourneyProvider();
    prismAgent = createAgent({
      id: "journey-agent",
      model: request.model,
      provider,
      store: createMemorySessionStore(),
      runState: { checkpoints: pg.checkpoints, definitionRevision: "journey-1", interruptBeforeTool: true },
      tools,
      identity,
      ownership,
      redactor,
      limits: { maxTurns: 12 },
    });
    const lifecycleApi = createAgentRunLifecycle({
      checkpoints: pg.checkpoints,
      resolveAgent: () => ({ agent: prismAgent, definitionRevision: "journey-1" }),
    });
    acpStore = {
      entries: new Map(),
      async save(entry) {
        this.entries.set(entry.sessionId, entry);
      },
      async loadAll() {
        return [...this.entries.values()];
      },
      async evict(sessionId) {
        this.entries.delete(sessionId);
      },
    };
    const sessionId = `acp-edit-${suffix}`;
    const makeApp = () =>
      createPrismAcpAgent({
        authorize: () => ({ ownership }),
        sessionFactory: () => ({ session: prismAgent.createSession({ id: sessionId }), agentId: "journey-agent" }),
        lifecycle: lifecycleApi,
        sessionStore: acpStore,
        sessions: {
          load: async () => ({ session: prismAgent.createSession({ id: sessionId }), agentId: "journey-agent" }),
          list: async () => [{ sessionId, cwd: worktreePath }],
          resume: async () => ({ session: prismAgent.createSession({ id: sessionId }), agentId: "journey-agent" }),
          delete: async () => {},
        },
        recovery: { checkpoints: pg.checkpoints, leases: pg.leases, ownerId: "replica-a" },
      });
    const app = makeApp();
    const approvals = [];
    await client({ name: "journey-edit-client" })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        approvals.push(params.options.map((option) => option.kind));
        return { outcome: { outcome: "selected", optionId: "allow-once" } };
      })
      .connectWith(app, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        const created = await connection.request(methods.agent.session.new, { cwd: worktreePath, mcpServers: [] });
        const result = await connection.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [
            {
              type: "text",
              text: `Worktree: ${worktreePath}. Read counter.ts, then write counter.ts with exactly: export const count = 2; Then stop.`,
            },
          ],
        });
        assert.equal(result.stopReason, "end_turn", `agent did not finish: ${JSON.stringify(result).slice(0, 300)}`);
      });
    assert.ok(approvals.length >= 1, "the write tool must have required policy approval");
    const edited = readFileSync(join(worktreePath, "counter.ts"), "utf8");
    assert.ok(edited.includes("count = 2"), `agent edit did not land: ${edited}`);
    ids.editSession = sessionId;
    return { approvals: approvals.length, sessionId };
  });

  // ---------------------------------------------------------------- check diagnostics
  await leg("check-diagnostics", async () => {
    const brokenPath = join(worktreePath, "broken.ts");
    writeFileSync(brokenPath, "const x = ;\n");
    const checkTool = createCodingCheckTool(worktreePath, {
      checks: { syntax: { file: process.execPath, args: ["--check", brokenPath] } },
    });
    const registry = createToolRegistry([checkTool]);
    const result = await dispatchToolCall({
      call: { id: "check-1", name: "coding_check", arguments: { name: "syntax" } },
      registry,
      context: { sessionId: "s-check", runId: "r-check", toolCallId: "check-1", signal: new AbortController().signal, metadata: {} },
      identity,
      redactor,
    });
    const text = JSON.stringify(result);
    assert.ok(text.includes("SyntaxError") || result.exitCode === 1, `check did not report a syntax error: ${text.slice(0, 400)}`);
    // Host-supplied parser: locate the `path:line` marker and the message.
    const location = /^(.+\.ts):(\d+)/m.exec(text);
    const message = /SyntaxError: ([^\n"\\]+)/.exec(text)?.[1] ?? "syntax error";
    assert.ok(location, `no parseable location: ${text.slice(0, 400)}`);
    const line = Number(location[2]) - 1;
    const raw = [
      { file: brokenPath, message, line, character: 0, endLine: line, endCharacter: 16, severity: "error", source: "node", code: "syntax" },
    ];
    const normalized = normalizeDiagnostics(raw, { workspaceRoot: worktreePath, generation: 1 });
    assert.equal(normalized.length, 1, "normalization must keep the parsed diagnostic");
    const delta = diagnosticDelta({ next: normalized, previous: [] });
    assert.equal(delta.added.length, 1, "first refresh must report one added diagnostic");
    const again = diagnosticDelta({ next: normalized, previous: normalized });
    assert.equal(again.unchanged.length, 1, "same-generation refresh must report unchanged");
    rmSync(brokenPath, { force: true });
    return { diagnostics: normalized.length };
  });

  // ---------------------------------------------------------------- patch review
  await leg("patch-review", async () => {
    // The agent-driven edit becomes a real commit before the patch manifest.
    git(join(worktreePath), [
      "-c",
      "user.name=prism-journey",
      "-c",
      "user.email=journey@prism.local",
      "commit",
      "-q",
      "-a",
      "-m",
      `journey edit ${suffix}`,
    ]);
    const patch = git(repoRoot, ["diff", `main...${branch}`, "--", "counter.ts"]);
    const numstat = git(repoRoot, ["diff", "--numstat", `main...${branch}`])
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [additions, deletions, file] = line.split("\t");
        return { file, additions: Number(additions), deletions: Number(deletions) };
      });
    const patchBytes = Buffer.from(patch, "utf8");
    // Host-owned artifact reference: the artifact service never accepts local
    // filesystem paths in uri (fail closed); the body stays host-owned.
    const patchUri = `journey/${suffix}/counter.patch`;
    const handoff = await gitOps.prHandoff({ base: "main", head: branch, checks: [{ name: "syntax", exitCode: 0, summary: "ok" }] });
    assert.ok(handoff.changedPaths.includes("counter.ts"), "handoff must list the changed path");
    artifactService = createArtifactService(pg.checkpoints, {
      redactor,
      linkSecret: `journey-link-${suffix}`,
    });
    const { review, artifactInput } = createCodingPatchReviewManifest({
      threadId: `journey-${suffix}`,
      artifactId: `patch-${suffix}`,
      identity: { repositoryId: "app", remoteFingerprint: ids.remoteFingerprint, defaultBranch: "main" },
      base: "main",
      head: branch,
      patch: { kind: "patch", uri: patchUri, sha256: sha256Of(patchBytes), bytes: patchBytes.length },
      changedPaths: handoff.changedPaths,
      diffstat: numstat,
      checks: [{ name: "syntax", exitCode: 0, summary: "ok" }],
      diagnostics: [],
    });
    const attached = await artifactService.attach({ ...artifactInput, ownership, identity });
    artifactId = attached.id;
    const pending = assertCodingPatchAccepted({ review, artifact: attached });
    assert.equal(pending.state, "pending", "fresh review must be pending");
    const firstVersion = attached.revisions[0].version;
    const approved = await artifactService.approve({
      threadId: `journey-${suffix}`,
      artifactId,
      version: firstVersion,
      identity,
      ownership,
    });
    assert.ok(approved.lastValidatedVersion === 1);
    const accepted = assertCodingPatchAccepted({ review, artifact: approved });
    assert.equal(accepted.state, "accepted", `expected accepted, got ${accepted.state}`);
    // A newer revision supersedes the acceptance (stale acceptance refused).
    const revised = await artifactService.revise({
      threadId: `journey-${suffix}`,
      artifactId,
      uri: patchUri,
      hash: sha256Of(Buffer.from(`${patch} #${suffix}\n`, "utf8")),
      identity,
      ownership,
    });
    const superseded = assertCodingPatchAccepted({ review, artifact: revised });
    assert.equal(superseded.state, "superseded", "a newer patch revision must supersede prior acceptance");
    ids.artifactId = artifactId;
    return { artifactId, digest: review.digest };
  });

  // ---------------------------------------------------------------- process recovery
  await leg("process-recovery", async () => {
    const live = new Map();
    const recoveryBackend = {
      async attach(ref) {
        return live.get(ref) ?? null;
      },
    };
    const makeSandbox = () => ({
      async status() {
        return { state: "running" };
      },
      async startProcess(request) {
        spawnedChildren += 1;
        const child = spawn(request.file, [...request.args], {
          cwd: request.cwd,
          env: { ...process.env, ...(request.env ?? {}) },
          stdio: ["ignore", "ignore", "ignore"],
        });
        const ref = `journey-child-${child.pid}`;
        let exited = false;
        let exitCode = null;
        const waiters = [];
        child.on("exit", (code) => {
          exited = true;
          exitCode = code;
          for (const w of waiters) w();
        });
        const handle = {
          ref,
          async write() {},
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
        live.set(ref, handle);
        return handle;
      },
    });
    const limits = { leaseTtlMs: 3_000 };
    replicaA = createProcessSessions({
      cwd: repoRoot,
      ownership,
      sandbox: makeSandbox(),
      checkpoints: pg.checkpoints,
      leases: pg.leases,
      ownerId: "replica-a",
      recoveryBackend,
      recoveryLimits: limits,
    });
    await replicaA.start({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      lifetimeMs: 120_000,
    });
    await replicaA.start({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      lifetimeMs: 120_000,
    });
    // Split-brain fence: a second replica over the same durable stores must
    // not attach while the first holds the record leases.
    replicaB = createProcessSessions({
      cwd: repoRoot,
      ownership,
      sandbox: makeSandbox(),
      checkpoints: pg.checkpoints,
      leases: pg.leases,
      ownerId: "replica-b",
      recoveryBackend,
      recoveryLimits: limits,
    });
    const split = await replicaB.recover({});
    const unattached = split.records.filter((r) => r.outcome === "unknown");
    assert.ok(unattached.length >= 2, `second replica must not attach while the first owns the lease: ${JSON.stringify(split.records)}`);
    assert.equal(spawnedChildren, 2, "recovery must never re-spawn");
    // Durable cancellation is fence-checked: replica B cannot cancel records
    // owned by replica A's live leases — no mutation, no fabricated exit.
    await replicaB.cancelOwned("tenant-journey:account-1:user-1");
    const after = await replicaB.recover({});
    for (const r of after.records) {
      assert.equal(r.outcome, "unknown", `fenced cancel must not mutate: ${JSON.stringify(after.records)}`);
      assert.equal(r.exitCode, null, "fenced cancel must never fabricate an exit code");
    }
    // Host restart: the first replica's record leases lapse (crash). A fresh
    // replica with the same host backend attaches-if-attested — control-only,
    // still no re-spawn.
    await new Promise((resolve) => setTimeout(resolve, 3_600));
    replicaC = createProcessSessions({
      cwd: repoRoot,
      ownership,
      sandbox: makeSandbox(),
      checkpoints: pg.checkpoints,
      leases: pg.leases,
      ownerId: "replica-a",
      recoveryBackend,
      recoveryLimits: limits,
    });
    const restarted = await replicaC.recover({});
    assert.ok(restarted.attached >= 2, `restart must attach both attested records: ${JSON.stringify(restarted.records)}`);
    assert.equal(spawnedChildren, 2, "attach must never re-spawn");
    // Clean shutdown of the attached children produces terminal durable state
    // with no fabricated exit code (a fresh replica observes it).
    await replicaC.dispose();
    const replicaD = createProcessSessions({
      cwd: repoRoot,
      ownership,
      sandbox: makeSandbox(),
      checkpoints: pg.checkpoints,
      leases: pg.leases,
      ownerId: "replica-a",
      recoveryBackend,
      recoveryLimits: limits,
    });
    // The kill transitions persist fire-and-forget; poll for terminal state.
    let final = null;
    const terminalDeadline = Date.now() + 8_000;
    while (Date.now() < terminalDeadline) {
      final = await replicaD.recover({});
      if (final.records.length > 0 && final.records.every((r) => r.outcome === "terminal")) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(
      final?.records.every((r) => r.outcome === "terminal"),
      `records must be terminal after dispose: ${JSON.stringify(final)}`,
    );
    await replicaD.dispose();
    ids.recovery = `split=${unattached.length}/attached=${restarted.attached}`;
    return { spawned: spawnedChildren, splitBrain: unattached.length, attached: restarted.attached };
  });

  // ---------------------------------------------------------------- durable cancel
  await leg("durable-cancel", async () => {
    assert.ok(prismAgent && acpStore, "agent-edit leg must have run first");
    const sessionId = `acp-cancel-${suffix}`;
    const lifecycleApi = createAgentRunLifecycle({
      checkpoints: pg.checkpoints,
      resolveAgent: () => ({ agent: prismAgent, definitionRevision: "journey-1" }),
    });
    const app = createPrismAcpAgent({
      authorize: () => ({ ownership }),
      sessionFactory: () => ({ session: prismAgent.createSession({ id: sessionId }), agentId: "journey-agent" }),
      lifecycle: lifecycleApi,
      sessionStore: acpStore,
      sessions: {
        load: async () => ({ session: prismAgent.createSession({ id: sessionId }), agentId: "journey-agent" }),
        list: async () => [],
        resume: async () => ({ session: prismAgent.createSession({ id: sessionId }), agentId: "journey-agent" }),
        delete: async () => {},
      },
      recovery: { checkpoints: pg.checkpoints, leases: pg.leases, ownerId: "replica-a" },
    });
    // The client rejects every pending tool approval, so the run must never
    // execute its write (no replay), and the durable cancel then records the
    // terminal-idempotent cancellation marker through Postgres CAS + fencing.
    await client({ name: "journey-cancel-client" })
      .onRequest(methods.client.session.requestPermission, () => ({
        outcome: { outcome: "selected", optionId: "reject-once" },
      }))
      .connectWith(app, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        const created = await connection.request(methods.agent.session.new, { cwd: worktreePath, mcpServers: [] });
        await connection
          .request(methods.agent.session.prompt, {
            sessionId: created.sessionId,
            prompt: [
              {
                type: "text",
                text: `Worktree: ${worktreePath}. Read counter.ts, then write counter.ts with exactly: export const count = 3;`,
              },
            ],
          })
          .catch(() => undefined); // the run may end, be denied, or be cancelled — never replayed
      });
    const persisted = acpStore.entries.get(sessionId)?.activeRun;
    assert.ok(persisted, "active-run ref must be persisted for the run");
    const recovery = createAcpRunRecovery({
      checkpoints: pg.checkpoints,
      leases: pg.leases,
      ownerId: "replica-a",
      lifecycle: lifecycleApi,
    });
    const ref = {
      runId: persisted.runId,
      sessionId,
      status: persisted.status,
      ...(persisted.version !== undefined ? { version: persisted.version } : {}),
      updatedAt: persisted.updatedAt,
    };
    const cancelled = await recovery.cancel(ref, { ownership, expectedVersion: persisted.version });
    assert.equal(cancelled.cancelled, true, "durable cancel must succeed");
    const status = await recovery.status(ref, { ownership });
    assert.equal(status.status, "cancelled", `expected cancelled, got ${status.status}`);
    const again = await recovery.cancel(ref, { ownership, expectedVersion: persisted.version });
    assert.equal(again.cancelled, true, "cancellation must be terminal-idempotent (same outcome, one marker)");
    const marker = await pg.checkpoints.loadCheckpoint({
      namespace: ACP_RUN_CANCEL_NAMESPACE,
      key: persisted.runId,
      ...ownership,
    });
    assert.ok(marker, "cancel marker must exist in durable checkpoints");
    const edited = readFileSync(join(worktreePath, "counter.ts"), "utf8");
    assert.ok(!edited.includes("count = 3"), "cancelled run must never have replayed its write");
    ids.cancelRun = persisted.runId;
    return { runId: persisted.runId };
  });

  // ---------------------------------------------------------------- forge
  await leg("forge", async () => {
    forge = createGitHubForge({
      credentials: {
        name: "gh-journey",
        resolver: {
          resolve: async () => ({ type: "bearer", value: forgeToken }),
        },
      },
      repository: forgeRepository,
      cwd: repoRoot,
      git: gitOps,
      effectStore: createMemoryToolEffectStore(),
      identity,
      ownership,
      sessionId: `s-forge-${suffix}`,
      runId: `r-forge-${suffix}`,
    });
    const pushed = await forge.push({ refspec: `refs/heads/${branch}` });
    assert.ok(pushed.remoteRef, "push must report the remote ref");
    const pr = await forge.createPullRequest({
      title: `prism journey ${suffix}`,
      body: `Protected coding journey run ${suffix}`,
      head: branch,
      base: "main",
    });
    prNumber = pr.number;
    const replay = await forge.createPullRequest({
      title: `prism journey ${suffix}`,
      body: `Protected coding journey run ${suffix}`,
      head: branch,
      base: "main",
    });
    assert.equal(replay.number, prNumber, "PR creation must be lookup-before-create idempotent");
    const checks = await forge.checks({ number: prNumber });
    assert.ok(Array.isArray(checks), "check reads must return a list");
    const reconciled = await forge.reconcileHandoff({ base: "main", head: branch });
    assert.ok(reconciled, "handoff reconciliation must complete");
    ids.prNumber = prNumber;
    ids.prUrl = pr.url;
    return { prNumber };
  });

  // ---------------------------------------------------------------- browser
  await leg("browser", async () => {
    assert.equal(env.PRISM_LIVE_PLAYWRIGHT, "1", "PRISM_LIVE_PLAYWRIGHT=1 required for the browser leg");
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
    const pageText = `prism journey page ${suffix}`;
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body><h1 id="t">${pageText}</h1></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    browserManager = createBrowserManager({
      browser,
      networkPolicy: { allowLoopback: true, requireContainedProxy: false },
    });
    const registry = createToolRegistry(createBrowserTools({ manager: browserManager }));
    const ctx = {
      sessionId: "s-browser",
      runId: "r-browser",
      toolCallId: "b1",
      signal: new AbortController().signal,
      metadata: {},
    };
    const opened = await dispatchToolCall({
      call: { id: "b1", name: "browser_open", arguments: { url } },
      registry,
      context: ctx,
      identity,
      redactor,
    });
    assert.match(JSON.stringify(opened), /ok|opened/i);
    // The snapshot may race the first paint; poll briefly for the page text.
    let snapshotted = null;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      snapshotted = await dispatchToolCall({
        call: { id: "b2", name: "browser_snapshot", arguments: {} },
        registry,
        context: { ...ctx, toolCallId: "b2" },
        identity,
        redactor,
      });
      if (JSON.stringify(snapshotted).includes(pageText)) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(
      JSON.stringify(snapshotted).includes(pageText),
      `browser snapshot must contain the fixture page text: ${JSON.stringify(snapshotted).slice(0, 300)}`,
    );
    await dispatchToolCall({
      call: { id: "b3", name: "browser_close", arguments: {} },
      registry,
      context: { ...ctx, toolCallId: "b3" },
      identity,
      redactor,
    });
    await new Promise((resolve) => server.close(() => resolve()));
    await browser.close();
    ids.browserUrl = url.replace(`:${address.port}`, ":<port>");
    return { page: ids.browserUrl };
  });

  // ---------------------------------------------------------------- pty (frozen profile)
  if (!env.PRISM_TEST_PTY_BACKEND) {
    console.log("PROTECTED JOURNEY leg pty skipped (no PRISM_TEST_PTY_BACKEND in the frozen profile)");
  } else {
    await leg("pty", async () => {
      const backendModule = await import(pathToFileURL(env.PRISM_TEST_PTY_BACKEND).href);
      const ptyBackend = backendModule.createPtyBackend();
      assert.ok(ptyBackend && typeof ptyBackend.startPty === "function", "PTY backend must expose startPty");
      ptySessions = createProcessSessions({ cwd: repoRoot, ownership, ptyBackend });
      const p = await ptySessions.start({
        command: "sh",
        args: [],
        pty: true,
        terminal: { columns: 80, rows: 24 },
      });
      let saw = "";
      let cursor = 0;
      await p.input(Buffer.from("echo PRISM_PTY_OK\n"));
      for (let i = 0; i < 100; i += 1) {
        const chunk = await p.output({ cursor, maxBytes: 64 });
        saw += chunk.data;
        cursor = chunk.cursor;
        if (saw.includes("PRISM_PTY_OK")) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(saw.includes("PRISM_PTY_OK"), `PTY echo missing: ${saw.slice(0, 200)}`);
      await p.kill();
      const exit = await p.wait({ timeoutMs: 10_000 });
      assert.ok(exit.state === "killed" || exit.state === "exited", `unexpected PTY terminal state ${exit.state}`);
      ids.pty = "ok";
      return { pty: "ok" };
    });
  }

  const wallMs = Date.now() - startedAt;
  console.log(`PROTECTED JOURNEY wall ${wallMs}ms blocked=${blocked}`);
} catch (error) {
  blocked = true;
  blockReason = error instanceof Error ? error.message : String(error);
  console.error(`PROTECTED JOURNEY failed: ${blockReason}`);
} finally {
  // ---------------------------------------------------------------- cleanup
  const cleanupStartedAt = Date.now();
  if (forge && prNumber) {
    await cleanup("forge-pr", async () => {
      await forge.updatePullRequest({ number: prNumber, state: "closed" });
    });
  }
  if (forge) {
    await cleanup("forge-branch", async () => {
      git(repoRoot, ["push", "origin", "--delete", branch]);
    });
  }
  if (lifecycle && workspaceTaskId) {
    await cleanup("worktree", async () => {
      await lifecycle.cleanup({ taskId: workspaceTaskId, ownership });
    });
  }
  if (replicaA) await cleanup("process-replica-a", async () => replicaA.dispose());
  if (replicaB) await cleanup("process-replica-b", async () => replicaB.dispose());
  if (ptySessions) await cleanup("pty-sessions", async () => ptySessions.dispose());
  if (sandbox) await cleanup("docker-sandbox", async () => sandbox.close());
  if (browserManager) await cleanup("browser-manager", async () => browserManager.close());
  if (pg) {
    await cleanup("postgres", async () => pg.close());
  }
  await cleanup("workspace-files", async () => {
    rmSync(ws, { recursive: true, force: true });
  });
  const cleanupMs = Date.now() - cleanupStartedAt;

  // ---------------------------------------------------------------- report
  const release = JSON.parse(readFileSync(join(import.meta.dirname, "node_modules", "@arnilo", "prism", "package.json"), "utf8")).version;
  const gate = {
    envs: [
      "PRISM_CODING_JOURNEY",
      "PRISM_TEST_POSTGRES_URL",
      "PRISM_TEST_DOCKER_BIN",
      "PRISM_TEST_DOCKER_IMAGE",
      "PRISM_LIVE_PLAYWRIGHT",
      "PRISM_CODING_FORGE_REPOSITORY",
      "PRISM_CODING_FORGE_TOKEN",
      "PRISM_CODING_PROVIDER",
      ...(env.PRISM_TEST_PTY_BACKEND ? ["PRISM_TEST_PTY_BACKEND"] : []),
    ],
  };
  const report = {
    $comment:
      "Protected coding journey report (plan 026 Task 7). state: not_run (no real run recorded) | pass | blocked — the release-evidence surface is pass only for state pass; blocked/partial reports block release evidence; not_run and missing reports are documented protected gaps. Evidence carries timings, states, and ids/hashes only.",
    release,
    generatedAt: new Date().toISOString(),
    suffix,
    wallMs,
    cleanupMs,
    blocked,
    ...(blockReason ? { blockReason } : {}),
    journey: {
      state: blocked ? "blocked" : "pass",
      legs,
    },
    cleanups,
    gate,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const leaked = [];
  const captured = `${JSON.stringify(report)}\n${legs.map((l) => l.error ?? "").join("\n")}`;
  for (const secret of secrets.filter(Boolean)) {
    if (secret.length >= 8 && captured.includes(secret)) leaked.push("<credential>");
  }
  if (leaked.length > 0) {
    blocked = true;
    console.error("PROTECTED JOURNEY leak scan failed: a credential value appears in the report or leg errors");
  }
  console.log(
    blocked
      ? `PROTECTED CODING JOURNEY BLOCKED (${blockReason ?? "unknown"})`
      : `PROTECTED CODING JOURNEY OK in ${wallMs}ms (${legs.length} legs, cleanup ${cleanupMs}ms)`,
  );
  process.exit(blocked ? 1 : 0);
}
