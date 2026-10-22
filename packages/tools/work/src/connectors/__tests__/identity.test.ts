import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import { assertIdentityActive, type AgentIdentity } from "../identity.js";

const active: AgentIdentity = {
  tenantId: "t",
  principal: { kind: "user", id: "u" },
  scopes: ["read"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

describe("work identity stand-in", () => {
  it("rejects an expired identity", () => {
    assert.throws(() => assertIdentityActive({ ...active, expiresAt: "2000-01-01T00:00:00.000Z" }), /expired/);
  });
});
