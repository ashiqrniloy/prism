import { describe, it } from "node:test";

describe("@prism/provider-opencode-go live tests", () => {
  it("workspace_tests_are_network_free_by_default", { skip: process.env.PRISM_LIVE_PROVIDER_TESTS === "1" ? false : "set PRISM_LIVE_PROVIDER_TESTS=1 to run live provider tests" }, () => {
    // ponytail: live test placeholder; real provider task adds env-specific checks.
  });
});
