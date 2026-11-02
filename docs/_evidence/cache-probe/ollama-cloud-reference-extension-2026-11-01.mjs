import { readFileSync, writeFileSync } from 'node:fs';
export default function(pi) {
 const input = JSON.parse(readFileSync(process.env.PRISM_OLLAMA_REFERENCE_INPUT, 'utf8'));
 const metrics = {requests:0,ttftMs:null};
 let start;
 const originalFetch=globalThis.fetch;
 let generations=0;
 globalThis.fetch=async (...args)=>{
   const url=String(args[0]?.url??args[0]);
   if(!url.startsWith('https://ollama.com/v1/chat/completions')) throw new Error('Reference: unexpected endpoint');
   if(++generations>1) throw new Error('Reference: generation budget exceeded');
   return originalFetch(...args);
 };
 pi.on('context_with_system',()=>({messages:input.messages}));
 pi.on('before_provider_request',(event)=>{
   start=performance.now();
   metrics.requests++;
   const payload={...event.payload,max_tokens:128};
   delete payload.max_completion_tokens;
   writeFileSync(process.env.PRISM_OLLAMA_REFERENCE_BODY, JSON.stringify(payload));
   return payload;
 });
 pi.on('message_update',(event)=>{
   const e=event.assistantMessageEvent;
   if(e.type==='text_delta' && e.delta && metrics.ttftMs===null) metrics.ttftMs=performance.now()-start;
 });
 pi.on('message_end',(event)=>{
   if(event.message.role!=='assistant') return;
   metrics.latencyMs=performance.now()-start;
   metrics.usage=event.message.usage;
   metrics.stopReason=event.message.stopReason;
   writeFileSync(process.env.PRISM_OLLAMA_REFERENCE_METRICS,JSON.stringify(metrics));
 });
}
