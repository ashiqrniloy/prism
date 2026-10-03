import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHookBus } from "../hooks/index.js";
import {
  type AgentConfig,
  type CredentialResolver,
  createAgent,
  createMemoryCheckpointStore,
  createSecretRedactor,
  createSlotDefaults,
  createSlotRegistry,
  definePackage,
  type HostUiRequest,
  type HostUiRequestKind,
  type PackageInput,
  PackageLoadError,
  providerDone,
  toolCallContent,
} from "../index.js";
import { loadPackages } from "../packages/loader.js";
import { createScriptedHostUi } from "../testing/host-ui.js";
import { packageConformance } from "../testing/package-conformance.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const SECRET = "sk-live-0123456789abcdef";
const KINDS: readonly HostUiRequestKind[] = ["confirm", "select", "input", "secret", "open-url", "notify"];

type Loose = { setup: (api: any) => void } & Record<string, unknown>;
const pkg = (name: string, setup: Loose["setup"], extra: Record<string, unknown> = {}): PackageInput =>
  definePackage<any>({ name, version: "1.0.0", setup, ...extra }) as PackageInput;

/** Direct loader harness with a pluggable credentials slot, so the secret path is observable. */
function harness(credentials: CredentialResolver = { resolve: () => undefined }) {
  const events: unknown[] = [];
  const bus = createHookBus({ onEvent: (event) => events.push(event) });
  const slots = createSlotRegistry({ ...createSlotDefaults(), credentials });
  const secrets: string[] = [];
  const redactor = createSecretRedactor([SECRET]);
  const load = (inputs: readonly PackageInput[], more: Record<string, unknown> = {}) =>
    loadPackages({ inputs, bus, slots, kernelVersion: "0.12.1", secrets, redactor, ...more } as Parameters<typeof loadPackages>[0]);
  return { load, secrets, slots, events, redactor };
}

/** Every kind, shaped to §2.3. A field rename breaks the object literal below, not just a test. */
const REQUEST_OF: Record<HostUiRequestKind, HostUiRequest> = {
  confirm: { kind: "confirm", title: "Approve?" },
  select: { kind: "select", title: "Pick", options: [{ value: "a" }], multiple: true },
  input: { kind: "input", title: "Name" },
  secret: { kind: "secret", title: "API key", ref: "keyring:acme" },
  "open-url": { kind: "open-url", title: "Sign in", url: "https://example.com" },
  notify: { kind: "notify", level: "warn", message: "slow" },
};

describe("host ui", () => {
  it("host_ui_request_kinds_match_the_catalog", async () => {
    // §2.3: six kinds; `secret` carries a `ref`, `notify` a `level`+`message`, `open-url` a
    // `title`, and `select` a `multiple`. `multiple` answers with a list.
    assert.deepEqual(KINDS, ["confirm", "select", "input", "secret", "open-url", "notify"]);
    assert.equal(REQUEST_OF.secret.kind === "secret" && REQUEST_OF.secret.ref, "keyring:acme");
    assert.equal(REQUEST_OF.notify.kind === "notify" && REQUEST_OF.notify.level, "warn");
    assert.equal(REQUEST_OF["open-url"].kind === "open-url" && REQUEST_OF["open-url"].title, "Sign in");
    assert.equal(REQUEST_OF.select.kind === "select" && REQUEST_OF.select.multiple, true);
    const scripted = createScriptedHostUi({ select: ["a", "b"] });
    assert.deepEqual(await scripted.ui.request({ kind: "select", title: "Pick", options: [{ value: "a" }], multiple: true }), {
      status: "answered",
      value: ["a", "b"],
    });
    // An unscripted kind is the fail-closed default, not an empty answer.
    assert.deepEqual(await scripted.ui.request({ kind: "confirm", title: "x" }), { status: "unavailable" });
  });

  it("kernel_stamps_package_and_session_on_every_kind", async () => {
    const seen: HostUiRequest[] = [];
    const scripted = createScriptedHostUi((request) => {
      seen.push(request);
      return "a";
    });
    const { load } = harness({ resolve: () => undefined, store: () => {} });
    await load(
      [
        pkg(
          "asker",
          ({ host }) => {
            for (const kind of KINDS) void host.ui.request({ ...REQUEST_OF[kind], package: "spoofed", sessionId: "spoofed" } as never);
          },
          { capabilities: ["host-ui"] },
        ),
      ],
      { host: { ui: scripted.ui } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(seen.length, KINDS.length);
    for (const request of seen) {
      assert.equal(request.package, "asker", "a package cannot spoof the `package` stamp");
      assert.equal(request.sessionId, undefined, "setup has no session to name");
    }
  });

  it("no_ui_answers_unavailable_for_every_kind", async () => {
    const answers: unknown[] = [];
    // The credentials slot can store, so only the absent host makes these unavailable.
    const { load } = harness({ resolve: () => undefined, store: () => {} });
    await load([
      pkg(
        "asker",
        ({ host }) => {
          for (const kind of KINDS) void host.ui.request(REQUEST_OF[kind] as never).then((r: unknown) => answers.push(r));
        },
        { capabilities: ["host-ui"] },
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      answers,
      KINDS.map(() => ({ status: "unavailable" })),
    );
  });

  it("secret_answer_is_stored_by_ref_and_never_returned", async () => {
    const stored: [string, string][] = [];
    const credentials: CredentialResolver = {
      resolve: () => undefined,
      store: (ref, value) => {
        stored.push([ref, value]);
      },
    };
    const { load, secrets, events } = harness(credentials);
    const scripted = createScriptedHostUi({ secret: SECRET });
    let answer: unknown;
    await load(
      [
        pkg(
          "seeker",
          ({ host, status }) => {
            void host.ui.request({ kind: "secret", title: "API key", ref: "keyring:acme" }).then((r: unknown) => (answer = r));
            // A package must not be able to route the value out through a note either.
            status.note("warn", `key is ${SECRET}`);
          },
          { capabilities: ["host-ui"] },
        ),
      ],
      { host: { ui: scripted.ui } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(stored, [["keyring:acme", SECRET]], "the kernel stored the value at the request's ref");
    assert.deepEqual(answer, { status: "answered", value: undefined }, "the package never sees the value");
    assert.ok(secrets.includes(SECRET), "the stored value joins secrets, so this run's own events and errors mask it");
    // The value is masked in what the loader emits: events, status notes, and the redactor.
    assert.doesNotMatch(JSON.stringify(events), new RegExp(SECRET), "the stored secret appears in an event or status note");
    assert.equal(secrets.length, 1, "the value was added once and stays scoped to this load");
    // A slot with no `store` answers unavailable rather than holding a secret it cannot persist.
    const plain = harness();
    let refused: unknown;
    await plain.load(
      [
        pkg(
          "seeker",
          ({ host }) => {
            void host.ui.request({ kind: "secret", title: "API key", ref: "keyring:acme" }).then((r: unknown) => (refused = r));
          },
          { capabilities: ["host-ui"] },
        ),
      ],
      { host: { ui: createScriptedHostUi({ secret: SECRET }).ui } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(refused, { status: "unavailable" });
  });
  it("secret_request_with_literal_ref_fails_before_the_host_is_asked", async () => {
    const stored: string[] = [];
    const credentials: CredentialResolver = { resolve: () => undefined, store: (ref) => void stored.push(ref) };
    const { load } = harness(credentials);
    const scripted = createScriptedHostUi({ secret: SECRET });
    let thrown: unknown;
    await load(
      [
        pkg(
          "leaky",
          ({ host }) => {
            void host.ui.request({ kind: "secret", title: "Key", ref: SECRET } as never).catch((error: unknown) => (thrown = error));
          },
          { capabilities: ["host-ui"] },
        ),
      ],
      { host: { ui: scripted.ui } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(thrown instanceof PackageLoadError && thrown.code === "invalid_secret_ref", String(thrown));
    assert.deepEqual(stored, [], "nothing was stored");
    assert.equal(scripted.requests.length, 0, "the host was never asked");
  });

  it("ask_suspends_when_run_is_non_interactive_even_with_ui", async () => {
    for (const loop of ["default", "custom"] as const) {
      const scripted = createScriptedHostUi({ confirm: true });
      const { agent, calls } = await askAgent({ host: { ui: scripted.ui } }, loop);
      const result = await (await agent.session()).run("go", {
        interactive: false,
        runState: { checkpoints: createMemoryCheckpointStore(), definitionRevision: "1" },
      });
      assert.equal(result.status, "suspended", loop);
      assert.equal(calls(), 0, loop);
      assert.equal(scripted.requests.length, 0, `${loop}: a non-interactive run never prompts`);
      await agent.dispose();
    }
  });

  it("package_conformance_runs_setup_and_commands_against_unavailable", async () => {
    const closed = definePackage<any>({
      name: "@acme/closed",
      version: "1.0.0",
      capabilities: ["host-ui"],
      setup({ host, commands }) {
        // Correct: branch on `status` and fail closed with a named error.
        commands.register({
          name: "probe",
          description: "probe",
          run: async () => {
            const answer = await host.ui?.request({ kind: "confirm", title: "ok" });
            if (answer?.status !== "answered") throw Object.assign(new Error("no ui"), { code: "ui_unavailable" });
            return { ok: true };
          },
        });
      },
    });
    const good = await packageConformance(closed);
    const closedCheck = good.checks.find((entry) => entry.name === "unavailable_fails_closed");
    assert.equal(closedCheck?.ok, true, JSON.stringify(good.checks));

    const sloppy = definePackage<any>({
      name: "@acme/sloppy",
      version: "1.0.0",
      capabilities: ["host-ui"],
      setup({ host, commands }) {
        commands.register({
          name: "probe",
          description: "probe",
          run: async () => {
            // Treats `unavailable` as an answer and crashes on the missing value.
            const answer = await host.ui?.request({ kind: "secret", title: "key", ref: "keyring:acme" });
            return { len: (answer as { value: string }).value.trim().length };
          },
        });
      },
    });
    const bad = await packageConformance(sloppy);
    assert.equal(bad.ok, false);
    assert.equal(bad.checks.find((check) => check.name === "unavailable_fails_closed")?.ok, false);
  });
});

/** An agent whose `write` tool asks for approval, on the default loop or a minimal custom one. */
async function askAgent(
  config: Partial<AgentConfig>,
  loop: "default" | "custom",
): Promise<{ agent: Awaited<ReturnType<typeof createAgent>>; calls: () => number }> {
  let calls = 0;
  const provider = {
    id: "mock",
    async *generate() {
      yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "ok" }) };
      yield providerDone();
    },
  };
  const agent = await createAgent({
    id: "ask-agent",
    model: MODEL,
    ...(config as Partial<AgentConfig>),
    hooks: (hooks: Parameters<NonNullable<AgentConfig["hooks"]>>[0]) => hooks.on("tool.call", () => ({ ask: "Approve?" })),
    provider,
    ...(loop === "custom" ? { loop: customLoop() } : {}),
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          execute: () => {
            calls += 1;
            return { toolCallId: "call-1", name: "write", value: "done" };
          },
        },
      ],
    },
  });
  return { agent, calls: () => calls };
}

/** The smallest loop that still goes through `RunController`'s `tool.call` gate. */
function customLoop() {
  return {
    name: "custom",
    async run(controller: any) {
      const turn = await controller.turn();
      if (turn.type === "tool_calls") return controller.executeTools(turn.calls);
      return { stop: true as const };
    },
  } as never;
}
