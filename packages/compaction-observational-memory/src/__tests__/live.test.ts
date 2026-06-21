import { describe, it } from "node:test";

const live = process.env.PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS === "1";

describe("observational memory live tests", { skip: !live }, () => {
  it("placeholder for opt-in live worker/provider checks", () => {
    // Live tests are intentionally opt-in and empty until provider-backed workers exist.
  });
});
