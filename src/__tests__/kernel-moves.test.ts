import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import * as kernel from "../index.js";

const moved = [
  "createEventMultiplexer",
  "runCheckpointRestoreHooks",
  "checkCitationIntegrity",
  "prepareRunFeedback",
  "createMemoryRunFeedbackStore",
  "describeStorage",
  "resolveDevicePolicy",
  "assertDeviceAdmit",
] as const;

describe("kernel moves", () => {
  it("kernel_does_not_export_moved_modules", () => {
    const barrel = kernel as Record<string, unknown>;
    for (const name of moved) {
      assert.equal(name in barrel, false, `${name} must not be a root export`);
    }
  });
});
