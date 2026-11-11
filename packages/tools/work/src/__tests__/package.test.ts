import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, type JsonObject } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import toolsWork, { createOfficeTools } from "../index.js";
import { closeWorkerPool, runInPool, workerPoolStats } from "../runtime/worker-pool.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const ROOT = tmpdir();
const M365_ENV = "PRISM_TEST_WORK_M365_TOKEN";
const MISTRAL_ENV = "PRISM_TEST_WORK_MISTRAL_KEY";

afterEach(() => {
  delete process.env[M365_ENV];
  delete process.env[MISTRAL_ENV];
});

/** An `AgentIdentity` as JSON, for a connector config. */
function identityJson(): JsonObject {
  return {
    tenantId: "tenant-test",
    principal: { kind: "service", id: "svc-test" },
    scopes: ["work.read"],
    issuedAt: new Date(Date.now() - 1000).toISOString(),
  };
}

describe("@arnilo/prism-tools/work package", () => {
  it("tools_work_package_conformance", async () => {
    const result = await packageConformance(toolsWork({ root: ROOT }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("tools_work_groups_by_config", async () => {
    const withOffice = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWork({ root: ROOT })],
    });
    try {
      assert.ok(
        withOffice.tools.some((tool) => tool.name === "office_parse"),
        "the office group registers by default",
      );
    } finally {
      await withOffice.dispose();
    }

    const withoutOffice = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWork({ root: ROOT, office: { enabled: false } })],
    });
    try {
      assert.equal(
        withoutOffice.tools.some((tool) => tool.name.startsWith("office_")),
        false,
        "office: { enabled: false } registers no office tool",
      );
    } finally {
      await withoutOffice.dispose();
    }

    // The 0.12 factory still builds the group for hosts that assemble their own list.
    assert.deepEqual(
      createOfficeTools({ filesystem: { root: ROOT, readFile: async () => new Uint8Array(), writeFile: async () => {} } }).map(
        (tool) => tool.name,
      ),
      ["office_parse", "office_import", "office_generate", "office_patch", "office_diff", "office_preview"],
    );
  });

  it("tools_work_missing_parser_drops_formats_with_note", () => {
    // `mock.module` leaks to every later file in the same Bun process, so the mocked-`pdf-parse`
    // leg runs in a subprocess through the `.fixture.ts` probe instead.
    const fixture = join(REPO_ROOT, "packages/tools/work/src/__tests__/missing-parser.fixture.ts");
    const result = spawnSync("bun", ["test", fixture], { cwd: join(REPO_ROOT, "packages/tools/work"), encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  it("tools_work_connector_without_credential_notes", async () => {
    delete process.env[M365_ENV];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        toolsWork({
          root: ROOT,
          connectors: {
            microsoft365: { credential: `env:${M365_ENV}`, binary: process.execPath, configDir: ROOT, identity: identityJson() },
          },
        }),
      ],
    });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name.startsWith("m365_")),
        false,
        "an unresolved credential registers no connector tool",
      );
      assert.ok(
        agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message.includes("microsoft365")),
        "the unresolved credential is noted",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("tools_work_secrets_never_echoed", async () => {
    const m365Sentinel = "prism-work-m365-canary-7a31";
    const ocrSentinel = "prism-work-ocr-canary-9c02";
    process.env[M365_ENV] = m365Sentinel;
    process.env[MISTRAL_ENV] = ocrSentinel;

    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        toolsWork({
          root: ROOT,
          connectors: {
            microsoft365: { credential: `env:${M365_ENV}`, binary: process.execPath, configDir: ROOT, identity: identityJson() },
          },
          reader: { ocr: { provider: "mistral", apiKey: `env:${MISTRAL_ENV}` } },
        }),
      ],
    });
    try {
      const dump = JSON.stringify(agent.inspect());
      assert.equal(dump.includes(m365Sentinel), false, "the connector token never surfaces in inspect()");
      assert.equal(dump.includes(ocrSentinel), false, "the OCR key never surfaces in inspect()");
      // The connector registered (the credential resolved), so the test is not vacuous.
      assert.ok(agent.tools.some((tool) => tool.name.startsWith("m365_")));
    } finally {
      await agent.dispose();
    }
  });

  it("office_parsers_not_loaded_unless_tools_work_listed", async () => {
    const script = [
      'const coding = await import("@arnilo/prism-tools/coding");',
      'const web = await import("@arnilo/prism-tools/web");',
      'const approval = await import("@arnilo/prism-extensions/approval");',
      'const { createAgent } = await import("@arnilo/prism");',
      "const seen = (needle) => Object.keys(require.cache ?? {}).some((key) => key.includes(needle));",
      'const heavy = () => ({ office: seen("@office-open"), mammoth: seen("mammoth"), pdf: seen("pdf-parse"), anydoc: seen("@firecrawl/anydoc") });',
      'const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [',
      "  coding.default({ root: process.cwd() }),",
      '  web.default({ backend: "brave", apiKey: "env:PRISM_TEST_WEB_KEY" }),',
      '  approval.approvalPackage({ mode: "auto" }),',
      "]});",
      "await agent.dispose();",
      "const before = heavy();",
      'const work = await import("@arnilo/prism-tools/work");',
      'const withWork = await createAgent({ model: { provider: "mock", model: "m" }, packages: [work.default({ root: process.cwd() })] });',
      'const office = work.createOfficeTools().find((tool) => tool.name === "office_preview");',
      'await office.execute({ model: { kind: "doc", modelVersion: 1, blocks: [] } }, { toolCallId: "probe", signal: new AbortController().signal });',
      "await withWork.dispose();",
      "console.log(JSON.stringify({ before, after: heavy() }));",
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as {
      before: Record<string, boolean>;
      after: Record<string, boolean>;
    };
    assert.deepEqual(
      probe.before,
      { office: false, mammoth: false, pdf: false, anydoc: false },
      "an agent without tools-work loads no office parser",
    );
    assert.equal(probe.after.office, true, "the probe is meaningful: executing an Office tool loads @office-open");
  });

  it("tools_work_disposes_worker_pool", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWork({ root: ROOT })],
    });
    try {
      await runInPool({ kind: "probe.echo", payload: "spawn" });
      assert.ok(workerPoolStats().workers > 0, "a worker is alive before dispose");
    } finally {
      await agent.dispose();
    }
    assert.equal(workerPoolStats().workers, 0, "onDispose closes the worker pool");
    await closeWorkerPool();
  });
});
