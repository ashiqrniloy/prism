import test from "node:test";

test("compaction_llm_live_provider_smoke", { skip: process.env.PRISM_LIVE_COMPACTION_TESTS !== "1" }, () => {
  // Live summary-provider checks belong here when explicitly enabled.
});
