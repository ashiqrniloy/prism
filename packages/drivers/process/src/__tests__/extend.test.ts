import { expect, test } from "bun:test";
import { type AdapterOverrides, extendAdapter } from "../index.js";
import { harness } from "./fixtures/harness.js";
import { testAdapter } from "./fixtures/test-adapter.js";

const identity = { name: "extended-driver", revision: "2" };

test("extend_replaces_decoder_for_raw_frames", async () => {
  const h = await harness({
    config: { capture: "all" },
    source: `import { createInterface } from "node:readline";
createInterface({input:process.stdin}).once("line", () => { console.log('{"custom":true}'); console.log('{"type":"turn.done"}'); });`,
    adapter: (base) =>
      extendAdapter(base, {
        ...identity,
        decode: {
          replace: (frame) =>
            typeof frame === "object" && frame !== null && "custom" in frame
              ? { activity: [{ kind: "file", path: "changed.ts", change: "modified", source: "agent" }] }
              : base.decode(frame),
        },
      }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(JSON.stringify(h.events)).toContain("agent.file");
    expect(JSON.stringify(h.events)).toContain("changed.ts");
    expect(JSON.stringify(h.events)).not.toContain("agent.raw");
    expect(testAdapter([process.execPath]).decode({ custom: true }).unmapped).toBe(true);
  } finally {
    await h.close();
  }
});

test("extend_wraps_configure_adds_flag_and_inspect_names_chain", async () => {
  let calls = 0;
  const h = await harness({
    source: `import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).once('line', () => {
 console.log(JSON.stringify({kind:'notice',level:'info',message:process.argv.at(-1)}));
 console.log(JSON.stringify({type:'turn.done'}));
});`,
    adapter: (base) =>
      extendAdapter(
        extendAdapter(base, {
          ...identity,
          configure: (configure) => {
            calls++;
            return async (spec, ctx) => {
              const plan = await configure(spec, ctx);
              return { ...plan, args: [...(plan.args ?? []), "--quiet"] };
            };
          },
        }),
        { name: "second-extension", revision: "3" },
      ),
  });
  try {
    expect(calls).toBe(1);
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(JSON.stringify(h.events)).toContain("--quiet");
    expect(h.inspection()).toMatchObject({
      adapter: {
        name: "second-extension",
        revision: "3",
        extends: { ...identity, extends: { name: "test-process-driver", revision: "1" } },
      },
    });
    expect(JSON.stringify(h.agent.inspect().statusNotes)).toContain("test-process-driver");
    expect(calls).toBe(1);
  } finally {
    await h.close();
  }
});

test("extend_narrows_policy_and_hosted_fails", async () => {
  const h = await harness({
    adapter: (base) =>
      extendAdapter(base, {
        ...identity,
        descriptor: {
          auth: {
            modes: base.descriptor.auth.modes.map((mode) => ({ ...mode, deployments: ["local"] })),
          },
        },
      }),
    config: { deployment: "hosted" },
  });
  try {
    expect((await h.session.run("go")).error?.message).toContain("plan_login_not_permitted");
  } finally {
    await h.close();
  }
});

test("extend_requires_rechecked_at_setup", async () => {
  await expect(
    harness({
      adapter: (base) => extendAdapter(base, { ...identity, descriptor: { controls: { subagents: false } } }),
      config: { requires: { subagents: true } },
    }),
  ).rejects.toThrow("driver_capability_missing");
});

test("extend_widening_policy_is_rejected", () => {
  const base = testAdapter([process.execPath]);
  const mode = base.descriptor.auth.modes[0];
  if (!mode) throw new Error("fixture has no auth mode");
  const restricted = extendAdapter(base, {
    ...identity,
    descriptor: {
      auth: {
        modes: [
          {
            ...mode,
            deployments: ["local"],
            hostedAcknowledgements: ["terms"],
            protected: { paths: ["credentials"], env: ["BLOCKED_TOKEN"] },
          },
        ],
      },
    },
  });
  for (const change of [
    { deployments: ["local", "hosted"] },
    { hostedAcknowledgements: [] },
    { protected: { paths: [], env: ["BLOCKED_TOKEN"] } },
    { protected: { paths: ["credentials"], env: [] } },
    { name: "new-mode" },
    { kind: "account" },
    { homeEnv: "OTHER_HOME" },
  ]) {
    expect(() =>
      extendAdapter(restricted, {
        ...identity,
        descriptor: { auth: { modes: [{ ...restricted.descriptor.auth.modes[0], ...change }] } },
      } as AdapterOverrides),
    ).toThrow("adapter_invalid: policy_widened");
  }
});

test("extend_does_not_mutate_frozen_base_and_validates", () => {
  const base = Object.freeze(testAdapter([process.execPath]));
  const before = JSON.stringify(base);
  const extended = extendAdapter(base, { ...identity, abort: [], decode: (decode) => (frame) => decode(frame) });
  expect(Object.isFrozen(base)).toBe(true);
  expect(extended).not.toBe(base);
  expect(JSON.stringify(base)).toBe(before);
  expect(extended.abort).toEqual([]);
  expect(() => extendAdapter(base, { name: "bad" } as AdapterOverrides)).toThrow("revision");
  expect(() => extendAdapter(base, { ...identity, decode: { replace: undefined } } as unknown as AdapterOverrides)).toThrow("decode");
  expect(() => extendAdapter(base, { ...identity, decode: (() => 3) as never })).toThrow("decode");
});

test("extend_shallow_merges_requests_and_replaces_arrays", () => {
  const base = testAdapter([process.execPath]);
  const first = () => null;
  const second = () => true;
  const rpc = { ...base, transport: "json-rpc" as const, requests: { first } };
  const merged = extendAdapter(rpc, {
    ...identity,
    requests: { second },
    binary: { versionArgs: [] },
    encode: { steer: () => null },
    abort: [{ closeStdin: true }],
  });
  expect(merged.requests).toEqual({ first, second });
  expect(merged.binary.command).toBe(base.binary.command);
  expect(merged.binary.versionArgs).toEqual([]);
  expect(merged.encode.prompt).toBe(base.encode.prompt);
  expect(merged.abort).toEqual([{ closeStdin: true }]);
  expect(rpc.requests).toEqual({ first });
});

test("extend_optional_function_validation_and_policy_restrictions", () => {
  const base = testAdapter([process.execPath]);
  expect(() => extendAdapter(base, { ...identity, open: () => () => [] })).toThrow("no base function");
  expect(() => extendAdapter(base, { ...identity, notices: { replace: 2 } } as unknown as AdapterOverrides)).toThrow("notices");
  expect(extendAdapter(base, { ...identity, open: { replace: () => [] } }).open?.({ resume: { entries: [] }, tools: [] })).toEqual([]);
  const modes = base.descriptor.auth.modes.map((mode) => ({ ...mode, hostedAcknowledgements: ["extra"] }));
  expect(extendAdapter(base, { ...identity, descriptor: { auth: { modes } } }).descriptor.auth.modes).toEqual(modes);
  expect(extendAdapter(base, { ...identity, descriptor: { auth: { modes: [] } } }).descriptor.auth.modes).toEqual([]);
});
