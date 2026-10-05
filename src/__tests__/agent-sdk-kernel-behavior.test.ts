import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, createMemorySessionStore, type LoopStrategy, type ProviderRequest, providerDone, providerTextDelta } from "../index.js";
import { mockProvider, createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

/**
 * Kernel behavior that `@arnilo/prism-agent-sdk`'s `defineAgent` tests used to cover through the SDK
 * (plan 149 Task 6, per plan 148 Task 1(j)). The cases keep their original names and now run against
 * `createAgent` directly: the SDK is frozen and the kernel owns these guarantees.
 */

const defaultModel = { provider: "mock", model: "mock-model" } as const;

async function skillsDir(skill: string, description: string, body: string): Promise<{ readonly root: string; readonly dir: string }> {
  const root = await mkdtemp(join(tmpdir(), "prism-kernel-skills-"));
  const dir = join(root, ".agents", "skills");
  await mkdir(join(dir, skill), { recursive: true });
  await writeFile(join(dir, skill, "SKILL.md"), `---\nname: ${skill}\ndescription: ${description}\n---\n${body}\n`, "utf8");
  return { root, dir };
}

describe("kernel behavior moved from the agent SDK", () => {
  it("skills plane: discovered skills render in prompt catalog on first run without activeSkills (regression)", async () => {
    const { root, dir } = await skillsDir("active-skill", "renders in catalog", "Active body");
    try {
      const requests: ProviderRequest[] = [];
      const agent = await createAgent({
        model: defaultModel,
        packages: [providerPackage("test-provider", [{
          id: "mock",
          async *generate(request: ProviderRequest) {
            requests.push(request);
            yield providerTextDelta("done");
            yield providerDone();
          },
        }])],
        skills: { dirs: [dir] },
      });
      await (await agent.session()).run("Test message");

      assert.equal(requests.length, 1);
      const text = (requests[0]?.messages ?? [])
        .flatMap((message) => message.content)
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
      assert.match(text, /Skill active-skill: renders in catalog/);
      assert.equal(text.includes("Active body"), false, "progressive disclosure keeps the body out of the first turn");
      assert.ok(
        requests[0]?.tools?.some((tool) => tool.name === "load_skill"),
        "the load_skill bridge is advertised",
      );
      assert.deepEqual(
        agent.skills.map((skill) => skill.name),
        ["active-skill"],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("progressive disclosure: load_skill loads a body the first turn left out", async () => {
    const { root, dir } = await skillsDir("linter", "Project linter skill", "You must run linter before saving any code.");
    try {
      const requests: ProviderRequest[] = [];
      let turn = 0;
      const agent = await createAgent({
        model: defaultModel,
        packages: [providerPackage("test-provider", [{
          id: "mock",
          async *generate(request: ProviderRequest) {
            requests.push(request);
            turn += 1;
            if (turn === 1) {
              yield {
                type: "tool_call" as const,
                call: { type: "tool_call" as const, id: "call-1", name: "load_skill", arguments: { name: "linter" } },
              };
              yield providerDone();
              return;
            }
            yield providerTextDelta("done");
            yield providerDone();
          },
        }])],
        skills: { dirs: [dir] },
      });
      const result = await (await agent.session()).run("lint it");
      assert.equal(result.status, "completed");
      assert.equal(requests.length, 2);
      const flat = (request: ProviderRequest | undefined) => JSON.stringify(request?.messages);
      assert.equal(flat(requests[0]).includes("run linter before saving"), false, "turn 1 carries the catalog entry, not the body");
      assert.equal(flat(requests[1]).includes("run linter before saving"), true, "turn 2 carries the body load_skill returned");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("agent loop slot reaches the run path", async () => {
    let customLoopInvoked = false;
    const customLoop: LoopStrategy = {
      name: "custom-test-loop",
      async run(run) {
        customLoopInvoked = true;
        await run.turn();
      },
    };
    const agent = await createAgent({
      model: defaultModel,
      packages: [mockProvider([[providerTextDelta("hello"), providerDone()]])],
      slots: { loop: customLoop },
    });
    await (await agent.session()).run("test");
    assert.equal(customLoopInvoked, true);
    await agent.dispose();
  });

  it("principal is optional and no identity is synthesized", async () => {
    const agent = await createAgent({ model: defaultModel, packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])] });
    assert.equal(agent.config.principal, undefined);
    assert.equal("identity" in agent.config, false);
    assert.equal((await (await agent.session()).run("hi")).text, "ok");
    await agent.dispose();
  });

  it("opaque principal passes through by reference", async () => {
    const principal = { kind: "service" as const, id: "svc-1" };
    const agent = await createAgent({
      model: defaultModel,
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
      principal,
    });
    assert.strictEqual(agent.config.principal, principal);
    await agent.dispose();
  });

  it('store omitted and "memory" both use the in-memory default', async () => {
    const make = () => createMockProvider([providerTextDelta("a"), providerDone(), providerTextDelta("b"), providerDone()]);
    const omitted = await createAgent({ model: defaultModel, packages: [providerPackage("test-provider", [make()])] });
    const explicit = await createAgent({ model: defaultModel, packages: [providerPackage("test-provider", [make()])], slots: { store: createMemorySessionStore() } });
    for (const agent of [omitted, explicit]) {
      const first = await agent.session({ id: "s", create: true });
      assert.equal((await first.run("hi")).status, "completed");
      // The default store is real: a later session resumes what the first wrote.
      const again = await agent.session({ id: "s" });
      assert.equal((await again.messages()).length, 2);
      await agent.dispose();
    }
    assert.equal(omitted.config.slots?.store, undefined);
  });

  it("registerHooks fire at run end with no session.run wrapper", async () => {
    const calls: string[] = [];
    const agent = await createAgent({
      model: defaultModel,
      packages: [mockProvider([[providerTextDelta("done"), providerDone()]])],
      hooks: (hooks) =>
        hooks.on(
          "run.end",
          () => {
            calls.push("probe:decide");
            return undefined;
          },
          { id: "probe" },
        ),
    });
    const session = await agent.session();
    const result = await session.run("hi");
    assert.equal(result.status, "completed");
    assert.deepEqual(calls, ["probe:decide"]);
    await agent.dispose();
  });

  it("run.end continuation: the first continue wins and the run goes on once", async () => {
    let ends = 0;
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model: defaultModel,
      packages: [providerPackage("test-provider", [{
        id: "mock",
        async *generate(request: ProviderRequest) {
          requests.push(request);
          yield providerTextDelta(`turn ${requests.length}`);
          yield providerDone();
        },
      }])],
      hooks: (hooks) =>
        hooks.on("run.end", () => {
          ends += 1;
          return ends === 1 ? { continue: { reason: "keep going" } } : undefined;
        }),
    });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(requests.length, 2, "one continuation, then the second run.end stops");
    assert.equal(JSON.stringify(requests[1]?.messages).includes("keep going"), true);
  });
});
