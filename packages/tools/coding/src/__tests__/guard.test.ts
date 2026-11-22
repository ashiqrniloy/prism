/**
 * Plan 233 Task 3: the unsandboxed default asks unless a policy package decides. `shell` on the host
 * with no `tool-policy` service asks through `tool.call`; `approval` or `governance` takes over;
 * `guard: "off"` and a sandbox add no ask; out-of-root writes stay hard-denied, never asked.
 */
import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, createMemorySessionStore, type PackageInstance } from "@arnilo/prism";
import approval from "@arnilo/prism-extensions/approval";
import governance from "@arnilo/prism-extensions/governance";
import {
  createScriptedHostUi,
  mockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import toolsCoding, { createCodingTargets, createHardDenyHook, UNGUARDED_SHELL_ASK } from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-guard-"));
  dirs.push(dir);
  return dir;
}

function oneCall(name: string, args: Record<string, unknown>): PackageInstance {
  return mockProvider(
    [
      [providerToolCall(toolCallContent("c1", name, args as never)), providerDone()],
      [providerTextDelta("ok"), providerDone()],
    ],
    { id: "mock" },
  );
}

const SHELL = (root: string) => oneCall("shell", { command: `echo guarded > ${JSON.stringify(join(root, "marker.txt"))}` });

async function runOnce(options: {
  readonly packages: readonly PackageInstance[];
  readonly confirm?: boolean;
  readonly noUi?: boolean;
}): Promise<{ readonly status: string; readonly confirms: number; readonly text: string }> {
  const scripted = createScriptedHostUi(options.confirm === undefined ? {} : { confirm: options.confirm });
  const agent = await createAgent({
    model: { provider: "mock", model: "m" },
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    slots: { store: createMemorySessionStore() },
    ...(options.noUi ? {} : { host: { ui: scripted.ui } }),
    packages: [...options.packages],
  });
  try {
    const session = await agent.session({ id: "guard", create: true });
    const result = await session.run("go");
    const text = JSON.stringify(await session.messages());
    if (result.status !== "suspended") await session.close();
    return { status: result.status, confirms: scripted.requestsOf("confirm").length, text };
  } finally {
    await agent.dispose();
  }
}

describe("tools-coding unsandboxed guard", () => {
  it("unsandboxed_shell_asks_when_no_policy_package_is_loaded", async () => {
    const root = await tempRoot();
    const denied = await runOnce({ packages: [SHELL(root), toolsCoding({ root })], confirm: false });
    assert.equal(denied.confirms, 1);
    assert.equal(existsSync(join(root, "marker.txt")), false, "shell ran without approval");

    const allowed = await runOnce({ packages: [SHELL(root), toolsCoding({ root })], confirm: true });
    assert.equal(allowed.confirms, 1);
    assert.equal(existsSync(join(root, "marker.txt")), true, "approved shell did not run");
  });

  it("in_root_write_does_not_ask", async () => {
    const root = await tempRoot();
    const result = await runOnce({ packages: [oneCall("write", { path: "in.txt", content: "x" }), toolsCoding({ root })], confirm: false });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(join(root, "in.txt")), true);
  });

  it("out_of_root_write_is_hard_denied_not_asked", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", `guard-outside-${Date.now()}.txt`);
    const result = await runOnce({ packages: [oneCall("write", { path: outside, content: "x" }), toolsCoding({ root })], confirm: true });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(outside), false);
    assert.match(result.text, /outside coding roots/);
  });

  it("approval_package_takes_over_the_decision", async () => {
    const root = await tempRoot();
    const result = await runOnce({ packages: [SHELL(root), toolsCoding({ root }), approval({ mode: "auto" })], confirm: false });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(join(root, "marker.txt")), true);
  });

  it("governance_package_takes_over_the_decision", async () => {
    const root = await tempRoot();
    const result = await runOnce({ packages: [SHELL(root), toolsCoding({ root }), governance({ default: "allow" })], confirm: false });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(join(root, "marker.txt")), true);
  });

  it("approval_and_governance_load_together", async () => {
    const root = await tempRoot();
    const result = await runOnce({
      packages: [SHELL(root), approval({ mode: "auto" }), governance({ default: "allow" }), toolsCoding({ root })],
      confirm: false,
    });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(join(root, "marker.txt")), true);
  });

  it("guard_off_adds_no_ask", async () => {
    const root = await tempRoot();
    const result = await runOnce({ packages: [SHELL(root), toolsCoding({ root, guard: "off" })], confirm: false });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(join(root, "marker.txt")), true);
  });

  it("sandboxed_shell_adds_no_ask", async () => {
    // The decision itself: no `shouldAsk` is wired for a sandbox backend, so the handler adds nothing.
    const root = await tempRoot();
    const hook = createHardDenyHook({ targets: createCodingTargets(root, []), readOnly: false });
    const payload = { name: "shell", args: { command: "echo hi" }, effects: ["execute"], callId: "c1", sessionId: "s" } as never;
    assert.equal(await hook(payload), undefined);
    const guarded = createHardDenyHook({ targets: createCodingTargets(root, []), readOnly: false, shouldAsk: () => true });
    assert.deepEqual(await guarded(payload), { ask: UNGUARDED_SHELL_ASK });

    // And the package wires none for `sandbox: "native"`.
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, sandbox: "native" })] });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.package === "@arnilo/prism-tools/coding");
      assert.equal(
        notes.some((note) => note.message.startsWith("shell asks before each command")),
        false,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("load_order_does_not_matter", async () => {
    const root = await tempRoot();
    // `approval` listed before `coding`: the service is read at decision time either way.
    const result = await runOnce({ packages: [SHELL(root), approval({ mode: "auto" }), toolsCoding({ root })], confirm: false });
    assert.equal(result.confirms, 0);
    assert.equal(existsSync(join(root, "marker.txt")), true);
  });

  it("no_ui_suspends_instead_of_running", async () => {
    const root = await tempRoot();
    const result = await runOnce({ packages: [SHELL(root), toolsCoding({ root })], noUi: true });
    assert.equal(result.status, "suspended");
    assert.equal(existsSync(join(root, "marker.txt")), false);
  });

  it("guarded_default_warn_note_is_reworded", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root })] });
    try {
      const note = agent
        .inspect()
        .statusNotes.find((n) => n.package === "@arnilo/prism-tools/coding" && n.level === "warn" && n.message.startsWith("shell asks"));
      assert.equal(note?.message, "shell asks before each command; add @arnilo/prism-extensions/approval or a sandbox to change that");
    } finally {
      await agent.dispose();
    }
  });
});
