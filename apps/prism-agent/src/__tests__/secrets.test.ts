import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone } from "@arnilo/prism/testing";
import { createResearchWorker, type HostConfig, HostStartError, loadHostConfig, startAgent } from "../host/index.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
const PLANTED = "planted-secret-value-9f3a";
const LITERAL = "sk-planted-literal-9f3a";

function base(root: string, web: HostConfig["web"]): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: root,
    approval: "ask",
    web,
  };
}

test("host_secret_never_leaks", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-secret-"));
  const previous = process.env.PRISM_AGENT_PLANTED;
  process.env.PRISM_AGENT_PLANTED = PLANTED;
  try {
    const agent = await createResearchWorker(base(root, { backend: "brave", apiKey: "env:PRISM_AGENT_PLANTED" }), {
      packages: [mockProvider([[providerDone()]])],
    });
    try {
      const session = await agent.session({ create: true });
      await session.run("noop");
      const blob = JSON.stringify(agent.inspect());
      assert.equal(blob.includes(PLANTED), false);
      assert.equal(blob.includes("env:PRISM_AGENT_PLANTED"), true);
    } finally {
      await agent.dispose();
    }
    const db = readFileSync(join(root, "sessions.db"));
    assert.equal(db.includes(PLANTED), false);
  } finally {
    if (previous === undefined) delete process.env.PRISM_AGENT_PLANTED;
    else process.env.PRISM_AGENT_PLANTED = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("literal_secret_in_host_config_rejected_by_package", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-literal-"));
  try {
    const path = join(root, "prism-agent.json");
    writeFileSync(path, JSON.stringify(base(root, { backend: "brave", apiKey: LITERAL })));
    const loaded = loadHostConfig(path);
    assert.equal(loaded.web.apiKey, LITERAL, "the host passes a literal through");
    await assert.rejects(
      () => startAgent(() => createResearchWorker(loaded, { packages: [mockProvider([[providerDone()]])] })),
      (error: unknown) => {
        assert.ok(error instanceof HostStartError);
        assert.equal(error.exitCode, 2);
        assert.match(error.message, /env: or keyring:/);
        assert.equal(error.message.includes(LITERAL), false);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
