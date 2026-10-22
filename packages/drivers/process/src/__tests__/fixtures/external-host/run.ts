import { adapterConformance } from "@arnilo/prism-driver-process/testing";
import { externalHostAdapter } from "./adapter.js";
import { dialect } from "./dialect.js";

const result = await adapterConformance(externalHostAdapter([process.execPath]), {
  dialect,
  fixtures: { config: (cli) => ({ binary: cli.command[0], args: [...cli.command.slice(1)] }) },
});
process.stdout.write(`${JSON.stringify(result.legs)}\n`);
