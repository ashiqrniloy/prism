import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, type ProviderRequest } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider, packageConformance, providerDone } from "@arnilo/prism/testing";
import contextFiles, { contextFiles as files, readContextFileLayers } from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-context-files-"));
  dirs.push(dir);
  return dir;
}

/** A mock provider that records every request, so the assembled system prompt is observable. */
function capturingProvider(captured: ProviderRequest[]) {
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => {
      captured.push(request);
    },
  });
  return providerPackage("capture-provider", [provider]);
}

function systemText(request: ProviderRequest | undefined): string {
  const first = request?.messages[0];
  const text = first?.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n") ?? "";
  return text.replace(/^System instruction:\n/, "");
}

describe("@arnilo/prism-extensions/context-files package", () => {
  it("context_files_package_conformance", async () => {
    const root = await tempRoot();
    const result = await packageConformance(files({ root }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("context_files_layers_in_rank_order", async () => {
    const root = await tempRoot();
    const global = await tempRoot();
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(root, "AGENTS.md"), "PROJECT");

    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root, globalRoot: global })],
      instructions: "BASE",
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]), "BASE\n\nGLOBAL\n\nPROJECT");
    } finally {
      await agent.dispose();
    }
  });

  it("context_files_never_writes_store", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "AGENTS.md"), "SECRET-LAYER-TEXT");
    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root })],
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]).includes("SECRET-LAYER-TEXT"), true, "the layer did not reach the provider");
      const persisted = JSON.stringify(session.messages());
      assert.equal(persisted.includes("SECRET-LAYER-TEXT"), false, "a context layer reached the stored transcript");
    } finally {
      await agent.dispose();
    }
  });

  it("context_files_no_home_scan_by_default", async () => {
    const home = await tempRoot();
    await mkdir(join(home, ".prism", "agent"), { recursive: true });
    await writeFile(join(home, ".prism", "agent", "SYSTEM.md"), "HOME-SHOULD-NOT-LOAD");
    await writeFile(join(home, "AGENTS.md"), "HOME-DIR-AGENTS");
    const root = await tempRoot();
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // Without `globalRoot` nothing under the home directory is even a candidate path.
      const withRoot = await readContextFileLayers({ workspaceRoot: root });
      const withoutRoots = await readContextFileLayers({});
      assert.deepEqual(withRoot, []);
      assert.deepEqual(withoutRoots, []);

      const captured: ProviderRequest[] = [];
      const agent = await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [capturingProvider(captured), contextFiles({ root })],
      });
      const session = await agent.session();
      try {
        await session.run("hi");
        assert.equal(systemText(captured[0]).includes("HOME"), false, "a home-directory file was read");
      } finally {
        await agent.dispose();
      }
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("context_files_untrusted_symlink_skipped_with_note", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(join(outside, "rogue.md"), "ROGUE-LAYER");
    await symlink(join(outside, "rogue.md"), join(root, "AGENTS.md"));

    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root })],
      instructions: "BASE",
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]), "BASE", "a symlink escaping the trusted root was loaded");
      const notes = agent.inspect().statusNotes ?? [];
      assert.ok(
        notes.some((note) => note.level === "warn" && note.message.includes(join(root, "AGENTS.md"))),
        `no warn note naming the skipped path: ${JSON.stringify(notes)}`,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("context_files_disable_hook_removes_layers", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "AGENTS.md"), "PROJECT");
    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root })],
      instructions: "BASE",
      disable: { hooks: ["@arnilo/prism-extensions/context-files:context.build"] },
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]), "BASE");
      assert.deepEqual(agent.inspect().disabled.hooks, ["@arnilo/prism-extensions/context-files:context.build"]);
    } finally {
      await agent.dispose();
    }
  });

  it("context_files_reads_once_per_session", async () => {
    const root = await tempRoot();
    const agentsMd = join(root, "AGENTS.md");
    await writeFile(agentsMd, "PROJECT-ONE");
    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root })],
      instructions: "BASE",
    });
    const session = await agent.session();
    try {
      await session.run("first");
      assert.equal(systemText(captured[0]), "BASE\n\nPROJECT-ONE");
      const { mtimeMs } = await statMtime(agentsMd);
      // New content, same mtime: a re-read would see PROJECT-TWO, so unchanged output proves the cache held.
      await writeFile(agentsMd, "PROJECT-TWO");
      await utimes(agentsMd, new Date(0), new Date(mtimeMs));
      await session.run("second");
      assert.equal(systemText(captured[1]), "BASE\n\nPROJECT-ONE", "the layer was re-read inside one session");

      // A real mtime change refreshes it on the next run.
      await utimes(agentsMd, new Date(0), new Date(mtimeMs + 5_000));
      await session.run("third");
      assert.equal(systemText(captured[2]), "BASE\n\nPROJECT-TWO", "a changed mtime did not refresh the cache");
    } finally {
      await agent.dispose();
    }
  });

  it("context_files_missing_root_fails_closed", async () => {
    await assert.rejects(
      async () => await createAgent({ model: { provider: "mock", model: "m" }, packages: [contextFiles({})] }),
      /prism-extensions\/context-files: config needs root/,
    );
  });

  it("explicit files load as app layers and are trusted by being named", async () => {
    const root = await tempRoot();
    const extra = await tempRoot();
    await writeFile(join(root, "AGENTS.md"), "PROJECT");
    await writeFile(join(extra, "EXTRA.md"), "EXTRA");
    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root, files: [join(extra, "EXTRA.md")] })],
      instructions: "BASE",
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]), "BASE\n\nPROJECT\n\nEXTRA");
    } finally {
      await agent.dispose();
    }
  });
});

async function statMtime(path: string): Promise<{ mtimeMs: number }> {
  const { stat } = await import("node:fs/promises");
  return await stat(path);
}
