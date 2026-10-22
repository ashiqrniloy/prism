import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { decisionForPermission } from "../permission.js";

const pending = {
  approvalId: "ap-1",
  kind: "tool_approval" as const,
  scope: { toolName: "delete_file" },
  reason: "delete?",
};

describe("decisionForPermission", () => {
  it("maps SDK kinds and fails closed", () => {
    assert.equal(decisionForPermission(pending, { outcome: { outcome: "selected", optionId: "allow_always" } }).outcome, "allow_for_run");
    assert.equal(decisionForPermission(pending, { outcome: { outcome: "selected", optionId: "reject_always" } }).outcome, "reject_for_run");
    assert.equal(decisionForPermission(pending, { outcome: { outcome: "cancelled" } }).outcome, "reject_once");
    assert.equal(decisionForPermission(pending, { outcome: { outcome: "selected", optionId: "nope" } }).outcome, "reject_once");
  });
});
