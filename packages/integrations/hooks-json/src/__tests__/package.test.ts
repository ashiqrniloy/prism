import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, createMockProvider, PackageLoadError, providerDone, providerTextDelta } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import hooksJsonDefault, { hookCommandHash, hooksJson } from "../index.js";

const node = process.execPath;

describe("@arnilo/prism-hooks-json", () => {
  it("hooks_json_passes_package_conformance", async () => {
    const result = await packageConformance(hooksJsonDefault);
    assert.equal(result.ok, true, result.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.message}`).join("; "));
  });

  it("session_start_maps_to_session_opened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-start-"));
    const marker = join(dir, "started");
    const command = node;
    const args = ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "1")`];
    try {
      const agent = await createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
        packages: [
          hooksJson({
            config: {
              SessionStart: [{ hooks: [{ type: "command", command, args }] }],
              allowCommands: { [command]: hookCommandHash({ type: "command", command, args }) },
            },
          }),
        ],
      });
      const session = await (await agent.session());
      await session.ready();
      for (let attempt = 0; attempt < 40 && !existsSync(marker); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(readFileSync(marker, "utf8"), "1");
      assert.ok(agent.inspect().hooks["session.opened"]);
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unlisted_command_fails_closed_at_load", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "mock", model: "demo" },
          provider: createMockProvider([providerDone()]),
          packages: [hooksJson({ config: { Stop: [{ hooks: [{ type: "command", command: node, args: ["-e", "0"] }] }] } })],
        }),
      (error: unknown) => error instanceof PackageLoadError && error.code === "config_invalid",
    );
  });

  it("hook_command_output_is_redacted", async () => {
    const secret = "hook-secret-should-not-surface-9f3a";
    const previous = process.env.HOOK_SECRET;
    process.env.HOOK_SECRET = secret;
    const source = `process.stdout.write(JSON.stringify({decision:"block",reason:process.env.HOOK_SECRET}))`;
    const command = node;
    const args = ["-e", source];
    try {
      const agent = await createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
        packages: [
          hooksJson({
            config: {
              env: { HOOK_SECRET: "env:HOOK_SECRET" },
              UserPromptSubmit: [{ hooks: [{ type: "command", command, args }] }],
              allowCommands: { [command]: hookCommandHash({ type: "command", command, args }) },
            },
          }),
        ],
      });
      const session = await (await agent.session());
      const events: unknown[] = [];
      const reader = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();
      await session.run("hi").catch(() => undefined);
      await agent.dispose();
      await reader;
      const surface = JSON.stringify(events) + JSON.stringify(agent.inspect());
      assert.equal(surface.includes(secret), false);
    } finally {
      if (previous === undefined) delete process.env.HOOK_SECRET;
      else process.env.HOOK_SECRET = previous;
    }
  });
});
