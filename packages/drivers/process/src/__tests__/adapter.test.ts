import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { quoteCommand } from "../adapter.js";
import { type AgentAdapter, ProcessDriverError, processDriver } from "../index.js";
import { testAdapter } from "./fixtures/test-adapter.js";

for (const member of ["name", "revision", "descriptor", "binary", "configure", "encode", "decode", "abort", "profile", "session"]) {
  test(`adapter_invalid_names_${member}`, () => {
    const bad = { ...testAdapter([process.execPath]), [member]: undefined } as unknown as AgentAdapter;
    expect(() => processDriver(bad)).toThrow(ProcessDriverError);
    expect(() => processDriver(bad)).toThrow(member);
  });
}
test("adapter_invalid_channels_descriptor_and_resume", () => {
  const base = testAdapter([process.execPath]);
  expect(() => processDriver({ ...base, requests: {} })).toThrow("requests");
  expect(() => processDriver({ ...base, abort: [1] } as unknown as AgentAdapter)).toThrow("abort");
  expect(() => processDriver({ ...base, encode: {} } as AgentAdapter)).toThrow("encode.prompt");
  expect(() => processDriver({ ...base, descriptor: { ...base.descriptor, usesModel: true } } as unknown as AgentAdapter)).toThrow(
    "descriptor",
  );
  expect(() =>
    processDriver({ ...base, descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, permissionCallback: true } } }),
  ).toThrow("permissionCallback");
  expect(() => processDriver({ ...base, session: { strategy: "vendor" } })).toThrow("session.strategy");
});
test("hook_command_quotes_spaces_quotes_and_dollars", () => {
  const words = ["a b", "c'd", "$HOME", "", "back`tick"];
  const result = spawnSync("sh", ["-c", `printf '%s\\n' ${quoteCommand(words)}`], { encoding: "utf8" });
  expect(result.stdout).toBe(`${words.join("\n")}\n`);
});
