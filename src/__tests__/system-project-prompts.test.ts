import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadSystemPromptFiles } from "../node/system-project-prompts.js";
import { composeSystemPrompt } from "../system-prompts.js";
import { createStaticTrustPolicy } from "../security.js";
import { createPathTrustPolicy } from "../node/trust.js";

void describe("system/project prompt files loader", () => {
  // ponytail: one self-check — exercises the AGENTS.md read path. Full trust/disable/
  // SYSTEM.md/redaction coverage lives in Task 5 (cli-system-project-prompts + extensions).
  it("loads workspace AGENTS.md as an app-source append contribution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prism-sp-"));
    await writeFile(join(dir, "AGENTS.md"), "Project rule.");

    const layers = await loadSystemPromptFiles({ workspaceRoot: dir });

    assert.deepEqual(layers, [
      { id: "agents-md", source: "app", mode: "append", text: "Project rule." },
    ]);
  });

  it("no roots → empty list and no filesystem access (SDK escape hatch)", async () => {
    const layers = await loadSystemPromptFiles({});
    assert.deepEqual(layers, []);
  });

  it("loads both SYSTEM.md (user) and AGENTS.md (app) in rank order (Phase 31 layering)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "prism-sp-ws-"));
    const global = await mkdtemp(join(tmpdir(), "prism-sp-glob-"));
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "PROJECT");
    const trust = createPathTrustPolicy({ trustedRoots: [workspace] });

    const layers = await loadSystemPromptFiles({ workspaceRoot: workspace, globalRoot: global, trust });

    assert.deepEqual(layers, [
      { id: "system-md", source: "user", mode: "append", text: "GLOBAL" },
      { id: "agents-md", source: "app", mode: "append", text: "PROJECT" },
    ]);

    // Composed with base instructions: base → user (GLOBAL) → app (PROJECT). Rank order enforced by composeSystemPrompt.
    assert.equal(composeSystemPrompt(layers, { base: "BASE" }), "BASE\n\nGLOBAL\n\nPROJECT");
  });

  it("untrusted workspace AGENTS.md contributes nothing (fail-closed); SYSTEM.md still loads", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "prism-sp-untrusted-"));
    const global = await mkdtemp(join(tmpdir(), "prism-sp-untrusted-glob-"));
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "SHOULD NOT LOAD");
    const trust = createStaticTrustPolicy(false); // ponytail: trust=static false — workspace not trusted.

    const layers = await loadSystemPromptFiles({ workspaceRoot: workspace, globalRoot: global, trust });

    assert.deepEqual(layers, [
      { id: "system-md", source: "user", mode: "append", text: "GLOBAL" },
    ]);
  });

  it("trusted workspace loads AGENTS.md (trust gate passes)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "prism-sp-trusted-"));
    await writeFile(join(workspace, "AGENTS.md"), "Trusted project rule.");
    const trust = createStaticTrustPolicy(true);

    const layers = await loadSystemPromptFiles({ workspaceRoot: workspace, trust });

    assert.deepEqual(layers, [
      { id: "agents-md", source: "app", mode: "append", text: "Trusted project rule." },
    ]);
  });

  it("override paths (--agents-md-file / --system-md-file) load from the named files with same source tags", async () => {
    const customDir = await mkdtemp(join(tmpdir(), "prism-sp-override-"));
    await writeFile(join(customDir, "my-agents.md"), "Custom project rule.");
    await writeFile(join(customDir, "my-system.md"), "Custom global rule.");
    // ponytail: override path trust handled by caller (CLI adds the file's parent to trustedRoots);
    // here we trust the custom dir so the agents override passes the gate.
    const trust = createPathTrustPolicy({ trustedRoots: [customDir] });

    const layers = await loadSystemPromptFiles({
      agentsMdPath: join(customDir, "my-agents.md"),
      systemMdPath: join(customDir, "my-system.md"),
      trust,
    });

    assert.deepEqual(layers, [
      { id: "system-md", source: "user", mode: "append", text: "Custom global rule." },
      { id: "agents-md", source: "app", mode: "append", text: "Custom project rule." },
    ]);
  });

  it("missing files are ENOENT-skipped (no error, empty list)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "prism-sp-empty-ws-"));
    const global = await mkdtemp(join(tmpdir(), "prism-sp-empty-glob-"));

    const layers = await loadSystemPromptFiles({ workspaceRoot: workspace, globalRoot: global });

    assert.deepEqual(layers, []);
  });

  it("--agents-md-file outside trusted roots is skipped (override still trust-gated)", async () => {
    const trusted = await mkdtemp(join(tmpdir(), "prism-sp-trusteddir-"));
    const untrusted = await mkdtemp(join(tmpdir(), "prism-sp-untrusteddir-"));
    await writeFile(join(untrusted, "rogue.md"), "Rogue project rule.");
    const trust = createPathTrustPolicy({ trustedRoots: [trusted] });

    const layers = await loadSystemPromptFiles({ agentsMdPath: join(untrusted, "rogue.md"), trust });

    assert.deepEqual(layers, []);
  });
});
