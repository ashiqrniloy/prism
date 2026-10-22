import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgent,
  createSecretRedactor,
  definePackage,
  type ModelProvider,
  type PackageDefinitionInput,
  providerDone,
  providerTextDelta,
  type Skill,
  type ToolDefinition,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const SECRET = "sk-live-0123456789abcdef";

type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"] = () => {}, extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra });

const provider: ModelProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};
const tool = (name: string): ToolDefinition => ({
  name,
  parameters: {},
  execute: (_a, c) => ({ toolCallId: c.toolCallId, name, value: "ok" }),
});
const skill = (name: string): Skill => ({ name, description: name, instructions: name });

describe("agent.inspect()", () => {
  it("inspect_lists_everything_in_execution_order", async () => {
    const audit = pkg(
      "@acme/audit",
      ({ hooks, tools, skills, commands, status }) => {
        hooks.on("tool.call", () => undefined, { priority: 5 });
        hooks.on("tool.completed", () => undefined);
        tools.register(tool("audit_log"));
        tools.register(tool("audit_drop"));
        skills.register(skill("audit-skill"));
        commands.register({ name: "audit", description: "audits", run: () => 1 });
        status.note("warn", "using a stub sink");
      },
      { version: "2.1.0", capabilities: ["host-ui"] },
    );
    const loop = pkg("@acme/loop", ({ slots }) => slots.loop.provide({ name: "x", revision: "1", run: async () => {} } as never), {
      capabilities: ["slot:loop"],
    });
    const flaky = pkg("@acme/flaky", () => {
      throw new Error("no key");
    });
    const agent = await createAgent({
      model: MODEL,
      tools: { add: [tool("shell"), tool("read")] },
      skills: { add: [skill("host-skill")] },
      packages: [audit, loop, flaky({}, { optional: true }), providerPackage("test-provider", [provider])],
      hooks: (h) => h.on("tool.call", () => undefined, { priority: 5 }),
      disable: { tools: ["shell", "audit_drop"] },
    });
    const view = agent.inspect();

    assert.deepEqual(
      view.packages
        .filter((p) => p.name !== "test-provider")
        .map(({ name, version, status, optional }) => [name, version, status, optional]),
      [
        ["@acme/audit", "2.1.0", "loaded", false],
        ["@acme/loop", "1.0.0", "loaded", false],
        ["@acme/flaky", "1.0.0", "skipped", true],
      ],
    );
    assert.deepEqual(view.packages[0]!.capabilities, ["host-ui"]);
    assert.deepEqual(view.tools, [
      { name: "read", package: "host" },
      { name: "audit_log", package: "@acme/audit" },
    ]);
    assert.deepEqual(view.skills, [
      { name: "host-skill", package: "host" },
      { name: "audit-skill", package: "@acme/audit" },
    ]);
    assert.deepEqual(view.commands, [{ name: "audit", package: "@acme/audit" }]);
    assert.deepEqual(view.disabled, { tools: ["shell", "audit_drop"], skills: [], commands: [], hooks: [] });
    // Same priority: package order, host last. A higher priority runs first.
    assert.deepEqual(
      view.hooks["tool.call"]!.map((hook) => hook.id),
      ["@acme/audit:tool.call", "host:tool.call"],
    );
    assert.deepEqual(view.slots, { loop: "@acme/loop", compaction: "kernel", store: "kernel", credentials: "kernel" });
    assert.deepEqual(
      view.statusNotes.map(({ package: owner, level, message }) => [owner, level, message]),
      [
        ["@acme/audit", "warn", "using a stub sink"],
        ["@acme/flaky", "warn", "skipped: Package @acme/flaky setup failed: no key"],
      ],
    );
    // A host-assigned slot shows `host`; a session's own pack hooks never show.
    const session = await agent.session();
    assert.equal(JSON.stringify(agent.inspect().hooks).includes("#session-"), false);
    await session.close();
    const direct = await createAgent({
      model: MODEL,
      packages: [providerPackage("test-provider", [provider])],
      slots: { loop: { name: "d", revision: "1", run: async () => {} } as never },
    });
    assert.equal(direct.inspect().slots.loop, "host");
    // `disable.hooks` removes a hook, and the listing agrees with dispatch.
    const trimmed = await createAgent({
      model: MODEL,
      packages: [audit, providerPackage("test-provider", [provider])],
      disable: { hooks: ["@acme/audit:tool.call"] },
    });
    assert.equal(trimmed.inspect().hooks["tool.call"], undefined);
    assert.deepEqual(trimmed.inspect().disabled.hooks, ["@acme/audit:tool.call"]);
  });

  it("inspect_reports_store_owner_and_capabilities", async () => {
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider])] });
    assert.deepEqual(agent.inspect().store, {
      owner: "kernel",
      capabilities: ["listSessions", "deleteSession", "searchSessions"],
    });

    const hosted = await createAgent({
      model: MODEL,
      packages: [providerPackage("test-provider", [provider])],
      slots: { store: { append: async () => {}, list: async () => [] } as never },
    });
    assert.deepEqual(hosted.inspect().store, { owner: "host", capabilities: [] });
  });

  it("inspect_never_contains_secret_values", async () => {
    process.env.TEST_KEY = SECRET;
    try {
      const keyed = pkg("@acme/keyed", () => {}, {
        config: {
          type: "object",
          properties: { apiKey: { type: "string", "x-prism-secret": true }, label: { type: "string" } },
        },
      });
      const agent = await createAgent({
        model: { ...MODEL, baseUrl: "https://spec-host.example/v1", credential: "env:SPEC_KEY", options: { marker: "spec-option" } },
        redactor: createSecretRedactor([SECRET]),
        packages: [keyed({ apiKey: "env:TEST_KEY", label: `prod ${SECRET}` }), providerPackage("test-provider", [provider])],
        packageConfig: {},
      });
      const text = JSON.stringify(agent.inspect());
      assert.ok(text.includes("env:TEST_KEY"), "the ref is shown");
      for (const field of ["spec-host.example", "SPEC_KEY", "spec-option"])
        assert.equal(text.includes(field), false, `ModelSpec ${field} is never listed`);
      assert.equal(text.includes(SECRET), false, "the env value and a secret in a non-secret field are not");
      assert.equal(agent.inspect().packages[0]!.configSources.apiKey, "code");
      assert.equal(agent.inspect().packages[0]!.source, "code");
      // A value `credentials.resolve` returned is masked too.
      const resolver = pkg(
        "@acme/resolver",
        ({ credentials, status }) => {
          void credentials.resolve("env:TEST_KEY").then((credential) => status.note("info", `got ${credential?.value}`));
        },
        { capabilities: ["credentials"] },
      );
      const resolved = await createAgent({
        model: MODEL,
        packages: [resolver, keyed({ label: `x ${SECRET}` }), providerPackage("test-provider", [provider])],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(JSON.stringify(resolved.inspect()).includes(SECRET), false, "resolved credentials never surface");
    } finally {
      delete process.env.TEST_KEY;
    }
  });

  it("inspect_is_json_and_frozen", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [pkg("@acme/a", ({ status }) => status.note("info", "hi")), providerPackage("test-provider", [provider])],
    });
    const view = agent.inspect();
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
    for (const part of [
      view,
      view.packages,
      view.packages[0],
      view.packages[0]!.configSources,
      view.hooks,
      view.slots,
      view.statusNotes,
      view.disabled,
    ]) {
      assert.ok(Object.isFrozen(part));
    }
    assert.throws(() => ((view.packages as unknown as unknown[]).length = 0), TypeError);
    // A snapshot: later changes do not alter an earlier view, and each call is independent.
    const before = JSON.stringify(view);
    await agent.dispose();
    assert.equal(JSON.stringify(view), before);
    assert.deepEqual(agent.inspect().hooks, {});
    assert.notEqual(agent.inspect(), agent.inspect());
  });

  it("inspect_reports_package_json_versions", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    // A sample across families: every package definition reads its own manifest, so a version bump is
    // one edit and inspect() can never report the retired lockstep literal again.
    const sample = [
      ["@arnilo/prism-store-jsonl", "packages/stores/jsonl"],
      ["@arnilo/prism-memory-compaction", "packages/memory/compaction"],
      ["@arnilo/prism-context-files", "packages/context/files"],
      ["@arnilo/prism-memory-rag", "packages/memory/rag"],
      ["@arnilo/prism-hooks-json", "packages/integrations/hooks-json"],
    ] as const;
    const definitions = [];
    for (const [name] of sample) definitions.push((await import(name)).default({}, { optional: true }));
    const agent = await createAgent({ model: MODEL, packages: [providerPackage("test-provider", [provider]), ...definitions] });
    const reported = new Map(agent.inspect().packages.map((entry) => [entry.name, entry.version]));
    for (const [name, dir] of sample) {
      const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      assert.equal(manifest.name, name);
      assert.equal(reported.get(name), manifest.version, `${name} must report its package.json version`);
      assert.notEqual(manifest.version, "0.12.1", `${name} must not be pinned to the retired lockstep`);
    }
  });
});
