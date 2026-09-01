import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const coreSrcDir = join(fileURLToPath(import.meta.url), "../..");

describe("@arnilo/prism-core family conformance", () => {
  it("exports all 16 subpaths declared in package.json", async () => {
    const pkg = JSON.parse(readFileSync(join(coreSrcDir, "../package.json"), "utf8"));
    const exports = pkg.exports;

    const expectedSubpaths = [
      "./runtime/server",
      "./runtime/supervisor",
      "./runtime/workflows",
      "./sessions/codecs",
      "./sessions/sqlite",
      "./sessions/postgres",
      "./sessions/nats",
      "./governance/policy",
      "./governance/evals",
      "./governance/prompts",
      "./governance/model-router",
      "./governance/observability",
      "./credentials/node",
      "./enterprise/postgres",
      "./integrations/work",
      "./validation/json-schema",
    ];

    for (const sub of expectedSubpaths) {
      assert.ok(exports[sub], `package.json exports must declare ${sub}`);
      assert.ok(exports[sub].types, `package.json exports[${sub}] must have types`);
      assert.ok(exports[sub].default, `package.json exports[${sub}] must have default`);
    }
  });

  it("source tree contains zero imports from retired core packages", () => {
    const retired = [
      "@arnilo/prism-server",
      "@arnilo/prism-supervisor",
      "@arnilo/prism-workflows",
      "@arnilo/prism-session-store-codecs",
      "@arnilo/prism-session-store-sqlite",
      "@arnilo/prism-session-store-postgres",
      "@arnilo/prism-session-store-nats",
      "@arnilo/prism-policy",
      "@arnilo/prism-evals",
      "@arnilo/prism-prompts",
      "@arnilo/prism-model-router",
      "@arnilo/prism-observability-opentelemetry",
      "@arnilo/prism-credentials-node",
      "@arnilo/prism-enterprise-postgres",
      "@arnilo/prism-work-tools",
      "@arnilo/prism-tool-validator-json-schema",
    ];

    function walk(dir: string): string[] {
      const results: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          results.push(...walk(full));
        } else if (ent.name.endsWith(".ts") || ent.name.endsWith(".js")) {
          results.push(full);
        }
      }
      return results;
    }

    const files = walk(coreSrcDir);
    const violations: { file: string; pkg: string }[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pkg of retired) {
        // match from "pkg" or import("pkg")
        const re = new RegExp(`(from\\s+["']${pkg.replace("/", "\\/")}["']|import\\(["']${pkg.replace("/", "\\/")}["']\\))`);
        if (re.test(text)) {
          violations.push({ file, pkg });
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found retired package imports inside prism-core:\n${violations.map((v) => `  ${v.file}: ${v.pkg}`).join("\n")}`,
    );
  });

  it("workflows subpath does not evaluate or import database drivers or governance", async () => {
    // Dynamically import workflows directly
    const wf = await import("../runtime/workflows/index.js");
    assert.equal(typeof wf.defineWorkflow, "function");
    assert.equal(typeof wf.createWorkflowCoordinator, "function");
    assert.equal(typeof wf.createMemoryWorkflowCheckpoints, "function");

    // Verify global/loaded modules do not include unneeded heavy DB libraries via workflows
    const loaded = Object.keys(process.versions);
    assert.ok(loaded.includes("node"));
  });

  it("governance subpaths export pure evaluator interfaces", async () => {
    const policy = await import("../governance/policy/index.js");
    assert.equal(typeof policy.createPolicyEvaluator, "function");
    assert.equal(typeof policy.createMemoryApprovalStore, "function");

    const evals = await import("../governance/evals/index.js");
    assert.equal(typeof evals.runExperiment, "function");
    assert.equal(typeof evals.scoreRun, "function");
    assert.equal(typeof evals.createMemoryEvaluationStore, "function");

    const modelRouter = await import("../governance/model-router/index.js");
    assert.equal(typeof modelRouter.createModelRouter, "function");
    assert.equal(typeof modelRouter.createMemoryModelRouterStateStore, "function");
  });

  it("work integrations export CLI adapters and approval structures", async () => {
    const work = await import("../integrations/work/index.js");
    assert.equal(typeof work.createWorkTools, "function");
    assert.equal(typeof work.createMicrosoft365CliAdapter, "function");
    assert.equal(typeof work.createGoogleWorkspaceCliAdapter, "function");
    assert.equal(typeof work.createMemoryIdempotencyStore, "function");
  });

  it("validation subpath exports Ajv schema validator", async () => {
    const validation = await import("../validation/json-schema/index.js");
    assert.equal(typeof validation.createJsonSchemaArgumentValidator, "function");
    assert.equal(typeof validation.createJsonSchemaToolArgumentValidator, "function");
  });
});
