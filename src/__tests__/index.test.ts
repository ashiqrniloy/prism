import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { description, name, version } from "../index.js";

const ROOT_VERSION = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")),
).version;

describe("prism", () => {
  it("should export name and version", () => {
    assert.equal(name, "prism");
    assert.equal(version, ROOT_VERSION);
    assert.equal(typeof description, "string");
  });
});
