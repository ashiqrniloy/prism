import { describe, it } from "node:test";

/**
 * Env-gated live smoke tests for @arnilo/prism-provider-neuralwatt.
 *
 * Network-free by default: these tests skip unless `NEURALWATT_API_KEY` is set,
 * keeping CI/offline runs hermetic. Set `PRISM_LIVE_PROVIDER_TESTS=1` in
 * addition to opt in to any real network calls.
 */
describe("@arnilo/prism-provider-neuralwatt live tests", () => {
  it("workflow_tests_are_network_free_by_default", { skip: process.env.NEURALWATT_API_KEY ? false : "set NEURALWATT_API_KEY (and PRISM_LIVE_PROVIDER_TESTS=1) to run live provider tests" }, () => {
    // ponytail: live test placeholder; Phase 46 adds real /v1/models + chat smoke.
  });
});
