import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { harness } from "./fixtures/harness.js";
import { rpcAdapter } from "./fixtures/rpc-adapter.js";

for (const transport of ["jsonl-stream", "json-rpc"] as const)
  test(`abort_within_grace_${transport}`, async () => {
    let ready: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const controller = new AbortController();
    const h = await harness({
      config: { graceMs: 300 },
      source: `import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const record=x=>appendFileSync(process.argv[2],x+'\\n');
process.on('SIGINT',()=>record('SIGINT'));process.on('SIGTERM',()=>record('SIGTERM'));
const rpc=${transport === "json-rpc"};const write=x=>console.log(JSON.stringify(x));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.method==='interrupt'){record('rpc');return;}
 if(rpc)write({jsonrpc:'2.0',id:m.id,result:{}});
 const activity={kind:'notice',level:'info',code:'ready',message:String(process.pid)};
 write(rpc?{jsonrpc:'2.0',method:'activity',params:activity}:activity);
}).on('close',()=>record('stdin'));
setInterval(()=>{},30000);`,
      adapter: (base) => ({
        ...(transport === "json-rpc" ? rpcAdapter(base) : base),
        open: () => [],
        configure: () => ({ args: [`${h.root}/steps`] }),
        abort: [
          ...(transport === "json-rpc" ? [{ rpc: "interrupt" } as const] : []),
          { closeStdin: true },
          { signal: "SIGINT" },
          { signal: "SIGTERM" },
        ],
        decode(frame) {
          const decoded = (transport === "json-rpc" ? rpcAdapter(base) : base).decode(frame);
          if (decoded.activity.some((a) => a.kind === "notice" && a.code === "ready")) ready();
          return decoded;
        },
      }),
    });
    try {
      const running = h.session.run("go", { signal: controller.signal });
      await started;
      const start = Date.now();
      controller.abort();
      await running;
      expect(Date.now() - start).toBeLessThan(500);
      const steps = readFileSync(`${h.root}/steps`, "utf8").trim().split("\n");
      expect(steps.slice(0, transport === "json-rpc" ? 4 : 3)).toEqual(
        transport === "json-rpc" ? ["rpc", "stdin", "SIGINT", "SIGTERM"] : ["stdin", "SIGINT", "SIGTERM"],
      );
    } finally {
      await h.close();
    }
  });

for (const transport of ["jsonl-stream", "json-rpc"] as const)
  test(`normal_completion_flushes_without_abort_steps_${transport}`, async () => {
    const h = await harness({
      config: { graceMs: 200 },
      source: `import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
const rpc=${transport === "json-rpc"};process.on('SIGINT',()=>{writeFileSync(process.argv[2],'bad');process.exit(1)});
createInterface({input:process.stdin}).once('line',line=>{const m=JSON.parse(line);if(rpc)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}}));console.log(JSON.stringify(rpc?{jsonrpc:'2.0',method:'turn.completed',params:{}}:{type:'turn.done'}));}).on('close',()=>{setTimeout(()=>{writeFileSync(process.argv[2],'flushed');process.exit(0)},50)});`,
      adapter: (base) => ({
        ...(transport === "json-rpc" ? rpcAdapter(base) : base),
        open: () => [],
        configure: () => ({ args: [`${h.root}/flush`] }),
        abort: [{ signal: "SIGINT" }],
      }),
    });
    try {
      expect((await h.session.run("go")).error).toBeUndefined();
      expect(readFileSync(`${h.root}/flush`, "utf8")).toBe("flushed");
    } finally {
      await h.close();
    }
  });

test("abort_during_final_flush_still_runs_abort_ladder", async () => {
  let completed: () => void = () => {};
  const turnEnd = new Promise<void>((resolve) => {
    completed = resolve;
  });
  const controller = new AbortController();
  const h = await harness({
    config: { graceMs: 300 },
    source: `import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{writeFileSync(process.argv[2],'aborted');process.exit(0)});createInterface({input:process.stdin}).once('line',()=>console.log(JSON.stringify({type:'turn.done'})));setInterval(()=>{},30000);`,
    adapter: (base) => ({
      ...base,
      configure: () => ({ args: [`${h.root}/flush-abort`] }),
      abort: [{ signal: "SIGTERM" }],
      decode(frame) {
        const decoded = base.decode(frame);
        if (decoded.turnEnd) completed();
        return decoded;
      },
    }),
  });
  try {
    const running = h.session.run("go", { signal: controller.signal });
    await turnEnd;
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await running;
    expect(readFileSync(`${h.root}/flush-abort`, "utf8")).toBe("aborted");
  } finally {
    await h.close();
  }
});
