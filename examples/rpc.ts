import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// RPC public surface: strict LF-delimited JSONL. Clients correlate responses by
// id and receive async events. Uses the built-in `mock` provider — network-free.
const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

export function demo() {
  const request = JSON.stringify({ id: "1", command: "prompt", params: { input: "Hi" } }) + "\n";
  const result = spawnSync(process.execPath, [bin, "--provider", "mock", "--model", "demo", "--mode", "rpc"], {
    input: request,
    encoding: "utf8",
  });

  const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as { id?: string; ok?: boolean; type?: string });
  return {
    ok: result.status === 0,
    correlated: lines.some((line) => line.id === "1" && line.ok === true),
  };
}

// Runnable end-to-end demo: `node examples/rpc.ts` drives the `prism` bin in
// rpc mode with a single JSONL prompt request against the mock provider.
export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
