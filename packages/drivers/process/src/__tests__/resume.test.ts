import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createAgent } from "@arnilo/prism";
import { processDriver } from "../index.js";
import { harness } from "./fixtures/harness.js";

const source = `import {createInterface} from 'node:readline';import {readFileSync,writeFileSync} from 'node:fs';
createInterface({input:process.stdin}).once('line',()=>{
 console.log(JSON.stringify({session:'vendor-1'}));
 console.log(JSON.stringify({kind:'notice',level:'info',code:'input',message:JSON.stringify({pid:process.pid,args:process.argv.slice(2),restored:process.argv[2]?readFileSync(process.argv[2],'utf8'):null})}));
 console.log(JSON.stringify({type:'turn.done'}));
}).on('close',()=>{if(process.env.TRANSCRIPT)writeFileSync(process.env.TRANSCRIPT,'conversation');});`;

test("store_resume_restores_into_new_agent_and_process", async () => {
  const h = await harness({
    source,
    adapter: (base) => ({
      ...base,
      descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: "store" } },
      configure: (_, ctx) => ({ env: { TRANSCRIPT: `${ctx.runDir.path}/transcript` } }),
      session: {
        strategy: "store",
        archive: async (ctx) => [readFileSync(`${ctx.runDir.path}/transcript`, "utf8")],
        restore: async (entries, ctx) => ({
          files: [{ path: "restored", content: String(entries.at(-1)) }],
          args: [`${ctx.runDir.path}/restored`],
        }),
      },
    }),
  });
  try {
    expect((await h.session.run("first")).error).toBeUndefined();
    await h.session.close();
    await h.agent.dispose();
    let restored: { pid: number; restored: string; args: string[] } | undefined;
    const next = await createAgent({
      hooks(hooks) {
        hooks.on("package.event", (event) => {
          if (event.name === "agent.notice" && (event.data as any).code === "input") restored = JSON.parse((event.data as any).message);
        });
      },
      slots: { store: h.store },
      packages: [
        processDriver({
          ...h.adapter,
          configure: (_, ctx) => ({ env: { TRANSCRIPT: `${ctx.runDir.path}/transcript` }, args: [], files: [] }),
        })({ name: "worker", profile: "me", profilesRoot: h.root, cwd: h.root, graceMs: 100 }),
      ],
    });
    const session = await next.session({ id: "test" });
    try {
      const result = await session.run("second");
      expect(result.error).toBeUndefined();
      expect(restored?.restored).toBe("conversation");
      const first = h.events.find((event: any) => event.name === "agent.notice" && event.data.code === "input") as any;
      expect(restored?.pid).not.toBe(JSON.parse(first.data.message).pid);
      expect(restored?.args[0]).toContain("/restored");
    } finally {
      await session.close();
      await next.dispose();
    }
  } finally {
    await h.close();
  }
});

for (const strategy of ["vendor", "none"] as const)
  test(`${strategy}_resume_state`, async () => {
    const resumes: unknown[] = [];
    const h = await harness({
      source: source.replace("restored:process.argv[2]?readFileSync(process.argv[2],'utf8'):null", "restored:null"),
      adapter: (base) => ({
        ...base,
        descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: strategy } },
        configure: (_, ctx) => {
          resumes.push(ctx.resume.sessionId);
          return {};
        },
        session: { strategy },
        decode(frame) {
          if (frame && typeof frame === "object" && !Array.isArray(frame) && "session" in frame)
            return { activity: [], sessionId: "vendor-1" };
          return base.decode(frame);
        },
      }),
    });
    try {
      expect((await h.session.run("first")).error).toBeUndefined();
      expect((await h.session.run("second")).error).toBeUndefined();
      expect(resumes).toEqual([undefined, strategy === "vendor" ? "vendor-1" : undefined]);
      const entries = await h.store.list("test");
      expect(entries.filter((e) => e.kind === "external_state").length).toBe(strategy === "none" ? 0 : 3);
    } finally {
      await h.close();
    }
  });

test("binary_major_change_is_driver_revision_mismatch", async () => {
  const h = await harness({
    source: source.replace("restored:process.argv[2]?readFileSync(process.argv[2],'utf8'):null", "restored:null"),
    adapter: (base) => ({
      ...base,
      descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: "vendor" } },
      session: { strategy: "vendor" },
      decode(frame) {
        if (frame && typeof frame === "object" && !Array.isArray(frame) && "session" in frame)
          return { activity: [], sessionId: "vendor-1" };
        return base.decode(frame);
      },
    }),
  });
  try {
    expect((await h.session.run("first")).error).toBeUndefined();
    await h.session.close();
    await h.agent.dispose();
    const binary = `${h.root}/binary.mjs`;
    writeFileSync(binary, readFileSync(binary, "utf8").replace("1.2.3", "2.0.0"));
    const next = await createAgent({
      slots: { store: h.store },
      packages: [processDriver(h.adapter)({ name: "worker", profile: "me", profilesRoot: h.root })],
    });
    const session = await next.session({ id: "test" });
    try {
      expect((await session.run("second")).error?.message).toContain("driver_revision_mismatch");
    } finally {
      await session.close();
      await next.dispose();
    }
  } finally {
    await h.close();
  }
});

for (const protectedArchive of [false, true])
  test(`archive_never_holds_canary_${protectedArchive}`, async () => {
    const canary = "credential-canary-do-not-archive";
    const h = await harness({
      adapter: (base) => ({
        ...base,
        descriptor: {
          ...base.descriptor,
          controls: { ...base.descriptor.controls, resume: "store" },
          auth: {
            modes: base.descriptor.auth.modes.map((mode) => ({ ...mode, protected: { ...mode.protected, paths: ["credentials"] } })),
          },
        },
        configure: (_, ctx) => {
          writeFileSync(`${ctx.home}/credentials`, canary);
          return {};
        },
        session: {
          strategy: "store",
          restore: async () => ({}),
          archive: async (ctx) => (protectedArchive ? [{ path: `${ctx.home}/credentials`, content: canary }] : ["transcript-only"]),
        },
      }),
    });
    try {
      const result = await h.session.run("go");
      if (protectedArchive) expect(result.error?.message).toContain("profile_invalid");
      else expect(result.error).toBeUndefined();
      expect(JSON.stringify(await h.store.list("test"))).not.toContain(canary);
    } finally {
      await h.close();
    }
  });

test("restored_files_cannot_escape_run_directory", async () => {
  const h = await harness({
    adapter: (base) => ({
      ...base,
      descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: "store" } },
      session: {
        strategy: "store",
        archive: async () => ["transcript"],
        restore: async () => ({ files: [{ path: "../escape", content: "unsafe" }] }),
      },
    }),
  });
  try {
    expect((await h.session.run("first")).error).toBeUndefined();
    expect((await h.session.run("second")).error?.message).toContain("profile_invalid");
  } finally {
    await h.close();
  }
});

test("archive_once_per_turn_including_continuations", async () => {
  const archived: string[] = [];
  const h = await harness({
    source: `import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';let turn=0;
createInterface({input:process.stdin}).on('line',()=>{writeFileSync(process.env.TRANSCRIPT,String(++turn));console.log('{}');});`,
    agent: {
      limits: { maxContinuations: 1 },
      hooks: (hooks) => {
        hooks.on("run.end", () => ({ continue: { reason: "again" } }));
      },
    },
    adapter: (base) => ({
      ...base,
      descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: "store", continueOnStop: true } },
      configure: (_, ctx) => ({ env: { TRANSCRIPT: `${ctx.runDir.path}/transcript` } }),
      encode: { prompt: () => ({}), continue: () => ({}) },
      decode: () => ({ activity: [], stop: true }),
      session: {
        strategy: "store",
        restore: async () => ({}),
        archive: async (ctx) => {
          const text = readFileSync(`${ctx.runDir.path}/transcript`, "utf8");
          archived.push(text);
          return [text];
        },
      },
    }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(archived).toEqual(["1", "2"]);
  } finally {
    await h.close();
  }
});

test("archive_retains_external_state_byte_cap", async () => {
  const h = await harness({
    adapter: (base) => ({
      ...base,
      descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: "store" } },
      session: { strategy: "store", restore: async () => ({}), archive: async () => ["x".repeat(70000)] },
    }),
  });
  try {
    expect((await h.session.run("go")).error?.code).toBe("external_state_limit");
  } finally {
    await h.close();
  }
});

test("archived_entries_are_redacted_before_storage", async () => {
  const secret = "archive-secret-canary";
  const h = await harness({
    adapter: (base) => ({
      ...base,
      descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: "store" } },
      configure: () => ({ env: { SECRET: secret } }),
      session: { strategy: "store", restore: async () => ({}), archive: async () => [{ transcript: "safe", secret }] },
    }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    const stored = JSON.stringify(await h.store.list("test"));
    expect(stored).not.toContain(secret);
    expect(stored).toContain("[REDACTED]");
  } finally {
    await h.close();
  }
});
