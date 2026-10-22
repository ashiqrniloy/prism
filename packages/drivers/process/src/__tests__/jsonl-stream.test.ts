import { expect, test } from "bun:test";
import type { ExternalActivity } from "@arnilo/prism";
import { harness } from "./fixtures/harness.js";

const activities: ExternalActivity[] = [
  { kind: "message.delta", content: { type: "text", text: "hello" } },
  { kind: "message.delta", content: { type: "thinking", text: "thinking" } },
  { kind: "tool.started", call: { id: "t", name: "read" } },
  { kind: "tool.completed", toolCallId: "t", status: "finished", result: "ok" },
  { kind: "skill", name: "review", source: "native", resolved: true },
  { kind: "subagent", phase: "started", id: "child", parentToolCallId: "t" },
  { kind: "subagent", phase: "completed", id: "child" },
];

test("jsonl_turn_observes_every_activity_in_order", async () => {
  const seen: ExternalActivity[] = [];
  const h = await harness({
    script: [...activities.map((out) => ({ out })), { out: { type: "turn.done" } }],
    adapter: (base) => ({
      ...base,
      decode(frame) {
        const decoded = base.decode(frame);
        seen.push(...decoded.activity);
        return decoded;
      },
    }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(seen).toEqual(activities);
    expect(h.events.map((e: any) => (e.type === "package.event" ? e.name : e.type))).toEqual([
      "message.delta",
      "message.delta",
      "tool.started",
      "tool.completed",
      "agent.skill",
      "agent.subagent",
      "agent.subagent",
    ]);
  } finally {
    await h.close();
  }
});

test("open_precedes_prompt_and_session_id_is_recorded", async () => {
  const h = await harness({
    source: `import {createInterface} from 'node:readline';
const lines=[]; createInterface({input:process.stdin}).on('line', line=>{
 lines.push(JSON.parse(line)); if(lines.length===2){
 console.log(JSON.stringify({session:'session-1'}));
 console.log(JSON.stringify({kind:'notice',level:'info',code:'input',message:JSON.stringify(lines)}));
 console.log(JSON.stringify({type:'turn.done'})); }
});`,
    adapter: (a) => ({
      ...a,
      open: () => [{ init: true }],
      session: { strategy: "vendor" },
      descriptor: { ...a.descriptor, controls: { ...a.descriptor.controls, resume: "vendor" } },
      decode(frame) {
        if (typeof frame === "object" && frame !== null && "session" in frame) return { activity: [], sessionId: "session-1" };
        return a.decode(frame);
      },
    }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(JSON.stringify(h.events)).toContain("init");
    const entries = await h.store.list(h.session.id);
    expect(JSON.stringify(entries)).toContain("session-1");
  } finally {
    await h.close();
  }
});

test("invalid_json_is_unmapped_and_does_not_end_turn", async () => {
  const h = await harness({
    source: `import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).once('line',()=>{
 console.log('invalid json'); console.log(JSON.stringify({kind:'notice',level:'info',code:'after-invalid',message:'ok'})); console.log(JSON.stringify({type:'turn.done'}));
});`,
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(JSON.stringify(h.events)).toContain("after-invalid");
  } finally {
    await h.close();
  }
});

test("exit_before_turn_end_has_redacted_stderr", async () => {
  const h = await harness({
    source: `import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).once('line',()=>{console.error(process.env.SECRET);process.exit(1)});`,
    adapter: (a) => ({ ...a, configure: () => ({ env: { SECRET: "canary-secret-98765" } }) }),
  });
  try {
    const result = await h.session.run("go");
    expect(result.error?.message).toContain("vendor_process_exited");
    expect(result.error?.message).toContain("[REDACTED]");
    expect(JSON.stringify([result, h.agent.inspect()])).not.toContain("canary-secret-98765");
  } finally {
    await h.close();
  }
});

test("oversized_jsonl_line_fails_and_cleans_up", async () => {
  const h = await harness({
    source: `import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).once('line',()=>{console.log('x'.repeat(1024*1024+1));});`,
  });
  try {
    expect((await h.session.run("go")).error?.message).toContain("jsonl_line_too_long");
  } finally {
    await h.close();
  }
});

test("jsonl_string_frame_is_json_encoded", async () => {
  const h = await harness({
    source: `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).once('line',line=>{console.log(JSON.stringify({kind:'notice',level:'info',code:'string',message:JSON.parse(line)}));console.log(JSON.stringify({type:'turn.done'}));});`,
    adapter: (a) => ({ ...a, encode: { prompt: () => "string with\nnewline" } }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(JSON.stringify(h.events)).toContain("newline");
  } finally {
    await h.close();
  }
});
