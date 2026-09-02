import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChildEnv, DEFAULT_CHILD_ENV_INHERIT } from "../env.js";

test("buildChildEnv copies only explicitly inherited names, never the whole process.env", () => {
  process.env.PRISM_ENV_LEAK_CANARY = "top-secret-1";
  process.env.PRISM_ENV_PATH_PROBE = "/usr/bin:/bin";
  try {
    const env = buildChildEnv({ inherit: ["PRISM_ENV_PATH_PROBE", "PATH"], set: { PRISM_RUN_ID: "r1" } });
    assert.equal(env.PRISM_ENV_PATH_PROBE, "/usr/bin:/bin");
    assert.equal(env.PRISM_RUN_ID, "r1");
    assert.equal(env.PRISM_ENV_LEAK_CANARY, undefined, "unlisted var must never reach child env");
    assert.ok(env.PATH === process.env.PATH, "PATH is the only inherited host value");
    assert.deepEqual(Object.keys(env).sort(), ["PATH", "PRISM_ENV_PATH_PROBE", "PRISM_RUN_ID"].sort());
  } finally {
    delete process.env.PRISM_ENV_LEAK_CANARY;
    delete process.env.PRISM_ENV_PATH_PROBE;
  }
});

test("default inherit set is PATH + locale + HOME + TERM only", () => {
  const env = buildChildEnv({ inherit: DEFAULT_CHILD_ENV_INHERIT });
  for (const name of Object.keys(env)) {
    assert.ok(["PATH", "LANG", "LC_ALL", "HOME", "TERM"].includes(name), `unexpected inherited var: ${name}`);
  }
});
