/** Runs `adapterConformance` for every reference adapter and prints one JSON summary per adapter. */
import { adapterConformance } from "@arnilo/prism-driver-process/testing";
import { rpcServerDialect, rpcServerFixtures } from "./rpc-server.dialect.js";
import { rpcServer } from "./rpc-server.js";
import { streamCliDialect, streamCliFixtures } from "./stream-cli.dialect.js";
import { streamCli } from "./stream-cli.js";
import { workspaceConfigDialect, workspaceConfigFixtures } from "./workspace-config.dialect.js";
import { workspaceConfig } from "./workspace-config.js";

const references = [
  { name: "stream-cli", adapter: streamCli, dialect: streamCliDialect, fixtures: streamCliFixtures },
  { name: "rpc-server", adapter: rpcServer, dialect: rpcServerDialect, fixtures: rpcServerFixtures },
  { name: "workspace-config", adapter: workspaceConfig, dialect: workspaceConfigDialect, fixtures: workspaceConfigFixtures },
];

let failed = false;

for (const reference of references) {
  try {
    const result = await adapterConformance(reference.adapter, { dialect: reference.dialect, fixtures: reference.fixtures });
    console.log(JSON.stringify({ adapter: reference.name, legs: result.legs }));
    for (const leg of result.legs)
      if (leg.status !== "passed" && leg.status !== "skipped") {
        failed = true;
        console.error(`${reference.name}: leg ${leg.name} is ${leg.status}`);
      }
  } catch (error) {
    failed = true;
    console.error(`${reference.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Plan 174 Task 11: the release gate reads this exit code, so a failed or hung leg must not exit 0.
if (failed) process.exitCode = 1;
