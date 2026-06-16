import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultUserConfigPath, loadConfigFiles, readConfigFile } from "../node/config.js";

async function tempFile(name: string, text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-config-"));
  const path = join(dir, name);
  await writeFile(path, text, "utf8");
  return path;
}

describe("node config loader", () => {
  it("default user config path uses config prism config json", () => {
    assert.match(defaultUserConfigPath(), /\.config[/\\]prism[/\\]config\.json$/);
  });

  it("loads config files from explicit paths", async () => {
    const path = await tempFile("config.json", JSON.stringify({ demo: { enabled: true } }));

    assert.deepEqual(await loadConfigFiles([{ name: "user", path }]), [
      { name: "user", config: { demo: { enabled: true } } },
    ]);
  });

  it("skips optional missing files", async () => {
    const missing = join(tmpdir(), `missing-prism-${Date.now()}.json`);

    assert.deepEqual(await loadConfigFiles([{ name: "user", path: missing, optional: true }]), []);
  });

  it("rejects invalid json or non object config", async () => {
    const invalid = await tempFile("invalid.json", "{");
    const array = await tempFile("array.json", "[]");

    await assert.rejects(() => readConfigFile(invalid), /Invalid JSON config/);
    await assert.rejects(() => readConfigFile(array), /must be a JSON object/);
  });

  it("node config subpath is declared in package exports", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { exports: Record<string, unknown> };

    assert.deepEqual(packageJson.exports["./node/config"], {
      types: "./dist/node/config.d.ts",
      default: "./dist/node/config.js",
    });
  });
});
