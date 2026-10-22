import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "@arnilo/prism";
import toolsCoding from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-sandbox-config-"));
  dirs.push(dir);
  return dir;
}

describe("tools-coding sandbox config", () => {
  it("sandbox_e2b_missing_gives_note_not_throw", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, sandbox: "e2b" })] });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name === "shell"),
        false,
        "shell must not register without a backend",
      );
      assert.equal(
        agent.tools.some((tool) => tool.name === "read"),
        true,
        "file tools stay available",
      );
      const notes = agent.inspect().statusNotes;
      assert.ok(
        notes.some((note) => note.package === "@arnilo/prism-tools-coding" && note.level === "warn"),
        `expected a warn note, got ${JSON.stringify(notes)}`,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("sandbox_docker_fails_closed_without_host_wiring", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, sandbox: "docker" })] });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name === "shell"),
        false,
      );
      assert.ok(agent.inspect().statusNotes.some((note) => note.level === "warn"));
    } finally {
      await agent.dispose();
    }
  });

  it("sandbox_unknown_kind_fails_closed", async () => {
    const root = await tempRoot();
    await assert.rejects(
      createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, sandbox: "vm" } as never)] }),
      /sandbox/,
    );
  });

  it("egress_config_is_validated", async () => {
    const root = await tempRoot();
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsCoding({ root, egress: { presets: ["bogus" as never] } })],
      }),
      /egress/,
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, egress: { allow: [{ host: "registry.npmjs.org", port: 443 }] } })],
    });
    try {
      assert.ok(agent.inspect().statusNotes.some((note) => note.level === "warn" && /egress/.test(note.message)));
    } finally {
      await agent.dispose();
    }
  });
});
