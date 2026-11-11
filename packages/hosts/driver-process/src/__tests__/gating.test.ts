import { expect, test } from "bun:test";
import { harness } from "./fixtures/harness.js";

for (const rewrite of [false, true])
  test(`relay_rewrite_support_${rewrite}`, async () => {
    const h = await harness({
      source: `import {execSync} from 'node:child_process'; import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).once('line',()=>{
 const answer=execSync(process.argv[2],{input:'gate',encoding:'utf8'});
 console.log(JSON.stringify({kind:'notice',level:'info',code:'answer',message:answer}));
 console.log(JSON.stringify({type:'turn.done'}));
});`,
      adapter: (a) => ({
        ...a,
        descriptor: { ...a.descriptor, controls: { ...a.descriptor.controls, rewrite } },
        configure: (_, ctx) => ({ args: [ctx.hook.command] }),
        hooks: {
          failClosed: { exitCode: 0, stdout: "deny" },
          codec: {
            decode: () => ({ kind: "pre-tool", request: { toolCallId: "t", name: "unknown", args: {}, effects: [] } }),
            encode: (answer) => ({ exitCode: 0, stdout: JSON.stringify(answer) }),
          },
        },
      }),
      agent: {
        hooks: (hooks) => {
          hooks.on("tool.call", () => ({ rewrite: { changed: true } }));
        },
      },
    });
    try {
      expect((await h.session.run("go")).error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain(rewrite ? "changed" : "rewrite_unsupported");
    } finally {
      await h.close();
    }
  });

test("decoded_stop_continuations_are_capped", async () => {
  let prompts = 0;
  const h = await harness({
    source: `import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).on('line',()=>console.log('{}'));`,
    adapter: (a) => ({
      ...a,
      descriptor: { ...a.descriptor, controls: { ...a.descriptor.controls, continueOnStop: true } },
      encode: {
        prompt: () => {
          prompts++;
          return {};
        },
        continue: (reason) => {
          prompts++;
          return { reason };
        },
      },
      decode: () => ({ activity: [], stop: true }),
    }),
    agent: {
      limits: { maxContinuations: 2 },
      hooks: (hooks) => {
        hooks.on("run.end", () => ({ continue: { reason: "more" } }));
      },
    },
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(prompts).toBe(3);
  } finally {
    await h.close();
  }
});

for (const allow of [true, false])
  test(`relay_gate_${allow ? "allows" : "denies"}`, async () => {
    const h = await harness({
      source: `import {execSync} from 'node:child_process'; import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).once('line',()=>{
 const answer=execSync(process.argv[2],{input:'gate',encoding:'utf8'});
 console.log(JSON.stringify({kind:'notice',level:'info',code:'answer',message:answer})); console.log(JSON.stringify({type:'turn.done'})); });`,
      adapter: (a) => ({
        ...a,
        configure: (_, ctx) => ({ args: [ctx.hook.command] }),
        hooks: {
          failClosed: { exitCode: 0, stdout: "deny" },
          codec: {
            decode: () => ({ kind: "pre-tool", request: { toolCallId: "t", name: "write", args: {}, effects: ["write"] } }),
            encode: (answer) => ({ exitCode: 0, stdout: JSON.stringify(answer) }),
          },
        },
      }),
      agent: {
        hooks: (hooks) => {
          hooks.on("tool.call", () => (allow ? "allow" : { deny: "blocked" }));
        },
      },
    });
    try {
      expect((await h.session.run("go")).error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain(allow ? "true" : "blocked");
    } finally {
      await h.close();
    }
  });

for (const exitCode of [0, 2])
  test(`throwing_codec_prints_declared_fail_closed_${exitCode}`, async () => {
    const h = await harness({
      source: `import {spawnSync} from 'node:child_process'; import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).once('line',()=>{
 const answer=spawnSync(process.argv[2],{input:'gate',encoding:'utf8',shell:true});
 console.log(JSON.stringify({kind:'notice',level:'info',code:'answer',message:JSON.stringify({status:answer.status,stdout:answer.stdout})})); console.log(JSON.stringify({type:'turn.done'})); });`,
      adapter: (a) => ({
        ...a,
        configure: (_, ctx) => ({ args: [ctx.hook.command] }),
        hooks: {
          failClosed: { exitCode, stdout: "declared-deny" },
          codec: {
            decode: () => {
              throw Error("bad codec");
            },
            encode: () => {
              throw Error("unreachable");
            },
          },
        },
      }),
    });
    try {
      expect((await h.session.run("go")).error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain("declared-deny");
    } finally {
      await h.close();
    }
  });

for (const exitCode of [0, 2])
  test(`missing_socket_uses_fail_closed_${exitCode}`, async () => {
    const h = await harness({
      source: `import {unlinkSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).once('line',()=>{
 unlinkSync(process.argv[3]+'/relay.sock');
 const answer=spawnSync(process.argv[2],{input:'gate',encoding:'utf8',shell:true});
 console.log(JSON.stringify({kind:'notice',level:'info',code:'answer',message:JSON.stringify({status:answer.status,stdout:answer.stdout})})); console.log(JSON.stringify({type:'turn.done'})); });`,
      adapter: (a) => ({
        ...a,
        configure: (_, ctx) => ({ args: [ctx.hook.command, ctx.runDir.path] }),
        hooks: {
          failClosed: { exitCode, stdout: `socket-deny-${exitCode}` },
          codec: {
            decode: () => {
              throw Error("unreachable");
            },
            encode: () => {
              throw Error("unreachable");
            },
          },
        },
      }),
    });
    try {
      expect((await h.session.run("go")).error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain(`socket-deny-${exitCode}`);
    } finally {
      await h.close();
    }
  });
