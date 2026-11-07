import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { HostBuilderError } from "../errors.js";
import { checkVersion, installedPrismVersion } from "../version.js";
import { cleanup, indexVersion, projectRoot, tempDir } from "./fixture.js";

afterEach(cleanup);

describe("version check", () => {
  it("passes silently when the installed version is the indexed one", async () => {
    const version = await indexVersion();
    const root = await projectRoot();
    assert.equal(installedPrismVersion(root), version);
    assert.deepEqual(checkVersion(root, version, false), {});
  });

  it("version_mismatch_fails_closed: names both versions and the fix", async () => {
    const root = await projectRoot("0.12.1");
    const version = await indexVersion();
    assert.throws(
      () => checkVersion(root, version, false),
      (error: unknown) => {
        assert.ok(error instanceof HostBuilderError);
        assert.equal(error.code, "ERR_PRISM_HOST_BUILDER_VERSION");
        assert.match(error.message, /0\.12\.1 is installed/);
        assert.ok(error.message.includes(`describe ${version}`));
        assert.match(error.message, /bun add -d @arnilo\/prism-host-builder@0\.12\.1/);
        return true;
      },
    );
  });

  it("version_mismatch_fails_closed: Prism not installed is the same error", async () => {
    const root = tempDir("host-builder-empty-");
    assert.equal(installedPrismVersion(root), undefined);
    assert.throws(() => checkVersion(root, "0.13.0", false), /not installed/);
  });

  it("version_mismatch_allowed_warns: the error becomes a warning", async () => {
    const root = await projectRoot("0.12.1");
    const check = checkVersion(root, await indexVersion(), true);
    assert.match(check.warning ?? "", /version mismatch allowed: @arnilo\/prism 0\.12\.1 is installed/);
  });
});
