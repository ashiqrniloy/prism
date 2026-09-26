import { test } from "bun:test";

test.skipIf(process.env.PRISM_LIVE_COMPACTION_TESTS !== "1")("compaction_llm_live_provider_smoke", () => {
  // Live summary-provider checks belong here when explicitly enabled.
});
