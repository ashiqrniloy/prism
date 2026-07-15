import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import type { ExecutionAction } from "@arnilo/prism";
import { createCodingApprovalPolicy } from "../approval.js";
import { assertPathInsideRoots } from "../path-containment.js";
import { evaluateCommandRules, hasShellMetacharacters } from "../command-rules.js";
import { createSandboxBashOperations, SandboxExecutionError } from "../sandbox.js";

test("path outside roots is denied", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-root-"));
  try {
    const policy = createCodingApprovalPolicy({ roots: [root] });
    const outside = join(tmpdir(), "outside-" + Date.now());
    const decision = await policy.check({
      kind: "read",
      operation: "read",
      paths: [outside],
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /outside trusted roots/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlink escape under root is denied", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "coding-sec-out-"));
  try {
    const link = join(root, "escape");
    await symlink(outside, link);
    const target = join(link, "secret.txt");
    await writeFile(join(outside, "secret.txt"), "nope");

    const policy = createCodingApprovalPolicy({ roots: [root] });
    const decision = await policy.check({
      kind: "read",
      operation: "read",
      paths: [target],
    });
    assert.equal(decision.allowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("shell requires approval by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-shell-"));
  try {
    const policy = createCodingApprovalPolicy({ roots: [root] });
    const decision = await policy.check({
      kind: "shell",
      operation: "execute",
      command: "echo hi",
      paths: [root],
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /approval required/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval denial and cache reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-approve-"));
  let calls = 0;
  try {
    const policy = createCodingApprovalPolicy({
      roots: [root],
      approve: () => {
        calls++;
        return false;
      },
      approvalCacheScope: "run",
    });
    const action: ExecutionAction = {
      kind: "write",
      operation: "write",
      paths: [join(root, "a.txt")],
    };
    const first = await policy.check(action);
    const second = await policy.check(action);
    assert.equal(first.allowed, false);
    assert.equal(second.allowed, false);
    assert.equal(calls, 1, "approval should be cached after first denial");
    assert.match(second.reason ?? "", /cached/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval timeout is abortable", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-timeout-"));
  const controller = new AbortController();
  try {
    const policy = createCodingApprovalPolicy({
      roots: [root],
      approvalTimeoutMs: 5_000,
      approve: async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return !signal?.aborted;
      },
    });
    const action: ExecutionAction = {
      kind: "write",
      operation: "write",
      paths: [join(root, "a.txt")],
      metadata: { signal: controller.signal },
    };
    setTimeout(() => controller.abort(), 20);
    const decision = await policy.check(action);
    assert.equal(decision.allowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read-only mode blocks writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-ro-"));
  try {
    const policy = createCodingApprovalPolicy({
      roots: [root],
      readOnly: true,
      approve: () => true,
    });
    const decision = await policy.check({
      kind: "write",
      operation: "write",
      paths: [join(root, "a.txt")],
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /read-only/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default deny patterns block escalation commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-deny-"));
  try {
    const policy = createCodingApprovalPolicy({
      roots: [root],
      approve: () => true,
    });
    const decision = await policy.check({
      kind: "shell",
      operation: "execute",
      command: "sudo rm -rf /",
      paths: [root],
    });
    assert.equal(decision.allowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("metacharacters require approval", () => {
  assert.equal(hasShellMetacharacters("echo a; echo b"), true);
  const evaluation = evaluateCommandRules("echo a; echo b", []);
  assert.equal(evaluation.action, "requireApproval");
});

test("sandbox adapter errors are wrapped", async () => {
  const ops = createSandboxBashOperations({
    exec: async () => {
      throw new Error("sandbox down");
    },
  });
  await assert.rejects(
    () => ops.exec("echo hi", process.cwd(), { onData: () => {} }),
    SandboxExecutionError,
  );
});

test("path containment helper accepts in-root targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "coding-sec-in-"));
  try {
    const file = join(root, "ok.txt");
    await writeFile(file, "ok");
    assert.equal(await assertPathInsideRoots([realpathSync(root)], file), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
