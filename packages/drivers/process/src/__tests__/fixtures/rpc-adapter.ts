import type { ExternalActivity } from "@arnilo/prism";
import type { AgentAdapter } from "../../adapter.js";

export function rpcAdapter(base: AgentAdapter): AgentAdapter {
  return {
    ...base,
    transport: "json-rpc",
    open: () => [
      { method: "initialize" },
      { method: "initialized", notify: true },
      { method: "thread.start", onResult: () => ({ activity: [], sessionId: "thread-1" }) },
    ],
    encode: {
      prompt: (_, ctx) => ({ method: "turn.start", params: { session: ctx.sessionId ?? null }, onResult: () => undefined }),
      steer: () => ({ method: "turn.steer", onResult: () => undefined }),
      continue: (reason) => ({ method: "turn.start", params: { reason }, onResult: () => undefined }),
    },
    decode(frame) {
      if (frame && typeof frame === "object" && !Array.isArray(frame)) {
        if (frame.method === "activity") return { activity: [frame.params as unknown as ExternalActivity] };
        if (frame.method === "turn.completed") return { activity: [], turnEnd: true };
        if (frame.initialized) return { activity: [], sessionId: "initialized-session" };
      }
      return { activity: [], unmapped: true };
    },
  };
}

export function rpcSource(turn: string): string {
  return `import {createInterface} from 'node:readline';
const write=x=>console.log(JSON.stringify(x));
const notice=(code,message)=>write({jsonrpc:'2.0',method:'activity',params:{kind:'notice',level:'info',code,message}});
const done=()=>write({jsonrpc:'2.0',method:'turn.completed',params:{}});
const pending=new Map(); let nextId=100; const methods=[];
const request=(method,params={})=>new Promise(resolve=>{const id=nextId++;pending.set(id,resolve);write({jsonrpc:'2.0',id,method,params});});
createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);
 if(!m.method){pending.get(m.id)?.(m);pending.delete(m.id);return;}
 methods.push(m.method);
 if(m.method==='initialize'){write({jsonrpc:'2.0',id:m.id,result:{initialized:true}});return;}
 if(m.method==='thread.start'){write({jsonrpc:'2.0',id:m.id,result:{thread:'thread-1'}});return;}
 if(m.method==='turn.start') { write({jsonrpc:'2.0',id:m.id,result:{}}); ${turn} }
});`;
}
