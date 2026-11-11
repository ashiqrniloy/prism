import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeSystemPrompt, createPathTrustPolicy, createStaticTrustPolicy } from "@arnilo/prism";
import { readContextFileLayers } from "../layers.js";

void describe("context file layers (moved from the kernel prompt-file loader)", () => {
  it("loads workspace AGENTS.md as an app-source append contribution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prism-sp-"));
    await writeFile(join(dir, "AGENTS.md"), "Project rule.");

    const layers = await readContextFileLayers({ workspaceRoot: dir });

    assert.deepEqual(layers, [{ id: "agents-md", source: "app", mode: "append", text: "Project rule." }]);
  });

  it("no roots → empty list and no filesystem access (standalone escape hatch)", async () => {
    const layers = await readContextFileLayers({});
    assert.deepEqual(layers, []);
  });

  it("loads both SYSTEM.md (user) and AGENTS.md (app) in rank order", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "prism-sp-ws-"));
    const global = await mkdtemp(join(tmpdir(), "prism-sp-glob-"));
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "PROJECT");
    const trust = createPathTrustPolicy({ trustedRoots: [workspace] });

    const layers = await readContextFileLayers({ workspaceRoot: workspace, globalRoot: global, trust });

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
    const trust = createStaticTrustPolicy(false);

    const layers = await readContextFileLayers({ workspaceRoot: workspace, globalRoot: global, trust });

    assert.deepEqual(layers, [{ id: "system-md", source: "user", mode: "append", text: "GLOBAL" }]);
  });

  it("trusted workspace loads AGENTS.md (trust gate passes)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "prism-sp-trusted-"));
    await writeFile(join(workspace, "AGENTS.md"), "Trusted project rule.");
    const trust = createStaticTrustPolicy(true);

    const layers = await readContextFileLayers({ workspaceRoot: workspace, trust });

    assert.deepEqual(layers, [{ id: "agents-md", source: "app", mode: "append", text: "Trusted project rule." }]);
  });

  it("override paths load from the named files with the same source tags", async () => {
    const customDir = await mkdtemp(join(tmpdir(), "prism-sp-override-"));
    await writeFile(join(customDir, "my-agents.md"), "Custom project rule.");
    await writeFile(join(customDir, "my-system.md"), "Custom global rule.");
    const trust = createPathTrustPolicy({ trustedRoots: [customDir] });

    const layers = await readContextFileLayers({
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

    const layers = await readContextFileLayers({ workspaceRoot: workspace, globalRoot: global });

    assert.deepEqual(layers, []);
  });

  it("an override outside trusted roots is skipped (still trust-gated)", async () => {
    const trusted = await mkdtemp(join(tmpdir(), "prism-sp-trusteddir-"));
    const untrusted = await mkdtemp(join(tmpdir(), "prism-sp-untrusteddir-"));
    await writeFile(join(untrusted, "rogue.md"), "Rogue project rule.");
    const trust = createPathTrustPolicy({ trustedRoots: [trusted] });

    const layers = await readContextFileLayers({ agentsMdPath: join(untrusted, "rogue.md"), trust });

    assert.deepEqual(layers, []);
  });

  // Security boundaries moved with the loader (plan 079 Task 5).
  it("never executes discovered modules", () => {
    const loaderText = readFileSync(new URL("../layers.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.equal(/\bimport\s*\(/.test(loaderText), false, "loader uses dynamic import() — code execution risk");
    assert.equal(/\beval\s*\(/.test(loaderText), false, "loader uses eval() — code execution risk");
  });

  it("loader output is redactable like any system instruction", async () => {
    const secret = "phase31-leak-token-xyz";
    const workspace = await mkdtemp(join(tmpdir(), "prism-prompt-bnd-secret-"));
    await writeFile(join(workspace, "AGENTS.md"), `Project rule. token=${secret}`);
    const layers = await readContextFileLayers({
      workspaceRoot: workspace,
      trust: createPathTrustPolicy({ trustedRoots: [workspace] }),
    });
    assert.ok(
      layers.some((layer) => layer.text.includes(secret)),
      "loader did not emit AGENTS.md text containing the secret",
    );
  });
});
