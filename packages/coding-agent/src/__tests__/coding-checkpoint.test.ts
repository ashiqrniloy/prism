import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CODING_CHECKPOINT_SCHEMA_VERSION,
  CODING_STATE_KEY,
  CodingCheckpointError,
  assertCodingResumeAllowed,
  buildCodingCheckpointMetadata,
  codingCheckpointStatePatch,
  codingPlanPathForTask,
  createCodingArtifactRef,
  createCodingPlanMarkdown,
  fingerprintJson,
  parseCodingPlanTodos,
  readCodingCheckpointFromState,
  readCodingPlanFile,
  resolveCodingCheckpointLimits,
  validateCodingCheckpointMetadata,
  verifyCodingArtifactBytes,
  writeCodingPlanFile,
  type CodingFingerprints,
} from "../coding-checkpoint.js";
import { HARD_MAX_PLAN_BYTES } from "../limits.js";

const FP = fingerprintJson({ tools: ["repo_list", "git_status"], policy: "deny-shell" });
const POLICY = fingerprintJson({ deny: ["shell"] });

function baseFingerprints(overrides?: Partial<CodingFingerprints>): CodingFingerprints {
  return {
    workflowRevision: "1",
    definitionHash: fingerprintJson({ id: "coding-task" }),
    toolFingerprint: FP,
    policyFingerprint: POLICY,
    ...overrides,
  };
}

describe("coding checkpoint limits", () => {
  it("resolves defaults and rejects overflow", () => {
    const limits = resolveCodingCheckpointLimits();
    assert.equal(limits.maxPlanBytes, 256 * 1024);
    assert.equal(limits.maxTodos, 1_000);
    assert.throws(
      () => resolveCodingCheckpointLimits({ maxPlanBytes: HARD_MAX_PLAN_BYTES + 1 }),
      /maxPlanBytes/,
    );
  });
});

describe("coding plan markdown", () => {
  it("creates, parses, and bounds todos", () => {
    const markdown = createCodingPlanMarkdown({
      title: "Fix parser",
      taskId: "task-1",
      todos: [
        { id: "edit", text: "Edit src/parser.ts", done: false },
        { id: "check", text: "Run typecheck", done: true },
      ],
      notes: "Keep shell as escape hatch only.",
    });
    assert.match(markdown, /# Fix parser/);
    const todos = parseCodingPlanTodos(markdown);
    assert.deepEqual(todos, [
      { id: "edit", text: "Edit src/parser.ts", done: false },
      { id: "check", text: "Run typecheck", done: true },
    ]);
    assert.throws(
      () =>
        createCodingPlanMarkdown({
          title: "Too many",
          taskId: "task-2",
          todos: Array.from({ length: 3 }, (_, i) => ({ text: `t${i}` })),
          limits: { maxTodos: 2 },
        }),
      (error: unknown) => error instanceof CodingCheckpointError,
    );
  });

  it("writes and verifies plan files under the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-coding-plan-"));
    try {
      const planPath = codingPlanPathForTask("task-1");
      const markdown = createCodingPlanMarkdown({
        title: "Durable plan",
        taskId: "task-1",
        todos: [{ id: "a", text: "Write plan" }],
      });
      const artifact = await writeCodingPlanFile({ workspaceRoot: root, planPath, markdown });
      assert.equal(artifact.kind, "plan");
      assert.match(artifact.uri, /^file:\/\//);
      const loaded = await readCodingPlanFile({
        workspaceRoot: root,
        planPath,
        expected: artifact,
      });
      assert.equal(loaded.todos.length, 1);
      assert.equal(loaded.artifact.sha256, artifact.sha256);

      await assert.rejects(
        () =>
          writeCodingPlanFile({
            workspaceRoot: root,
            planPath: "../escape.md",
            markdown,
          }),
        /relative path/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("coding checkpoint metadata", () => {
  it("builds and validates metadata without credentials or raw output", async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-coding-meta-"));
    try {
      const planPath = "plans/task-1.md";
      const markdown = createCodingPlanMarkdown({
        title: "Meta",
        taskId: "task-1",
        todos: [{ id: "one", text: "One" }],
      });
      const plan = await writeCodingPlanFile({ workspaceRoot: root, planPath, markdown });
      const metadata = buildCodingCheckpointMetadata({
        taskId: "task-1",
        workspaceRoot: root,
        baseBranch: "main",
        branch: "codex/task-1",
        planPath,
        plan,
        fingerprints: baseFingerprints(),
        todos: parseCodingPlanTodos(markdown),
        checks: [{ name: "typecheck", exitCode: 0, summary: "ok" }],
        status: "checking",
      });
      assert.equal(metadata.schemaVersion, CODING_CHECKPOINT_SCHEMA_VERSION);
      assert.equal(metadata.plan.sha256, plan.sha256);

      const patch = codingCheckpointStatePatch(metadata);
      assert.ok(CODING_STATE_KEY in patch);
      assert.deepEqual(readCodingCheckpointFromState(patch), metadata);

      assert.throws(
        () =>
          validateCodingCheckpointMetadata({
            ...metadata,
            secrets: { token: "leak" },
          }),
        /Forbidden coding checkpoint field/,
      );
      assert.throws(
        () =>
          validateCodingCheckpointMetadata({
            ...metadata,
            commandOutput: "raw",
          }),
        /Forbidden/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("verifies artifacts and rejects fingerprint / hash mismatches on resume", async () => {
    const bytes = Buffer.from("workspace-export", "utf8");
    const artifact = createCodingArtifactRef({
      kind: "workspace",
      uri: "file:///tmp/export.tar",
      bytes,
    });
    verifyCodingArtifactBytes(artifact, bytes);
    assert.throws(
      () => verifyCodingArtifactBytes(artifact, Buffer.from("tampered", "utf8")),
      /SHA-256 mismatch|byte count/,
    );

    const root = "/tmp/workspace-root";
    const planBytes = Buffer.from("# plan\n", "utf8");
    const plan = createCodingArtifactRef({
      kind: "plan",
      uri: "file:///tmp/workspace-root/plans/task-1.md",
      bytes: planBytes,
      maxBytes: 1024,
    });
    const metadata = buildCodingCheckpointMetadata({
      taskId: "task-1",
      workspaceRoot: root,
      baseBranch: "main",
      branch: "feature",
      planPath: "plans/task-1.md",
      plan,
      fingerprints: baseFingerprints({ imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      workspaceExport: artifact,
      todos: [],
    });

    assertCodingResumeAllowed({
      metadata,
      expected: baseFingerprints({
        imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      expectedWorkspaceRoot: root,
      expectedBaseBranch: "main",
      planBytes,
      workspaceExportBytes: bytes,
    });

    assert.throws(
      () =>
        assertCodingResumeAllowed({
          metadata,
          expected: baseFingerprints({
            imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            toolFingerprint: fingerprintJson({ changed: true }),
          }),
          planBytes,
        }),
      /Tool fingerprint mismatch/,
    );

    assert.throws(
      () =>
        assertCodingResumeAllowed({
          metadata,
          expected: baseFingerprints({
            imageDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          }),
          planBytes,
        }),
      /Image digest mismatch/,
    );
  });

  it("rejects foreign workspace roots and mutated plan bytes", () => {
    const planBytes = Buffer.from("# plan\n- [ ] a\n", "utf8");
    const plan = createCodingArtifactRef({
      kind: "plan",
      uri: "file:///srv/task/plans/a.md",
      bytes: planBytes,
      maxBytes: 4096,
    });
    const metadata = buildCodingCheckpointMetadata({
      taskId: "task-9",
      workspaceRoot: "/srv/task",
      baseBranch: "main",
      branch: "wip",
      planPath: "plans/a.md",
      plan,
      fingerprints: baseFingerprints(),
    });
    assert.throws(
      () =>
        assertCodingResumeAllowed({
          metadata,
          expected: baseFingerprints(),
          expectedWorkspaceRoot: "/srv/other",
          planBytes,
        }),
      /Workspace root mismatch/,
    );
    assert.throws(
      () =>
        assertCodingResumeAllowed({
          metadata,
          expected: baseFingerprints(),
          planBytes: Buffer.from("# mutated\n", "utf8"),
        }),
      /mismatch/i,
    );
  });
});

describe("fingerprintJson", () => {
  it("is order-independent for object keys", () => {
    assert.equal(fingerprintJson({ a: 1, b: 2 }), fingerprintJson({ b: 2, a: 1 }));
    assert.notEqual(fingerprintJson({ a: 1 }), fingerprintJson({ a: 2 }));
  });
});
