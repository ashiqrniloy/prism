import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { DriverConformanceError, driverConformance } from "../driver-conformance.js";
import { referenceConfig, referenceDriver } from "./reference-driver.js";
import { jsonlStreamDialect } from "../scripted-dialects/jsonl-stream.js";
import type { ScriptedCli, ScriptedDialect } from "../scripted-cli.js";

const LONG = 180_000;

describe("driverConformance", () => {
  it(
    "strict_isolation_leg_fails_when_planted_item_loaded",
    async () => {
      const dialect: ScriptedDialect = {
        ...jsonlStreamDialect,
        locate: ({ argv, env, readFile }) => {
          const paths = [".scripted/hook.json", ".scripted/skills/planted/SKILL.md", ".scripted/mcp.json"];
          return {
            hookCommand: JSON.parse(argv[argv.indexOf("--hook-command") + 1]!),
            loaded: paths.map((path) => `${env.HOME}/${path}`).filter((path) => readFile(path) !== undefined),
          };
        },
      };
      const options = { dialect, fixtures: { config: (cli: ScriptedCli) => referenceConfig(cli.command) } };
      const strict = await driverConformance(referenceDriver({ name: "home-strict", dialect, isolation: "workspace-files" }), options);
      assert.equal(strict.legs.find((leg) => leg.name === "strict_isolation")?.status, "passed");
      await assert.rejects(
        driverConformance(referenceDriver({ name: "home-leaky", dialect, inheritsHome: true }), options),
        (error: unknown) =>
          error instanceof DriverConformanceError && error.leg === "strict_isolation" && /planted home item/.test(error.message),
      );
    },
    LONG,
  );

  it(
    "driver_conformance_passes_for_reference_driver",
    async () => {
      const result = await driverConformance(referenceDriver({ name: "reference-jsonl", dialect: "jsonl-stream" }), {
        dialect: "jsonl-stream",
        fixtures: { config: (cli) => referenceConfig(cli.command) },
      });
      // The default key mode declares no credential path, so only the two canary legs are skipped.
      const skipped = result.legs.filter((leg) => leg.status === "skipped").map((leg) => leg.name);
      assert.deepEqual(skipped, ["credential_canary", "no_secret"]);
      assert.equal(result.legs.length, 13);
    },
    LONG,
  );

  it(
    "driver_conformance_passes_for_reference_driver_on_json_rpc",
    async () => {
      const result = await driverConformance(referenceDriver({ name: "reference-rpc", dialect: "json-rpc" }), {
        dialect: "json-rpc",
        fixtures: { config: (cli) => referenceConfig(cli.command) },
      });
      const skipped = result.legs.filter((leg) => leg.status === "skipped").map((leg) => leg.name);
      // No relay on a client-request dialect; the default key mode declares no credential to canary.
      assert.deepEqual(skipped, ["fail_closed", "credential_canary", "no_secret"]);
    },
    LONG,
  );

  it(
    "driver_conformance_fails_on_canary_read",
    async () => {
      const leaky = referenceDriver({ name: "reference-leaky", dialect: "jsonl-stream", readsProtected: true });
      await assert.rejects(
        driverConformance(leaky, { dialect: "jsonl-stream", fixtures: { config: (cli) => referenceConfig(cli.command), mode: "account" } }),
        (error: unknown) =>
          error instanceof DriverConformanceError &&
          error.leg === "credential_canary" &&
          /tried to read a protected credential path/.test(error.message),
      );
    },
    LONG,
  );

  it(
    "driver_conformance_fails_when_relay_fails_open",
    async () => {
      const open = referenceDriver({ name: "reference-open", dialect: "jsonl-stream", failOpen: true });
      await assert.rejects(
        driverConformance(open, { dialect: "jsonl-stream", fixtures: { config: (cli) => referenceConfig(cli.command) } }),
        (error: unknown) =>
          error instanceof DriverConformanceError &&
          error.leg === "fail_closed" &&
          /allowed a call while the broker was down/.test(error.message),
      );
    },
    LONG,
  );
});
