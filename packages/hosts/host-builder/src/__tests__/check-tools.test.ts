import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashPackageClosure, installedPackageDir, scopeDirs, writeManifest } from "@arnilo/prism/manifest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { HostBuilderError } from "../errors.js";
import { createHostBuilderMcpServer, type HostBuilderMcpOptions } from "../server.js";
import { checkRoot, cleanup, INSPECTION_AGENT, tempDir, write } from "./fixture.js";

afterEach(cleanup);

const BIN = join(import.meta.dirname, "../../bin/prism-host-builder.ts");

async function call(options: HostBuilderMcpOptions, name: string, args: Record<string, unknown> = {}) {
  const server = createHostBuilderMcpServer(options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text: string }>).map((part) => part.text).join("");
    return { raw: text, json: JSON.parse(text) as Record<string, any>, isError: result.isError === true };
  } finally {
    await client.close();
    await server.close();
  }
}

const PACKAGE = `import { definePackage } from "@arnilo/prism";
export default definePackage({
  name: "@acme/good",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.status.note("info", "ready");
  },
});
`;

describe("host-builder check tools", () => {
  it("inspect_host_returns_inspection", async () => {
    const root = checkRoot();
    write(root, "src/agent.ts", INSPECTION_AGENT);
    const { json } = await call({ root, entries: ["src/agent.ts#createInspectionAgent"] }, "prism_inspect_host", {
      entry: "src/agent.ts#createInspectionAgent",
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.timedOut, false);
    assert.ok(json.result.packages.some((pkg: { name: string }) => pkg.name.includes("mock")));
    for (const key of ["tools", "skills", "hooks", "slots"]) assert.ok(key in json.result, key);
  });

  it("inspect_host_secret_never_in_result", async () => {
    const root = checkRoot();
    const secret = "planted-secret-value-98765";
    write(
      root,
      "src/agent.ts",
      `import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
const labeled = definePackage<{ label: string }>({
  name: "@acme/labeled",
  version: "1.0.0",
  requires: { api: 1 },
  config: { type: "object", properties: { label: { type: "string" } } },
  setup() {},
});
export async function createInspectionAgent() {
  return createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider(), labeled({ label: process.env.HOST_SECRET })] });
}
`,
    );
    process.env.HOST_SECRET = secret;
    try {
      const { raw, json } = await call(
        { root, entries: ["src/agent.ts#createInspectionAgent"], passEnv: ["HOST_SECRET"] },
        "prism_inspect_host",
        { entry: "src/agent.ts#createInspectionAgent" },
      );
      assert.equal(json.ok, true, raw);
      assert.ok(!raw.includes(secret), "the planted secret must not reach the result");
      assert.ok(raw.includes("[REDACTED]") || raw.includes("REDACTED"), raw);
    } finally {
      delete process.env.HOST_SECRET;
    }
  });

  it("entry_outside_root_refused_at_start", () => {
    const root = checkRoot();
    const outside = tempDir("host-builder-outside-");
    writeFileSync(join(outside, "agent.ts"), INSPECTION_AGENT);
    mkdirSync(join(root, "src"), { recursive: true });
    symlinkSync(join(outside, "agent.ts"), join(root, "src/linked.ts"));
    for (const spec of [
      `${join(outside, "agent.ts")}#createInspectionAgent`,
      "../escape.ts#x",
      "src/linked.ts#createInspectionAgent",
      "missing.ts#x",
      "#x",
    ]) {
      assert.throws(
        () => createHostBuilderMcpServer({ root, entries: [spec] }),
        (error) => error instanceof HostBuilderError && error.code === "ERR_PRISM_HOST_BUILDER_ENTRY",
        spec,
      );
    }
    assert.throws(
      () => createHostBuilderMcpServer({ root, packages: ["../escape.ts#x"] }),
      /ERR_PRISM_HOST_BUILDER_ENTRY|resolves outside|does not exist/,
    );
    const run = spawnSync(process.execPath, [BIN, "mcp", "--root", root, "--entry", "src/linked.ts#createInspectionAgent"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ERR_PRISM_HOST_BUILDER_ENTRY/);
  });

  it("entry_not_configured_returns_guidance", async () => {
    const root = checkRoot();
    write(root, "src/agent.ts", INSPECTION_AGENT);
    const none = await call({ root }, "prism_inspect_host", { entry: "src/agent.ts#createInspectionAgent" });
    assert.equal(none.isError, false);
    assert.match(none.json.guidance, /--entry <file>#<export>/);
    const pkg = await call({ root }, "prism_check_package", { package: "src/p.ts#default" });
    assert.match(pkg.json.guidance, /--package <file>#<export>/);
    // A configured server still never runs a path that was not configured.
    const other = await call({ root, entries: ["src/agent.ts#createInspectionAgent"] }, "prism_inspect_host", { entry: "src/other.ts#x" });
    assert.equal(other.json.ok, false);
    assert.deepEqual(other.json.configured, ["src/agent.ts#createInspectionAgent"]);
  });

  it("check_model_call_fails: a factory that runs a session is refused", async () => {
    const root = checkRoot();
    write(
      root,
      "src/agent.ts",
      `import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
const provider = { id: "stub", async *generate() { yield providerTextDelta("hello"); yield providerDone(); } };
export async function createInspectionAgent() {
  const agent = await createAgent({ model: { provider: "stub", model: "m" }, packages: [providerPackage("stub-provider", [provider])] });
  await (await agent.session()).run("hi");
  return agent;
}
export async function fetchesOut() {
  await fetch("https://api.example.invalid/v1/chat?key=abc");
  return createInspectionAgent();
}
`,
    );
    const options = { root, entries: ["src/agent.ts#createInspectionAgent", "src/agent.ts#fetchesOut"] };
    const ran = await call(options, "prism_inspect_host", { entry: "src/agent.ts#createInspectionAgent" });
    assert.equal(ran.json.ok, false, ran.raw);
    assert.equal(ran.json.error.code, "ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL");
    const fetched = await call(options, "prism_inspect_host", { entry: "src/agent.ts#fetchesOut" });
    assert.equal(fetched.json.ok, false);
    assert.equal(
      fetched.json.error.code === "ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL" || /refused/.test(fetched.json.error.message),
      true,
      fetched.raw,
    );
    assert.ok(!fetched.raw.includes("key=abc"));
  });

  it("check_package_reports_conformance_failures", async () => {
    const root = checkRoot();
    write(root, "src/good.ts", PACKAGE);
    write(
      root,
      "src/bad.ts",
      `import { definePackage } from "@arnilo/prism";
export default definePackage({
  name: "@acme/bad",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    void prism.credentials.resolve("env:ANYTHING").catch(() => undefined);
  },
});
`,
    );
    const options = { root, packages: ["src/good.ts#default", "src/bad.ts#default"] };
    const good = await call(options, "prism_check_package", { package: "src/good.ts#default" });
    assert.equal(good.json.ok, true, good.raw);
    assert.equal(good.json.result.ok, true, good.raw);
    assert.equal(good.json.result.checks.length, 6);
    const unknown = await call(options, "prism_check_package", { package: "src/nope.ts#default" });
    assert.equal(unknown.json.ok, false);
    assert.deepEqual(unknown.json.configured, ["src/good.ts#default", "src/bad.ts#default"]);
    const bad = await call(options, "prism_check_package", { package: "src/bad.ts#default" });
    assert.equal(bad.json.ok, true, bad.raw);
    assert.equal(bad.json.result.ok, false);
    const failed = bad.json.result.checks.find((check: { ok: boolean }) => !check.ok);
    assert.equal(failed.name, "capabilities_cover_usage");
  });

  it("check_manifest_respects_trust_flag", async () => {
    const root = checkRoot();
    const home = tempDir("host-builder-home-");
    const dirs = scopeDirs({ scope: "project", root });
    const dir = installedPackageDir(dirs.packagesDir, "@acme/feature");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "@acme/feature", version: "1.0.0", type: "module", exports: { ".": "./src/index.ts" } }),
    );
    writeFileSync(
      join(dir, "src/index.ts"),
      `export default { name: "@acme/feature", version: "1.0.0", requires: { api: 1 }, capabilities: ["host-ui"], config: { type: "object" }, setup() {} };\n`,
    );
    await writeManifest(dirs, {
      version: 1,
      packages: [
        {
          name: "@acme/feature",
          version: "^1.0.0",
          integrity: await hashPackageClosure(dirs.packagesDir, "@acme/feature", "project"),
          capabilities: [],
          enabled: true,
        },
      ],
    });
    const base = { root, passEnv: ["PRISM_HOME"] };
    process.env.PRISM_HOME = home;
    try {
      const untrusted = await call(base, "prism_check_manifest");
      assert.equal(untrusted.json.ok, true, untrusted.raw);
      assert.equal(untrusted.json.result.ok, true, untrusted.raw);
      assert.equal(untrusted.json.result.packages[0].configChecked, false);
      const trusted = await call({ ...base, trustProject: true }, "prism_check_manifest");
      assert.equal(trusted.json.result.ok, false, trusted.raw);
      assert.equal(trusted.json.result.packages[0].configChecked, true);
      assert.equal(trusted.json.result.packages[0].issues[0].code, "capabilities_drift");
    } finally {
      delete process.env.PRISM_HOME;
    }
  });

  it("the bin takes the start flags and serves the check over stdio", async () => {
    const root = checkRoot();
    write(root, "src/agent.ts", INSPECTION_AGENT);
    write(root, "src/pkg.ts", PACKAGE);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        BIN,
        "mcp",
        "--root",
        root,
        "--entry",
        "src/agent.ts#createInspectionAgent",
        "--package",
        "src/pkg.ts",
        "--check-timeout",
        "60",
        "--pass-env",
        "HOME",
      ],
    });
    const client = new Client({ name: "stdio-check", version: "1" });
    await client.connect(transport);
    try {
      const inspected = await client.callTool({ name: "prism_inspect_host", arguments: { entry: "src/agent.ts#createInspectionAgent" } });
      assert.equal(JSON.parse((inspected.content as Array<{ text: string }>)[0]?.text ?? "{}").ok, true);
      // `--package src/pkg.ts` defaults the export to `default`.
      const checked = await client.callTool({ name: "prism_check_package", arguments: { package: "src/pkg.ts#default" } });
      assert.equal(JSON.parse((checked.content as Array<{ text: string }>)[0]?.text ?? "{}").result.ok, true);
    } finally {
      await client.close();
    }
    for (const bad of [["--check-timeout", "0"], ["--check-timeout", "500"], ["--pass-env", "not a name"], ["--entry"]]) {
      const run = spawnSync(process.execPath, [BIN, "mcp", "--root", root, ...bad], { encoding: "utf8", timeout: 30_000 });
      assert.equal(run.status, 2, bad.join(" "));
    }
  });
});
