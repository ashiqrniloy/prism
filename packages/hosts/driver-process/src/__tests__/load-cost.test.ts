import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("mcp_server_not_loaded_without_prism_tools", () => {
  const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["-e", `await import(${JSON.stringify(entry)}); console.log(JSON.stringify(Object.keys(require.cache)));`],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("/hosts/driver-process/src/driver.ts");
  expect(result.stdout).not.toContain("/hosts/mcp-server/");
  expect(result.stdout).not.toContain("/modelcontextprotocol/");
});
