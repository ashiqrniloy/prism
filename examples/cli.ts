import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// CLI public surface is the `prism` bin (print/json/rpc), an adapter over the
// AgentSession API. Uses the built-in `mock` provider — network-free.
const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

export function demo() {
  const print = spawnSync(process.execPath, [bin, "--provider", "mock", "--model", "demo", "-p", "Hi"], { encoding: "utf8" });
  const json = spawnSync(process.execPath, [bin, "--provider", "mock", "--model", "demo", "--mode", "json", "-p", "Hi"], { encoding: "utf8" });

  return {
    printOk: print.status === 0,
    printOut: print.stdout,
    jsonLines: json.stdout.trim().split("\n").length,
  };
}

// Runnable end-to-end demo: `node examples/cli.ts` spawns the `prism` bin in
// print and json modes against the built-in mock provider. No network.
export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
