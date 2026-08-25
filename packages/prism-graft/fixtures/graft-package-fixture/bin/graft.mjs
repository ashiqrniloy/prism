#!/usr/bin/env node
// Stub graft CLI for network-free tests. Dispatches on argv[2].
const [, , sub, arg] = process.argv;

const send = (value) => {
  process.stdout.write(JSON.stringify(value));
};

switch (sub) {
  case "check":
    send({ fresh: true, upToDate: true, missing: 0, stale: 0 });
    break;
  case "env":
    send({
      DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
      SECRET_SENTINEL: process.env.SECRET_SENTINEL ?? null,
      GRAFT_API_KEY: process.env.GRAFT_API_KEY ?? null,
      CUSTOM_X: process.env.CUSTOM_X ?? null,
    });
    break;
  case "sleep":
    setTimeout(() => send({ stub: true, slept: arg }), Number(arg ?? 5000));
    break;
  case "big":
    send({ blob: "x".repeat(1024 * 1024) });
    break;
  case "fail-json":
    send({ partial: true });
    process.exit(1);
    break;
  case "viz":
    send({ args: process.argv.slice(2) });
    break;
  case "ask":
  case "grep":
  case "callers":
  case "skeleton":
  case "map":
  case "blast": {
    const rest = process.argv.slice(2);
    if (rest[1] === "__NOGRAPH__") {
      process.stderr.write("error: no graft graph found in . — run graft build first\n");
      process.exit(2);
    }
    if (rest[0] === "ask" && typeof rest[1] === "string" && rest[1].includes("__PACK__")) {
      // retrieval-pack shape for the push-mode demo/tests (graft ask --json)
      send({
        nodes: [
          { id: "input-assembly", title: "assembleProviderInput", kind: "function", path: "src/input.ts", line: 88 },
          { id: "context-budget", title: "applyContextBudget", kind: "function", path: "src/context-budget.ts", line: 24 },
          { id: "middleware", title: "createMiddlewareRegistry", kind: "function", path: "src/middleware.ts", line: 34 },
        ],
      });
      break;
    }
    if (rest[0] === "blast" && typeof rest[1] === "string" && rest[1].endsWith(".ts")) {
      // blast summary shape for middleware tests (.ts targets); other targets fall through to argv echo
      send({ dependents: [{ title: "consumer-a.ts" }, { title: "consumer-b.ts" }] });
      break;
    }
    if (rest.some((a) => a.includes("__UNBUILT__"))) {
      process.stderr.write("error: no graft graph found in . — run graft build first\n");
      process.exit(2);
    }
    send({ args: rest });
    break;
  }
  default:
    send({ stub: true });
}
