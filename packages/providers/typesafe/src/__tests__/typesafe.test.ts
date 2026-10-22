import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";
import { systemOneConformance } from "@arnilo/prism/provider-kit";
import {
  createTypeSafeProvider,
  defineTypeSafeModel,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_API_KEY_REF,
  TYPESAFE_DEFAULT_BASE_URL,
  typeSafeModels,
} from "../index.js";

function maskVendor(source: string, vendor: "typesafe" | "laya"): string {
  if (vendor === "typesafe") {
    return source
      .replaceAll("TypeSafe Jev", "__VENDOR_LABEL__")
      .replaceAll("TypeSafe", "__Vendor__")
      .replaceAll("typesafe", "__vendor__")
      .replaceAll("typeSafe", "__vendor__")
      .replaceAll("TYPESAFE", "__VENDOR_UPPER__")
      .replaceAll("keyRequired: true", "keyRequired: __KEY_REQUIRED__");
  } else {
    return source
      .replaceAll("Laya provider", "__VENDOR_LABEL__ provider")
      .replaceAll('label: "Laya"', 'label: "__VENDOR_LABEL__"')
      .replaceAll("Laya", "__Vendor__")
      .replaceAll("laya", "__vendor__")
      .replaceAll("LAYA", "__VENDOR_UPPER__")
      .replaceAll("keyRequired: false", "keyRequired: __KEY_REQUIRED__");
  }
}

describe("@arnilo/prism-provider-typesafe", () => {
  it("typesafe_passes_systemone_conformance", async () => {
    const recordings = new URL("wire/systemone", import.meta.url);
    const result = await systemOneConformance({
      factory: (fetchImpl, options) =>
        createTypeSafeProvider({
          fetch: fetchImpl,
          apiKey: options?.apiKey as any,
        }),
      recordings,
      keyRequired: true,
    });
    assert.equal(result.ok, true);
    assert.ok(result.scenarios.length > 0);
  });

  it("typesafe_models_declare_decision_capabilities_limits_and_cost", () => {
    assert.equal(TYPESAFE_DEFAULT_BASE_URL, "https://api.typesafe.ai");
    assert.equal(TYPESAFE_API_KEY_ENV, "TYPESAFE_API_KEY");
    assert.equal(TYPESAFE_DEFAULT_API_KEY_REF, "env:TYPESAFE_API_KEY");
    for (const entry of typeSafeModels) {
      assert.deepEqual(entry.capabilities, {
        input: ["text"],
        output: ["text"],
        tools: false,
        streaming: false,
        structuredOutput: "json_schema",
      });
      assert.deepEqual(entry.limits, { contextWindow: 32_000, maxOutputTokens: 0 });
      assert.deepEqual(entry.cost, { input: 0.04, output: 0, currency: "USD", unit: "per_million_tokens" });
    }
    const pinned = defineTypeSafeModel({ model: "jev-1.13.0", displayName: "Jev 1.13.0" });
    assert.equal(pinned.provider, "typesafe");
    assert.equal(pinned.limits?.contextWindow, 32_000, "defaults apply to versioned pins");
  });

  it("plaintext_remote_endpoint_warns_for_both_vendors", () => {
    const seen: string[] = [];
    const warn = (msg: string) => seen.push(msg);

    createTypeSafeProvider({ baseUrl: "http://10.0.0.5:8443", warn });
    assert.equal(seen.length, 1);
    assert.match(seen[0]!, /TypeSafe Jev/);
    assert.match(seen[0]!, /plaintext/);
    assert.match(seen[0]!, /http:\/\/10\.0\.0\.5:8443/);
  });

  it("plaintext_warning_prints_origin_only", () => {
    const seen: string[] = [];
    const warn = (msg: string) => seen.push(msg);

    createTypeSafeProvider({ baseUrl: "http://user:s3cret@10.1.2.3:8000", warn });
    assert.equal(seen.length, 1);
    assert.match(seen[0]!, /http:\/\/10\.1\.2\.3:8000/);
    assert.doesNotMatch(seen[0]!, /s3cret/);
    assert.doesNotMatch(seen[0]!, /user/);
  });

  it("jev_and_laya_sources_match_with_vendor_masked", () => {
    const typesafeDir = fileURLToPath(new URL("..", import.meta.url));
    const layaDir = join(typesafeDir, "../../laya/src");

    const typesafeIndex = readFileSync(join(typesafeDir, "index.ts"), "utf8");
    const layaIndex = readFileSync(join(layaDir, "index.ts"), "utf8");
    assert.equal(maskVendor(typesafeIndex, "typesafe"), maskVendor(layaIndex, "laya"), "index.ts matches with vendor masked");

    const typesafeProvider = readFileSync(join(typesafeDir, "provider.ts"), "utf8");
    const layaProvider = readFileSync(join(layaDir, "provider.ts"), "utf8");
    assert.equal(
      maskVendor(typesafeProvider, "typesafe"),
      maskVendor(layaProvider, "laya"),
      "provider.ts matches with vendor masked",
    );
  });
});
