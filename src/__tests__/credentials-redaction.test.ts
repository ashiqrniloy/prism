import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createProviderRegistry,
  errorToErrorInfo,
  redactSecrets,
  resolveCredentialValue,
} from "../index.js";
import type { CredentialResolver } from "../index.js";

describe("credential boundary", () => {
  it("resolves credentials from direct value callback or resolver", async () => {
    const resolver: CredentialResolver = {
      resolve(request) {
        return { type: "api_key", value: `${request.provider}:token` };
      },
    };

    assert.equal(await resolveCredentialValue("literal", { name: "api" }), "literal");
    assert.equal(await resolveCredentialValue(() => "callback", { name: "api" }), "callback");
    assert.equal(
      await resolveCredentialValue(resolver, { name: "api", provider: "mock" }),
      "mock:token",
    );
  });

  it("provider registry does not accept or store credentials", () => {
    const registry = createProviderRegistry();

    registry.register({
      id: "mock",
      async *generate() {
        yield { type: "done" };
      },
    });

    assert.deepEqual(Object.keys(registry.resolve("mock")), ["id", "generate"]);
  });
});

describe("redaction", () => {
  it("redacts known secret values from strings and objects", () => {
    const secret = "sk-test-123";

    assert.equal(redactSecrets(`token=${secret}`, [secret]), "token=[REDACTED]");
    assert.deepEqual(redactSecrets({ nested: [`Bearer ${secret}`] }, [secret]), {
      nested: ["Bearer [REDACTED]"],
    });
  });

  it("redacts known secret values from error info", () => {
    const info = errorToErrorInfo(new Error("bad key sk-test-123"), ["sk-test-123"]);

    assert.equal(info.message, "bad key [REDACTED]");
  });
});
