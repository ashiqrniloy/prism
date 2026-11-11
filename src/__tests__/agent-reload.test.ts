import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import {
  AgentDisposedError,
  createAgent,
  definePackage,
  providerDone,
  providerTextDelta,
  type AgentEvent,
  type ModelProvider,
} from "../index.js";
import { mockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

const model = { provider: "mock", model: "mock-model" } as const;

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "prism-reload-"));
}

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${description}\n`, "utf8");
}

describe("agent.reload", () => {
  it("re-reads host skills.dirs and keeps an open session usable", async () => {
    const root = await tempRoot();
    const dir = join(root, "skills");
    await writeSkill(dir, "first", "first version");
    try {
      const agent = await createAgent({
        model,
        packages: [
          mockProvider([
            [providerTextDelta("one"), providerDone()],
            [providerTextDelta("two"), providerDone()],
          ]),
        ],
        skills: { dirs: [dir] },
      });
      const session = await agent.session();
      assert.equal((await session.run("first")).text, "one");
      assert.deepEqual(
        agent.skills.map((skill) => [skill.name, skill.description]),
        [["first", "first version"]],
      );

      await writeSkill(dir, "first", "second version");
      await writeSkill(dir, "second", "new skill");
      await agent.reload();

      assert.deepEqual(
        agent.skills.map((skill) => [skill.name, skill.description]),
        [
          ["first", "second version"],
          ["second", "new skill"],
        ],
      );
      assert.equal((await session.run("second")).text, "two", "the open session continues after reload");
      await agent.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-runs package setup so a package re-discovers its own skill directory", async () => {
    const root = await tempRoot();
    const dir = join(root, "skills");
    await writeSkill(dir, "dynamic", "before reload");
    let setups = 0;
    const dynamic = definePackage({
      name: "@acme/dynamic-skills",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        setups += 1;
        prism.skills.addDir(dir);
      },
    });
    try {
      const agent = await createAgent({ model, packages: [dynamic, mockProvider([[providerTextDelta("ok"), providerDone()]])] });
      assert.equal(setups, 1);
      assert.deepEqual(
        agent.skills.map((skill) => skill.description),
        ["before reload"],
      );

      await writeSkill(dir, "dynamic", "after reload");
      await writeSkill(dir, "added", "added after reload");
      await agent.reload();

      assert.equal(setups, 2, "package setup ran again");
      assert.deepEqual(
        agent.skills.map((skill) => [skill.name, skill.description]),
        [
          ["added", "added after reload"],
          ["dynamic", "after reload"],
        ],
      );
      await agent.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-compiles AgentConfig.hooks onto a fresh bus", async () => {
    const seen: string[] = [];
    let compiled = "first";
    const agent = await createAgent({
      model,
      packages: [
        mockProvider([
          [providerTextDelta("one"), providerDone()],
          [providerTextDelta("two"), providerDone()],
        ]),
      ],
      hooks: (hooks) => {
        const version = compiled;
        hooks.on("run.started", () => {
          seen.push(version);
        });
      },
    });
    const session = await agent.session();
    await session.run("one");
    compiled = "second";
    await agent.reload();
    await session.run("two");
    assert.deepEqual(seen, ["first", "second"]);
    await agent.dispose();
  });

  it("rejects on a failed assembly and keeps the committed runtime", async () => {
    const root = await tempRoot();
    const dir = join(root, "skills");
    await writeSkill(dir, "stable", "still here");
    let setups = 0;
    const flaky = definePackage({
      name: "@acme/flaky",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        setups += 1;
        if (setups > 1) throw new Error("reload failed");
        prism.skills.addDir(dir);
      },
    });
    try {
      const agent = await createAgent({ model, packages: [flaky, mockProvider([[providerTextDelta("ok"), providerDone()]])] });
      await assert.rejects(agent.reload(), /reload failed/);
      assert.equal(setups, 2);
      assert.deepEqual(
        agent.skills.map((skill) => skill.name),
        ["stable"],
        "old package contributions survive",
      );
      assert.equal((await (await agent.session()).run("still works")).text, "ok");
      await agent.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects while a session run is active", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: ModelProvider = {
      id: "mock",
      async *generate() {
        await gate;
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const agent = await createAgent({ model, packages: [providerPackage("slow-provider", [slow])] });
    const running = (await agent.session()).run("hi");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await assert.rejects(agent.reload(), /session run is active/);
    release();
    assert.equal((await running).text, "ok");
    await agent.dispose();
  });

  it("serializes concurrent reloads and rejects after dispose", async () => {
    let setups = 0;
    const counted = definePackage({
      name: "@acme/counted",
      version: "1.0.0",
      requires: { api: 1 },
      setup() {
        setups += 1;
      },
    });
    const agent = await createAgent({ model, packages: [counted, mockProvider([[providerTextDelta("ok"), providerDone()]])] });
    await Promise.all([agent.reload(), agent.reload()]);
    assert.equal(setups, 2, "one shared reload ran after the initial setup");
    await agent.dispose();
    await assert.rejects(agent.reload(), (error) => error instanceof AgentDisposedError);
  });

  it("reloads package hooks and keeps the event sink routed to the live session", async () => {
    const events: AgentEvent[] = [];
    let registrations = 0;
    const agent = await createAgent({
      model,
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
      hooks: (hooks) => {
        registrations += 1;
        hooks.on("turn.started", () => undefined);
      },
    });
    const session = await agent.session();
    const drain = (async () => {
      for await (const event of session.subscribe({ acrossRuns: true })) {
        events.push(event);
        if (event.type === "run.completed") return;
      }
    })();
    await session.run("hi");
    await drain;
    assert.equal(registrations, 1);
    await agent.reload();
    assert.equal(registrations, 2);
    assert.ok(agent.inspect().hooks["turn.started"]?.some((entry) => entry.owner === "host"));
    assert.ok(events.some((event) => event.type === "run.completed"));
    await agent.dispose();
  });
});
