import { test } from "bun:test";
import assert from "node:assert/strict";
import { applyOpenTuiLibc, detectLinuxLibc } from "../libc.js";

const glibc = () => ({ header: { glibcVersionRuntime: "2.39" } });
const musl = () => ({ header: {} });

test("detectLinuxLibc reads glibcVersionRuntime", () => {
  assert.equal(detectLinuxLibc(glibc()), "glibc");
  assert.equal(detectLinuxLibc(musl()), "musl");
  assert.equal(detectLinuxLibc(undefined), "musl");
});

test("applyOpenTuiLibc selects musl on a musl Linux host", () => {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(applyOpenTuiLibc(env, "linux", musl), "musl");
  assert.equal(env.OPENTUI_LIBC, "musl");
});

test("applyOpenTuiLibc leaves glibc hosts, other platforms, and explicit values alone", () => {
  const glibcEnv: NodeJS.ProcessEnv = {};
  assert.equal(applyOpenTuiLibc(glibcEnv, "linux", glibc), undefined);
  assert.equal("OPENTUI_LIBC" in glibcEnv, false);

  const darwinEnv: NodeJS.ProcessEnv = {};
  assert.equal(applyOpenTuiLibc(darwinEnv, "darwin", musl), undefined);
  assert.equal("OPENTUI_LIBC" in darwinEnv, false);

  const explicit: NodeJS.ProcessEnv = { OPENTUI_LIBC: "glibc" };
  assert.equal(applyOpenTuiLibc(explicit, "linux", musl), "glibc");
});
