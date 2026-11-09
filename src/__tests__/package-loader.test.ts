import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  type ModelProvider,
  createAgent,
  createSecretRedactor,
  createSlotDefaults,
  createSlotRegistry,
  definePackage,
  type HostUiRequest,
  type LoopStrategy,
  type PackageInput,
  PackageLoadError,
  type PackageDefinitionInput,
  providerDone,
  providerTextDelta,
  SlotConflictError,
  toolCallContent,
  UnknownSlotOwnerError,
} from "../index.js";
import { createHookBus } from "../hooks/index.js";
import { agentRuntime } from "../agent-session/create-agent.js";
import { loadPackages } from "../packages/loader.js";
import { isValidVersion, parseRange, parseVersion, satisfies } from "../packages/semver.js";
import { KERNEL_VERSION } from "../version.js";
import { bindManifestInstance } from "../packages/define.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const SECRET = "sk-live-0123456789abcdef";

type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"] = () => {}, extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra });

/** Direct loader harness: its own bus and slot registry, so tests can see what survives a failure. */
function harness(options: { readonly redactor?: ReturnType<typeof createSecretRedactor>; readonly kernelVersion?: string } = {}) {
  const events: AgentEvent[] = [];
  const bus = createHookBus({ onEvent: (event) => events.push(event) });
  const slots = createSlotRegistry(createSlotDefaults());
  const load = (inputs: readonly PackageInput[], more: Partial<Parameters<typeof loadPackages>[0]> = {}) =>
    loadPackages({ inputs, bus, slots, kernelVersion: options.kernelVersion ?? "0.12.1", redactor: options.redactor, ...more });
  return { bus, slots, events, load };
}

async function loadError(promise: Promise<unknown>, code: string): Promise<PackageLoadError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof PackageLoadError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  return assert.fail(`expected PackageLoadError ${code}`);
}

function textProvider(): ModelProvider {
  return {
    id: "mock",
    async *generate() {
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

describe("definePackage", () => {
  it("is callable, and validates the definition eagerly", () => {
    const cfg = definePackage<{ x: string }>({
      name: "@acme/web",
      version: "1.2.3",
      config: { type: "object", properties: { x: { type: "string", default: "d" } } },
      setup() {},
    });
    assert.equal(cfg.name, "@acme/web");
    assert.equal(typeof cfg, "function");
    const instance = cfg({ x: "y" }, { optional: true });
    assert.equal(instance.optional, true);
    assert.deepEqual(instance.config, { x: "y" });
    assert.equal(cfg().optional, false);
    const bad: readonly [string, () => unknown][] = [
      ["name", () => pkg("Not A Name")],
      ["empty name", () => pkg("")],
      ["reserved host", () => pkg("host")],
      ["reserved kernel", () => pkg("kernel")],
      ["version", () => definePackage({ name: "a", version: "1.0", setup() {} })],
      ["setup", () => definePackage({ name: "a", version: "1.0.0" } as never)],
      ["requires.api missing", () => pkg("a", () => {}, { requires: {} as never })],
      ["requires.prism hyphen", () => pkg("a", () => {}, { requires: { api: 1, prism: "1.0.0 - 2.0.0" } })],
      ["requires.prism x-range", () => pkg("a", () => {}, { requires: { api: 1, prism: "1.x" } })],
      ["requires.prism partial", () => pkg("a", () => {}, { requires: { api: 1, prism: "1.2" } })],
      ["requires.prism tag", () => pkg("a", () => {}, { requires: { api: 1, prism: "latest" } })],
      ["requires.packages range", () => pkg("a", () => {}, { requires: { api: 1, packages: { b: "next" } } })],
      ["requires.services", () => pkg("a", () => {}, { requires: { api: 1, services: [""] } })],
      ["capability", () => pkg("a", () => {}, { capabilities: ["root" as never] })],
    ];
    for (const [label, make] of bad) {
      assert.throws(make, (error: unknown) => error instanceof PackageLoadError && error.code === "definition_invalid", label);
    }
    assert.throws(
      () => pkg("a", () => {}, { config: { $ref: "#" } as never }),
      (error: unknown) => error instanceof PackageLoadError && error.code === "config_schema_unsupported",
    );
  });

  it("only accepts what definePackage made", async () => {
    const { load } = harness();
    await loadError(load([{ name: "x", setup() {} } as never]), "definition_invalid");
    await loadError(load([(() => ({})) as never]), "definition_invalid");
  });
});

describe("semver ranges", () => {
  const cases: readonly [string, string, boolean][] = [
    ["^1.2.3", "1.9.0", true],
    ["^1.2.3", "2.0.0", false],
    ["^1.2.3", "1.2.2", false],
    ["^0.2.3", "0.2.9", true],
    ["^0.2.3", "0.3.0", false],
    ["^0.0.3", "0.0.3", true],
    ["^0.0.3", "0.0.4", false],
    ["~1.2.3", "1.2.9", true],
    ["~1.2.3", "1.3.0", false],
    ["1.2.3", "1.2.3", true],
    ["=1.2.3", "1.2.4", false],
    [">=1.0.0", "1.0.0", true],
    [">1.0.0", "1.0.0", false],
    ["<=1.0.0", "1.0.0", true],
    ["<1.0.0", "1.0.0", false],
    [">=1.0.0 <2.0.0", "1.5.0", true],
    [">=1.0.0 <2.0.0", "2.0.0", false],
    ["^1.0.0 || ^3.0.0", "3.1.0", true],
    ["^1.0.0 || ^3.0.0", "2.0.0", false],
    ["*", "9.9.9", true],
    // The prerelease rule: a prerelease needs a comparator naming the same major.minor.patch.
    ["^0.13.0-0", "0.13.0-rc.1", true],
    ["^0.13.0-0", "0.13.0", true],
    ["^0.13.0-0", "0.12.1", false],
    ["^0.12.1", "0.13.0-rc.1", false],
    ["^0.12.1 || ^0.13.0-0", "0.12.1", true],
    ["*", "1.0.0-alpha", false],
    [">=1.0.0-alpha.2", "1.0.0-alpha.10", true],
    [">=1.0.0-alpha.2", "1.0.0-alpha.1", false],
    ["^1.0.0", "1.0.0-beta", false],
    ["^1.0.0", "2.0.0-beta", false],
  ];
  it("matches the supported forms", () => {
    for (const [range, version, expected] of cases) {
      const parsed = parseVersion(version);
      assert.ok(parsed, version);
      assert.equal(satisfies(parsed, parseRange(range)), expected, `${version} in ${range}`);
    }
  });

  it("rejects unsupported forms", () => {
    for (const range of ["1.0.0 - 2.0.0", "1.x", "1.2", "x", "latest", "", "^1", ">= 1.0.0", "^1.0.0 ||", "1.0.0 || next", "^"]) {
      assert.throws(
        () => parseRange(range),
        (error: unknown) => error instanceof PackageLoadError && error.code === "definition_invalid",
        range,
      );
    }
    assert.equal(isValidVersion("1.2.3-rc.1+build.5"), true);
    for (const version of ["1.2", "01.2.3", "1.2.3.4", "v1.2.3", "1.2.3-", ""]) assert.equal(isValidVersion(version), false, version);
  });

  it("kernel_version_matches_package_json", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as { version: string };
    assert.equal(KERNEL_VERSION, manifest.version, "src/version.ts drifted from package.json; the lockstep bump rewrites it");
  });

  it("the lockstep bump rewrites src/version.ts", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-version-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/version.ts"), `/** doc */\nexport const KERNEL_VERSION = "0.12.1";\n`);
    const manifest = { name: "@arnilo/prism", version: "0.12.1" };
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    const release = await import(join(import.meta.dirname, "../../scripts/release.mjs"));
    const pkgEntry = { path: ".", manifest };
    release.bumpRelease({ root, packages: [pkgEntry], byName: new Map([["@arnilo/prism", pkgEntry]]) }, "0.12.1", "0.13.0");
    assert.match(readFileSync(join(root, "src/version.ts"), "utf8"), /KERNEL_VERSION = "0\.13\.0";/);
  });
});

describe("package loader", () => {
  it("listed_package_is_active_without_wiring", async () => {
    let executed = 0;
    const gate = pkg("@acme/gate", ({ hooks }) => {
      hooks.on("tool.call", (call) => (call.name === "danger" ? { deny: "blocked by @acme/gate" } : undefined));
    });
    let turn = 0;
    const agent = await createAgent({
      model: MODEL,
      packages: [
        gate,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent("c1", "danger", {}) };
              else yield providerTextDelta("done");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "danger",
            parameters: {},
            execute: (_a, c) => {
              executed += 1;
              return { toolCallId: c.toolCallId, name: "danger", value: "ran" };
            },
          },
        ],
      },
    });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(executed, 0, "the package's tool.call deny blocked the tool with no other host code");
    assert.ok(
      agentRuntime(agent)
        .hooks.registrations()
        .some((r) => r.id === "@acme/gate:tool.call"),
    );
  });

  it("api_level_admits_next_minor", async () => {
    // The API level is what admits a package on a newer 0.x kernel; `prism` is optional.
    await harness({ kernelVersion: "0.14.0" }).load([pkg("a", () => {}, { requires: { api: 1 } })]);
  });

  it("api_level_mismatch_fails_closed", async () => {
    const mismatched = await loadError(harness().load([pkg("a", () => {}, { requires: { api: 2 } })]), "kernel_api");
    assert.match(mismatched.message, /targets kernel API 2; this kernel supports 1/);
  });

  it("api_missing_fails_closed", async () => {
    // A `requires` object without `api` fails at definePackage, naming the field.
    assert.throws(
      () => pkg("a", () => {}, { requires: { prism: ">=0.13.0" } as never }),
      (error: unknown) => error instanceof PackageLoadError && error.code === "definition_invalid" && /requires\.api/.test(error.message),
    );
    // A definition with no `requires` at all is rejected by the loader.
    await loadError(harness().load([definePackage({ name: "a", version: "1.0.0", setup() {} })]), "definition_invalid");
  });

  it("prism_minimum_still_checked", async () => {
    await loadError(harness().load([pkg("a", () => {}, { requires: { api: 1, prism: ">=9.0.0" } })]), "kernel_range");
    await harness({ kernelVersion: "9.0.0" }).load([pkg("a", () => {}, { requires: { api: 1, prism: ">=9.0.0" } })]);
  });

  it("requires_checks_fail_closed", async () => {
    let ran = false;
    const probe = () => pkg("@acme/probe", () => void (ran = true), { requires: { api: 1, prism: "^9.0.0" } });
    const error = await loadError(harness().load([probe()]), "kernel_range");
    assert.equal(error.package, "@acme/probe");
    assert.equal(ran, false, "setup never runs after a failed requires check");
    // The kernel the check ran against is the injected one.
    await harness({ kernelVersion: "9.1.0" }).load([probe()]);
    assert.equal(ran, true);

    await loadError(harness().load([pkg("a", () => {}, { requires: { api: 1, packages: { b: "^1.0.0" } } })]), "missing_package");
    const old = definePackage({ name: "b", version: "0.9.0", requires: { api: 1 }, setup() {} });
    const wrongVersion = await loadError(
      harness().load([pkg("a", () => {}, { requires: { api: 1, packages: { b: "^1.0.0" } } }), old]),
      "missing_package",
    );
    assert.match(wrongVersion.message, /0\.9\.0/);
    await loadError(harness().load([pkg("a", () => {}, { requires: { api: 1, services: ["svc"] } })]), "missing_service");
    const cycle = await loadError(
      harness().load([
        pkg("a", () => {}, { requires: { api: 1, packages: { b: "*" } } }),
        pkg("b", () => {}, { requires: { api: 1, packages: { c: "*" } } }),
        pkg("c", () => {}, { requires: { api: 1, packages: { a: "*" } } }),
      ]),
      "dependency_cycle",
    );
    assert.match(cycle.message, /a -> b -> c -> a/);
    await loadError(harness().load([pkg("same"), pkg("same")]), "duplicate_package");
    await loadError(harness().load([pkg("same"), pkg("same")()]), "duplicate_package");
    await loadError(harness().load([pkg("a")], { packageConfig: { typo: { x: 1 } } }), "config_unknown_key");
  });

  it("topological_order_is_stable", async () => {
    const order: string[] = [];
    const track = (name: string, extra?: Partial<Loose["requires"]>) =>
      pkg(name, () => void order.push(name), { requires: { api: 1, ...extra } });
    const { load } = harness();
    const loaded = await load([track("b", { prism: "*", packages: { a: "*" } }), track("c"), track("a")]);
    assert.deepEqual(order, ["a", "b", "c"]);
    assert.deepEqual(
      loaded.packages.map((p) => p.name),
      ["a", "b", "c"],
    );
    order.length = 0;
    await harness().load([track("x"), track("y"), track("z")]);
    assert.deepEqual(order, ["x", "y", "z"], "no dependencies keeps input order");
  });

  it("setup_failure_unwinds_all_prior_packages", async () => {
    const order: string[] = [];
    const { bus, slots, load } = harness();
    const first = pkg(
      "p1",
      ({ hooks, onDispose }) => {
        hooks.on("turn.before", () => undefined);
        onDispose(() => void order.push("p1"));
      },
      { capabilities: ["slot:compaction"] },
    );
    const second = pkg(
      "p2",
      ({ hooks, slots: s, onDispose }) => {
        hooks.on("run.input", (m) => m);
        s.compaction.provide({ compact: () => ({ messages: [] }) as never });
        onDispose(() => void order.push("p2"));
      },
      { capabilities: ["slot:compaction"] },
    );
    const third = pkg("p3", ({ hooks, onDispose }) => {
      hooks.on("message.append", (m) => m);
      onDispose(() => void order.push("p3"));
      throw new Error("boom");
    });
    const error = await loadError(load([first, second, third]), "setup_failed");
    assert.equal(error.package, "p3");
    assert.deepEqual(order, ["p3", "p2", "p1"], "every started package is disposed in reverse order, the failing one included");
    assert.deepEqual(bus.registrations(), []);
    assert.deepEqual(slots.providers("compaction"), []);
  });

  it("optional_setup_failure_skips_with_status_note", async () => {
    const { bus, load } = harness();
    const flaky = pkg("flaky", ({ hooks }) => {
      hooks.on("turn.before", () => undefined);
      throw new Error("no api key");
    });
    const good = pkg("good", ({ hooks }) => void hooks.on("run.input", (m) => m));
    const loaded = await load([flaky({}, { optional: true }), good]);
    assert.deepEqual(
      loaded.packages.map((p) => p.name),
      ["good"],
    );
    assert.deepEqual(
      bus.registrations().map((r) => r.id),
      ["good:run.input"],
      "the skipped package's partial registrations are gone",
    );
    const [note] = loaded.statusNotes();
    assert.equal(note?.package, "flaky");
    assert.equal(note?.level, "warn");
    assert.match(note?.message ?? "", /^skipped: .*no api key/);
    // `optional` covers a setup throw only: a failed requires check is still fatal.
    await loadError(load([pkg("needs", () => {}, { requires: { api: 1, prism: "^9.0.0" } })({}, { optional: true })]), "kernel_range");
  });

  it("capabilities_for_narrows_per_instance_and_fails_closed_outside_declared", async () => {
    const { load } = harness();
    const config = { type: "object", properties: { slot: { type: "boolean", default: true } }, additionalProperties: false } as const;
    const narrowing = pkg("narrowing", ({ slots }) => slots.compaction.provide({ compact: () => ({}) as never }), {
      capabilities: ["slot:compaction", "models"],
      config,
      capabilitiesFor: (c: { slot: boolean }) => (c.slot ? ["slot:compaction"] : []),
    });
    const loaded = await load([narrowing({ slot: true })]);
    assert.deepEqual([...(loaded.capabilities.get("narrowing") ?? [])], ["slot:compaction"], "narrowed to what the config enables");
    // Turned off by config, the same call is refused: a narrowed capability is gone, not just undocumented.
    await loadError(harness().load([narrowing({ slot: false })]), "capability_missing");
    // Narrowing only removes: a capability outside the declared set, a non-array or a throw fails the load.
    const widening = pkg("widening", () => {}, { capabilities: ["models"], capabilitiesFor: () => ["slot:loop"] });
    assert.match((await loadError(harness().load([widening]), "definition_invalid")).message, /slot:loop/);
    await loadError(
      harness().load([pkg("not-array", () => {}, { capabilities: [], capabilitiesFor: () => "models" as never })]),
      "definition_invalid",
    );
    const throwing = pkg("throwing", () => {}, {
      capabilities: [],
      capabilitiesFor: () => {
        throw new Error(SECRET);
      },
    });
    const thrown = await loadError(harness().load([throwing]), "definition_invalid");
    assert.ok(!thrown.message.includes(SECRET), "the thrown message is not echoed");
    // Without a declared set there is nothing to narrow.
    assert.throws(
      () => pkg("bare", () => {}, { capabilitiesFor: () => [] }),
      (err: any) => err.code === "definition_invalid",
    );
  });

  it("capability_missing_fails_on_call", async () => {
    const { load } = harness();
    const slotCall = await loadError(
      load([pkg("no-slot", ({ slots }) => slots.loop.provide({ name: "x", run: async () => {} }))]),
      "capability_missing",
    );
    assert.match(slotCall.message, /slots\.loop\.provide.*slot:loop/);
    assert.equal(slotCall.package, "no-slot");
    // A loop capability does not cover another slot.
    await loadError(
      load([pkg("wrong-slot", ({ slots }) => slots.compaction.provide({ compact: () => ({}) as never }), { capabilities: ["slot:loop"] })]),
      "capability_missing",
    );
    // host.ui is gated, and answers `unavailable` (not an error) when the host has no UI.
    let uiDenied: unknown;
    let uiResult: unknown;
    const asks: HostUiRequest[] = [];
    await load([
      pkg("no-ui", ({ host }) => {
        void host.ui?.request({ kind: "confirm", title: "x" }).catch((error: unknown) => (uiDenied = error));
      }),
      pkg(
        "ui",
        ({ host }) => {
          void host.ui?.request({ kind: "confirm", title: "x" }).then((r) => (uiResult = r));
        },
        { capabilities: ["host-ui"] },
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(uiDenied instanceof PackageLoadError && uiDenied.code === "capability_missing");
    assert.deepEqual(uiResult, { status: "unavailable" });
    // With a UI attached, the request carries the package name the kernel set.
    await load(
      [
        pkg("asker", ({ host }) => void host.ui?.request({ kind: "confirm", title: "ok", package: "spoofed" } as never), {
          capabilities: ["host-ui"],
        }),
      ],
      {
        host: {
          ui: {
            request: async (request) => {
              asks.push(request);
              return { status: "answered", value: true } as never;
            },
          },
        },
      },
    );
    assert.equal(asks[0]?.package, "asker", "a package cannot spoof the `package` stamp");
  });

  it("two_slot_claimants_fail_closed_until_assigned", async () => {
    const claim = (name: string) =>
      pkg(name, ({ slots }) => slots.compaction.provide({ name, compact: () => ({}) as never }), { capabilities: ["slot:compaction"] });
    const conflict = harness();
    const failure = await conflict.load([claim("@a/x"), claim("@b/y")]).then(
      () => assert.fail("expected a slot conflict"),
      (error: unknown) => error,
    );
    assert.ok(failure instanceof SlotConflictError);
    assert.deepEqual(failure.owners, ["@a/x", "@b/y"]);
    assert.deepEqual(conflict.slots.providers("compaction"), [], "the failed load unwound both claims");

    const assigned = harness();
    await assigned.load([claim("@a/x"), claim("@b/y")], { slotAssignments: { compaction: "@a/x" } });
    assert.equal(assigned.slots.ownerOf("compaction", "@a/x"), "@a/x");
    // A direct implementation wins over both packages.
    const direct = harness();
    await direct.load([claim("@a/x"), claim("@b/y")], { slotAssignments: { compaction: { compact: () => ({}) as never } } });
    // Naming an owner that did not provide the slot fails closed.
    const unknown = harness();
    await assert.rejects(() => unknown.load([claim("@a/x")], { slotAssignments: { compaction: "@z/none" } }), UnknownSlotOwnerError);
    // Through createAgent the assignment is `AgentConfig.slots`.
    const agent = await createAgent({
      model: MODEL,
      packages: [claim("@a/x"), claim("@b/y"), providerPackage("test-provider", [textProvider()])],
      slots: { compaction: "@b/y" },
    });
    assert.equal(agentRuntime(agent).slots.ownerOf("compaction", "@b/y"), "@b/y");
    await assert.rejects(
      () => createAgent({ model: MODEL, packages: [claim("@a/x"), claim("@b/y"), providerPackage("test-provider", [textProvider()])] }),
      SlotConflictError,
    );
  });

  it("loop_slot_package_runs_end_to_end", async () => {
    const phases: string[] = [];
    const twoPhase: LoopStrategy = {
      name: "two-phase",
      revision: "1",
      async run(run) {
        phases.push("plan");
        const plan = await run.turn();
        if (plan.stopped) return;
        phases.push("act");
        if (plan.toolCalls.length > 0) await run.executeTools(plan.toolCalls);
        const verify = await run.turn();
        phases.push("verify");
        if (verify.stopped) return;
        await run.end();
      },
    };
    const owner = pkg("@acme/two-phase", ({ slots }) => slots.loop.provide(twoPhase), { capabilities: ["slot:loop"] });
    const seen: string[] = [];
    const audit = pkg("@acme/audit", ({ hooks }) => {
      hooks.on("tool.call", (call) => {
        seen.push(call.name);
        return call.name === "net" ? { deny: "no network" } : undefined;
      });
    });
    let executed = 0;
    let turn = 0;
    const agent = await createAgent({
      model: MODEL,
      packages: [
        owner,
        audit,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) {
                yield { type: "tool_call" as const, call: toolCallContent("n", "net", {}) };
                yield { type: "tool_call" as const, call: toolCallContent("l", "local", {}) };
              } else yield providerTextDelta("verified");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "net",
            parameters: {},
            execute: (_a, c) => {
              executed += 1;
              return { toolCallId: c.toolCallId, name: "net", value: 1 };
            },
          },
          {
            name: "local",
            parameters: {},
            execute: (_a, c) => {
              executed += 1;
              return { toolCallId: c.toolCallId, name: "local", value: 1 };
            },
          },
        ],
      },
    });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.deepEqual(phases, ["plan", "act", "verify"], "the package's loop owned the run");
    assert.deepEqual(seen, ["net", "local"], "tool.call still fired for every call");
    assert.equal(executed, 1, "and the deny still blocked the network tool");
  });

  it("host_hooks_load_last", async () => {
    const order: string[] = [];
    const agent = await createAgent({
      model: MODEL,
      hooks: (hooks) =>
        hooks.on("run.input", (m) => {
          order.push("host");
          return m;
        }),
      packages: [
        pkg("a", ({ hooks }) =>
          hooks.on("run.input", (m) => {
            order.push("a");
            return m;
          }),
        ),
        pkg("b", ({ hooks }) =>
          hooks.on("run.input", (m) => {
            order.push("b");
            return m;
          }),
        ),
        providerPackage("test-provider", [textProvider()]),
      ],
    });
    await (await agent.session()).run("hi");
    assert.deepEqual(order, ["a", "b", "host"], "equal priority: packages in load order, then the host");
    assert.deepEqual(
      agentRuntime(agent)
        .hooks.registrations()
        .map((r) => r.owner)
        .filter((owner) => owner !== "kernel"),
      ["a", "b", "host"],
    );
    // A throwing host registrar rejects createAgent after unwinding the packages.
    const { bus, load } = harness();
    await assert.rejects(
      () =>
        load([pkg("a", ({ hooks }) => hooks.on("run.input", (m) => m))], {
          hostHooks: (hooks) => {
            hooks.on("turn.before", () => undefined, { id: "dup" });
            hooks.on("turn.before", () => undefined, { id: "dup" });
          },
        }),
      /Duplicate hook registration id/,
    );
    assert.deepEqual(bus.registrations(), []);
  });

  it("dispose_is_reverse_order_and_idempotent", async () => {
    const order: string[] = [];
    const { bus, slots, load } = harness();
    const reported: AgentEvent[] = [];
    // Loaded first, so it is disposed last and still hears the others' failures.
    const watcher = pkg("watcher", ({ hooks }) => hooks.on("hook.error", (event) => void reported.push(event)));
    const track = (name: string, fail = false) =>
      pkg(name, ({ hooks, slots: s, onDispose }) => {
        hooks.on("turn.before", () => undefined);
        s.compaction.default;
        onDispose(() => void order.push(`${name}:1`));
        onDispose(() => {
          order.push(`${name}:2`);
          if (fail) throw new Error("dispose boom");
        });
      });
    const loaded = await load([watcher, track("a"), track("b", true), track("c")], {
      hostHooks: (hooks) => hooks.on("run.input", (m) => m),
    });
    assert.equal(bus.registrations().length, 5);
    await loaded.dispose();
    assert.deepEqual(order, ["c:2", "c:1", "b:2", "b:1", "a:2", "a:1"], "reverse load order, and reverse registration within a package");
    assert.deepEqual(bus.registrations(), [], "no contribution survives dispose");
    assert.deepEqual(slots.providers("compaction"), []);
    assert.equal(reported.length, 1, "a throwing callback is reported and does not stop the rest");
    assert.equal(reported[0]?.type === "hook.error" ? reported[0].owner : "", "b");
    await loaded.dispose();
    assert.equal(order.length, 6, "a second dispose is a no-op");

    const agent = await createAgent({ model: MODEL, packages: [track("x"), providerPackage("test-provider", [textProvider()])] });
    await agent.dispose();
    await agent.dispose();
    assert.deepEqual(agentRuntime(agent).hooks.registrations(), []);
  });

  it("package_config_is_isolated", async () => {
    const seen: Record<string, unknown> = {};
    const withConfig = (name: string) =>
      definePackage<any>({
        name,
        version: "1.0.0",
        requires: { api: 1 },
        config: {
          type: "object",
          properties: { level: { type: "string", default: "info" }, nested: { type: "object", additionalProperties: true } },
        },
        setup({ config }) {
          seen[name] = config;
        },
      });
    const { load } = harness();
    await load([withConfig("a")({ nested: { n: 1 } }), withConfig("b")], { packageConfig: { a: { level: "warn" } } });
    assert.deepEqual(seen.a, { level: "warn", nested: { n: 1 } });
    assert.deepEqual(seen.b, { level: "info" });
    assert.notEqual(seen.a, seen.b);
    assert.throws(() => ((seen.a as { level: string }).level = "x"), TypeError, "config is frozen");
    assert.throws(() => ((seen.a as { nested: { n: number } }).nested.n = 2), TypeError, "deeply");
    // A package never sees another package's name in its own config either.
    assert.equal(JSON.stringify(seen.b).includes("warn"), false);
  });

  it("package_instance_loads_independently_per_agent", async () => {
    let setups = 0;
    const live: object[] = [];
    const shared = pkg("@acme/shared", ({ hooks }) => {
      setups += 1;
      const state = {};
      live.push(state);
      hooks.on("run.input", (m) => {
        void state;
        return m;
      });
    });
    const instance = shared({});
    const one = await createAgent({ model: MODEL, packages: [instance, providerPackage("test-provider", [textProvider()])] });
    const two = await createAgent({ model: MODEL, packages: [instance, providerPackage("test-provider", [textProvider()])] });
    assert.equal(setups, 2);
    assert.notEqual(live[0], live[1]);
    await one.dispose();
    assert.equal(
      agentRuntime(two)
        .hooks.registrations()
        .filter((entry) => entry.owner !== "kernel").length,
      1,
      "disposing one agent leaves the other loaded",
    );
    // Re-creating from `{ ...agent.config }` reloads the packages afresh.
    const clone = await createAgent({ ...two.config });
    assert.equal(setups, 3);
    assert.equal(
      agentRuntime(clone)
        .hooks.registrations()
        .filter((entry) => entry.owner !== "kernel").length,
      1,
    );
  });

  it("missing_service_unwinds_prior_setups", async () => {
    const order: string[] = [];
    const { bus, load } = harness();
    const provider = pkg("p1", ({ services, hooks, onDispose }) => {
      services.provide("svc.one", { v: 1 });
      hooks.on("turn.before", () => undefined);
      onDispose(() => void order.push("p1"));
    });
    const second = pkg(
      "p2",
      ({ hooks, onDispose }) => {
        hooks.on("run.input", (m) => m);
        onDispose(() => void order.push("p2"));
      },
      { requires: { api: 1, services: ["svc.one", "svc.missing"] } },
    );
    const error = await loadError(load([provider, second]), "missing_service");
    assert.match(error.message, /svc\.missing/);
    assert.deepEqual(order, ["p2", "p1"]);
    assert.deepEqual(bus.registrations(), []);
  });

  it("services provide, consume, and require", async () => {
    const { load } = harness();
    const impl = { hello: () => "hi" };
    let consumed: unknown;
    let lateConsumer: (() => unknown) | undefined;
    await load([
      pkg("early", ({ services }) => {
        // Not visible during setup, visible at call time once a later package provided it.
        lateConsumer = () => services.consume("greeter");
        assert.equal(services.consume("greeter"), undefined);
        assert.throws(
          () => services.require("greeter"),
          (e: unknown) => e instanceof PackageLoadError && e.code === "missing_service",
        );
      }),
      pkg("provider", ({ services }) => services.provide("greeter", impl)),
      pkg("late", ({ services }) => void (consumed = services.require("greeter"))),
    ]);
    assert.equal(consumed, impl);
    assert.equal(lateConsumer?.(), impl);
    await loadError(
      load([pkg("one", ({ services }) => services.provide("x", 1)), pkg("two", ({ services }) => services.provide("x", 2))]),
      "service_conflict",
    );
  });

  it("setup_failure_redacts_cause", async () => {
    const { load } = harness({ redactor: createSecretRedactor([SECRET]) });
    const leaky = pkg("leaky", () => {
      throw new Error(`could not connect with ${SECRET}`, { cause: new Error(`inner ${SECRET}`) });
    });
    const error = await loadError(load([leaky]), "setup_failed");
    assert.equal(error.message.includes(SECRET), false);
    assert.match(error.message, /\[REDACTED\]/);
    assert.equal(JSON.stringify(error).includes(SECRET), false);
    assert.equal(String(error.stack).includes(SECRET), false);
    assert.equal(error.cause, undefined, "the raw third-party cause is not retained");
    // An optional skip records the same redacted message.
    const loaded = await load([leaky({}, { optional: true })]);
    assert.equal(JSON.stringify(loaded.statusNotes()).includes(SECRET), false);
  });

  it("events, status notes, and logs are stamped and redacted outside a run", async () => {
    const logs: unknown[] = [];
    const { events, load } = harness({ redactor: createSecretRedactor([SECRET]) });
    const emitted: AgentEvent[] = [];
    const listener = pkg("listener", ({ hooks }) => hooks.on("package.event", (event) => void emitted.push(event)));
    const speaker = pkg("speaker", ({ events: e, status, log }) => {
      e.emit("ready", { token: SECRET, n: 1 });
      status.note("info", `connected as ${SECRET}`);
      log.warn(`warn ${SECRET}`, { token: SECRET });
      assert.throws(() => e.emit("bad", (() => 1) as never), TypeError);
      assert.throws(() => e.emit("", 1), TypeError);
    });
    const loaded = await load([listener, speaker], {
      host: { log: { debug() {}, info() {}, error() {}, warn: (message, data) => void logs.push([message, data]) } },
    });
    const event = emitted[0];
    assert.ok(event?.type === "package.event");
    assert.equal(event.package, "speaker", "the package name is stamped by the loader");
    assert.equal(event.sessionId, "");
    assert.equal(JSON.stringify(event).includes(SECRET), false);
    assert.deepEqual(event.data, { token: "[REDACTED]", n: 1 });
    assert.equal(JSON.stringify(loaded.statusNotes()).includes(SECRET), false);
    assert.equal(loaded.statusNotes()[0]?.package, "speaker");
    assert.equal(JSON.stringify(logs).includes(SECRET), false);
    assert.deepEqual((logs[0] as [string, { package: string }])[1].package, "speaker");
    assert.equal(events.length, 0);
  });
});

describe("session context", () => {
  it("session_context_is_owner_bound", async () => {
    const outcomes: Record<string, unknown> = {};
    const probe = (name: string, capabilities: Loose["capabilities"]) =>
      pkg(
        name,
        ({ hooks }) => {
          hooks.on("turn.before", (_payload, context) => {
            const session = context.session;
            assert.ok(session, "the bus bound to a session supplies ctx.session");
            try {
              session.background("work", async () => {});
              outcomes[name] = "started";
            } catch (error) {
              outcomes[name] = error instanceof PackageLoadError ? error.code : String(error);
            }
            outcomes[`${name}:id`] = session.id;
            outcomes[`${name}:view`] = session;
            return undefined;
          });
        },
        capabilities ? { capabilities } : {},
      );
    const agent = await createAgent({
      model: MODEL,
      packages: [probe("with-bg", ["background"]), probe("without-bg", undefined), providerPackage("test-provider", [textProvider()])],
      hooks: (hooks) =>
        hooks.on("turn.before", (_payload, context) => {
          outcomes.host = context.session?.id;
          return undefined;
        }),
    });
    await (await agent.session({ id: "bound", create: true })).run("hi");
    assert.equal(outcomes["with-bg"], "started");
    assert.equal(outcomes["without-bg"], "capability_missing", "only the package without the capability is refused");
    assert.equal(outcomes["with-bg:id"], "bound");
    assert.equal(outcomes["without-bg:id"], "bound");
    assert.equal(outcomes.host, "bound");
    assert.notEqual(outcomes["with-bg:view"], outcomes["without-bg:view"], "each owner gets its own view");
  });

  it("config_sources_split_manifest_scope", async () => {
    let seenSources: any;
    const definition = definePackage<any>({
      name: "scoped-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: {
          fromUser: { type: "string" },
          overriddenByProject: { type: "string" },
          fromProject: { type: "string" },
        },
      },
      setup(prism) {
        seenSources = prism.configSources;
      },
    });
    const instance = bindManifestInstance(
      definition,
      {
        fromUser: "val1",
        overriddenByProject: "val2_proj",
        fromProject: "val3",
      },
      {
        optional: false,
        source: {
          kind: "manifest",
          scope: "project",
          scopes: {
            fromUser: "user",
            overriddenByProject: "project",
            fromProject: "project",
          },
        },
      },
    );
    const { load } = harness();
    await load([instance]);
    assert.deepEqual(seenSources, {
      fromUser: "user",
      overriddenByProject: "project",
      fromProject: "project",
    });
  });

  it("config_sources_are_value_free_and_frozen", async () => {
    let apiSources: any;
    const pkgDef = definePackage<any>({
      name: "freeze-test",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: {
          secretVal: { type: "string" },
          defaultVal: { type: "string", default: "def" },
        },
      },
      setup(prism) {
        apiSources = prism.configSources;
      },
    });
    const { load } = harness();
    await load([pkgDef({ secretVal: "sensitive-data" })]);
    assert.ok(Object.isFrozen(apiSources));
    assert.deepEqual(apiSources, {
      secretVal: "code",
      defaultVal: "default",
    });
    assert.ok(!Object.values(apiSources).includes("sensitive-data" as never));
    assert.ok(!Object.keys(apiSources).includes("sensitive-data"));
  });

  it("inspect_reports_scope_sources", async () => {
    const defManifest = definePackage<any>({
      name: "manifest-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: {
          cDef: { type: "string", default: "d" },
          cUser: { type: "string" },
          cProj: { type: "string" },
          cHost: { type: "string" },
        },
      },
      setup() {},
    });
    const instManifest = bindManifestInstance(
      defManifest,
      { cUser: "u", cProj: "p" },
      {
        optional: false,
        source: {
          kind: "manifest",
          scope: "project",
          scopes: {
            cUser: "user",
            cProj: "project",
          },
        },
      },
    );
    const defCode = definePackage<any>({
      name: "code-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: {
          cCode: { type: "string" },
        },
      },
      setup() {},
    });
    const agent = await createAgent({
      model: MODEL,
      packages: [instManifest, defCode({ cCode: "c" }), providerPackage("test-provider", [textProvider()])],
      packageConfig: {
        "manifest-pkg": { cHost: "h" },
      },
    });
    const inspected = agent.inspect().packages;
    const pkgM = inspected.find((p) => p.name === "manifest-pkg");
    assert.ok(pkgM);
    assert.equal(pkgM.configSources.cDef, "default");
    assert.equal(pkgM.configSources.cUser, "user");
    assert.equal(pkgM.configSources.cProj, "project");
    assert.equal(pkgM.configSources.cHost, "host");

    const pkgC = inspected.find((p) => p.name === "code-pkg");
    assert.ok(pkgC);
    assert.equal(pkgC.configSources.cCode, "code");
    await agent.dispose();
  });

  it("package_instances_returns_named_in_load_order", async () => {
    let bApi: any;
    let cApi: any;
    const defA = definePackage<any>({
      name: "pkg-a",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: { foo: { type: "string" } },
      },
      setup() {},
    });
    const defB = definePackage<any>({
      name: "pkg-b",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: { bar: { type: "string" } },
      },
      setup(prism) {
        bApi = prism;
      },
    });
    const defC = definePackage<any>({
      name: "pkg-c",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        cApi = prism;
      },
    });
    const { load } = harness();
    await load([defA({ foo: "bar" }), defB({ bar: "baz" }), defC]);

    const instancesFromB = bApi.packages.instances(["pkg-a"]);
    assert.equal(instancesFromB.length, 1);
    assert.equal(instancesFromB[0].definition.name, "pkg-a");
    assert.deepEqual(instancesFromB[0].config, { foo: "bar" });

    // C queries in reverse order ["pkg-b", "pkg-a"], should receive them in load order [pkg-a, pkg-b]
    const instancesFromC = cApi.packages.instances(["pkg-b", "pkg-a"]);
    assert.equal(instancesFromC.length, 2);
    assert.equal(instancesFromC[0].definition.name, "pkg-a");
    assert.equal(instancesFromC[1].definition.name, "pkg-b");
    assert.deepEqual(instancesFromC[0].config, { foo: "bar" });
    assert.deepEqual(instancesFromC[1].config, { bar: "baz" });
  });

  it("package_instances_rejects_unknown_disabled_self", async () => {
    let bApi: any;
    const defA = definePackage({ name: "pkg-a", version: "1.0.0", requires: { api: 1 }, setup() {} });
    const defB = definePackage({
      name: "pkg-b",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        bApi = prism;
      },
    });
    const defC = definePackage({ name: "pkg-c", version: "1.0.0", requires: { api: 1 }, setup() {} });
    const { load } = harness();
    await load([defA, defB, defC], { hostConfig: { disable: { packages: ["pkg-c"] } } });

    // self
    assert.throws(
      () => bApi.packages.instances(["pkg-b"]),
      (err: any) => err instanceof PackageLoadError && err.code === "self_instance",
    );
    // unknown
    assert.throws(
      () => bApi.packages.instances(["not-installed"]),
      (err: any) => err instanceof PackageLoadError && err.code === "unknown_package",
    );
    // disabled
    assert.throws(
      () => bApi.packages.instances(["pkg-c"]),
      (err: any) => err instanceof PackageLoadError && err.code === "package_disabled",
    );
  });

  it("package_instances_not_ready_during_setup", async () => {
    let setupError: any;
    const defA = definePackage({ name: "pkg-a", version: "1.0.0", requires: { api: 1 }, setup() {} });
    const defB = definePackage({
      name: "pkg-b",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        try {
          prism.packages.instances(["pkg-a"]);
        } catch (err) {
          setupError = err;
        }
      },
    });
    const { load } = harness();
    await load([defA, defB]);
    assert.ok(setupError instanceof PackageLoadError);
    assert.equal(setupError.code, "state_not_ready");
  });

  it("package_instances_from_custom_loop", async () => {
    let loopInstances: any;
    const targetDef = definePackage<any>({
      name: "target-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      config: { type: "object", properties: { key: { type: "string" } } },
      setup() {},
    });
    const loopDef = definePackage({
      name: "custom-loop-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      capabilities: ["slot:loop"],
      setup(prism) {
        prism.slots.loop.provide({
          name: "custom-loop",
          revision: "1",
          async run(run) {
            loopInstances = prism.packages.instances(["target-pkg"]);
            await run.turn();
            await run.end();
          },
        });
      },
    });
    const agent = await createAgent({
      model: MODEL,
      packages: [targetDef({ key: "val" }), loopDef, providerPackage("test-provider", [textProvider()])],
    });
    const session = await agent.session({ id: "loop-test", create: true });
    await session.run("hello");
    assert.ok(loopInstances);
    assert.equal(loopInstances.length, 1);
    assert.equal(loopInstances[0].definition.name, "target-pkg");
    assert.deepEqual(loopInstances[0].config, { key: "val" });
    await agent.dispose();
  });

  it("package_instances_expose_no_secret", async () => {
    const secretPkg = definePackage<any>({
      name: "secret-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      config: {
        type: "object",
        properties: {
          apiKey: { type: "string", "x-prism-secret": true },
        },
      },
      setup() {},
    });
    let consumerApi: any;
    const consumerPkg = definePackage({
      name: "consumer-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        consumerApi = prism;
      },
    });
    const { load } = harness();
    await load([secretPkg({ apiKey: "env:MY_API_KEY" }), consumerPkg]);
    const instances = consumerApi.packages.instances(["secret-pkg"]);
    assert.equal(instances[0].config.apiKey, "env:MY_API_KEY");
  });

  it("register_after_load_fails_closed", async () => {
    let packageApi: any;
    const def = definePackage({
      name: "late-reg-pkg",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        packageApi = prism;
      },
    });
    const { load } = harness();
    await load([def]);
    assert.throws(
      () => {
        packageApi.tools.register({
          name: "late_tool",
          description: "late",
          execute: async () => "ok",
        });
      },
      (err: any) => err instanceof PackageLoadError && err.code === "registration_closed",
    );
  });
});
