import { test } from "bun:test";
import assert from "node:assert/strict";

import { assertIdentityMatchesOwnership, type AgentIdentity } from "../identity.js";

const identity: AgentIdentity = {
  tenantId: "t",
  userId: "u",
  principal: { kind: "user", id: "u" },
  scopes: ["repo"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

test("coding identity stand-in rejects an ownership user mismatch", () => {
  assert.throws(() => assertIdentityMatchesOwnership(identity, { tenantId: "t", userId: "other" }), /user/);
});
