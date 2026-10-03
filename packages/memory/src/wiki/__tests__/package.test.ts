import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { wiki } from "../index.js";

describe("wiki package", () => {
  it("wiki_passes_package_conformance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-wiki-conf-"));
    try {
      const result = await packageConformance(wiki({ workspaceRoot: dir, autoDeploySkills: false }));
      assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_package_rejects_private_url", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-wiki-ssrf-"));
    let calls = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [
        wiki({
          workspaceRoot: dir,
          autoDeploySkills: false,
          fetchUrl: async () => {
            calls += 1;
            return { text: "should not run" };
          },
        }),
      ],
    });
    try {
      await assert.rejects(() => agent.commands.run("wiki-ingest", { url: "http://127.0.0.1/private" }), /ssrf|rejected|public/i);
      assert.equal(calls, 0);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
