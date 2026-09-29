import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { AgentSdkConfigError, parseAgentSdkConfig, resolveJsonConfig } from "../index.js";

describe("config", () => {
  describe("parseAgentSdkConfig", () => {
    it("validates valid JSON config shape", () => {
      const valid = {
        workspaceRoot: "/project/dir",
        planes: { coding: true, git: false },
        exclude: ["shell"],
        skills: { enabled: true, workspaceRoot: "/skills" },
        instructions: {
          text: "Be helpful",
          agentsMd: true,
          systemMd: { globalRoot: "/global" },
        },
        hooks: { file: "hooks.json" },
        mcp: {
          servers: [
            {
              serverId: "web",
              command: "bunx",
              args: ["@mcp/web"],
              allow: "stdio",
            },
          ],
        },
        loop: "single-shot",
      };

      const parsed = parseAgentSdkConfig(valid);
      assert.strictEqual(parsed.workspaceRoot, "/project/dir");
      assert.strictEqual(parsed.planes?.coding, true);
      assert.strictEqual(parsed.planes?.git, false);
      assert.deepStrictEqual(parsed.exclude, ["shell"]);
      assert.strictEqual(parsed.skills?.enabled, true);
      assert.strictEqual(parsed.instructions?.text, "Be helpful");
      assert.strictEqual(parsed.hooks?.file, "hooks.json");
      assert.strictEqual(parsed.mcp?.servers.length, 1);
      assert.strictEqual(parsed.loop, "single-shot");
    });

    it("parses raw JSON string", () => {
      const jsonStr = JSON.stringify({
        workspaceRoot: "/test",
        planes: { coding: true },
      });
      const parsed = parseAgentSdkConfig(jsonStr);
      assert.strictEqual(parsed.workspaceRoot, "/test");
      assert.strictEqual(parsed.planes?.coding, true);
    });

    it("rejects invalid JSON syntax", () => {
      assert.throws(
        () => parseAgentSdkConfig("{ not valid json }"),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes("invalid JSON configuration"));
          return true;
        },
      );
    });

    it("rejects non-object configurations", () => {
      assert.throws(
        () => parseAgentSdkConfig(null),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes("must be a JSON object"));
          return true;
        },
      );
      assert.throws(
        () => parseAgentSdkConfig([1, 2]),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          return true;
        },
      );
    });

    it("rejects model key in JSON form with explicit error", () => {
      assert.throws(
        () =>
          parseAgentSdkConfig({
            model: { provider: "anthropic", model: "claude" },
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes("model"));
          assert.ok(err.message.includes("programmatically"));
          return true;
        },
      );
    });

    it("rejects provider key in JSON form with explicit error", () => {
      assert.throws(
        () =>
          parseAgentSdkConfig({
            provider: {},
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes("provider"));
          assert.ok(err.message.includes("programmatically"));
          return true;
        },
      );
    });

    it("rejects unknown keys at root naming the key path", () => {
      assert.throws(
        () =>
          parseAgentSdkConfig({
            badRootKey: 123,
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('unknown key "badRootKey"'));
          return true;
        },
      );
    });

    it("rejects unknown keys in nested objects naming the full key path", () => {
      assert.throws(
        () =>
          parseAgentSdkConfig({
            planes: { badPlane: true },
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('unknown key "planes.badPlane"'));
          return true;
        },
      );

      assert.throws(
        () =>
          parseAgentSdkConfig({
            skills: { unknownSkillField: true },
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('unknown key "skills.unknownSkillField"'));
          return true;
        },
      );

      assert.throws(
        () =>
          parseAgentSdkConfig({
            mcp: {
              servers: [
                {
                  serverId: "test",
                  allow: "stdio",
                  command: "bunx",
                  badServerField: true,
                },
              ],
            },
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('unknown key "mcp.servers[0].badServerField"'));
          return true;
        },
      );
    });

    it("rejects wrong types naming the key path", () => {
      assert.throws(
        () =>
          parseAgentSdkConfig({
            exclude: "not-an-array",
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('expected array of strings for "exclude"'));
          return true;
        },
      );

      assert.throws(
        () =>
          parseAgentSdkConfig({
            exclude: [123],
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('expected string for "exclude[0]"'));
          return true;
        },
      );

      assert.throws(
        () =>
          parseAgentSdkConfig({
            hooks: { file: 123 },
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('expected non-empty string for "hooks.file"'));
          return true;
        },
      );

      assert.throws(
        () =>
          parseAgentSdkConfig({
            planes: { coding: "not-a-bool" },
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes('expected boolean for "planes.coding"'));
          return true;
        },
      );
    });
  });

  describe("resolveJsonConfig", () => {
    it("converts JSON config into merged AgentSdkConfig", () => {
      const json = parseAgentSdkConfig({
        workspaceRoot: "/app/root",
        planes: { coding: true, git: true },
        exclude: ["shell"],
        skills: { enabled: true },
        instructions: { text: "App prompt" },
      });

      const resolved = resolveJsonConfig(json, { cwd: "/default/cwd" });

      assert.strictEqual(resolved.workspaceRoot, "/app/root");
      assert.ok(resolved.tools?.planes?.coding);
      assert.ok(resolved.tools?.planes?.git);
      assert.deepStrictEqual(resolved.tools?.exclude, ["shell"]);
      assert.strictEqual(resolved.skills?.workspaceRoot, "/app/root");
      assert.deepStrictEqual(resolved.instructions, {
        agentsMd: true,
        text: "App prompt",
      });
    });
  });
});
