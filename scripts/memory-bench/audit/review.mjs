import { cohensKappa } from "@arnilo/prism-evals";
import { stableHash } from "../journal.mjs";

export const AUDIT_KAPPA_MIN = 0.8;
export const AUDIT_VERDICTS = ["correct", "incorrect"];

const escape = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * 150 items balanced by ability: each ability is shuffled deterministically and drawn round-robin,
 * so a large suite cannot crowd out abstention or a small coding suite.
 */
export function selectAuditItems(rows, { n = 150, seed = "prism-202-judge-audit" } = {}) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("MemoryBenchAudit: n must be a positive integer");
  const eligible = rows.filter((row) => typeof row.correct === "boolean" && typeof row.answer === "string" && row.answer.trim());
  const groups = new Map();
  for (const row of eligible) {
    const ability = row.ability ?? "unknown";
    if (!groups.has(ability)) groups.set(ability, []);
    groups.get(ability).push(row);
  }
  const queues = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ability, items]) => [
      ability,
      [...items].sort((a, b) => stableHash(`${seed}:${a.id}`).localeCompare(stableHash(`${seed}:${b.id}`))),
    ]);
  const selected = [];
  for (let index = 0; selected.length < n; index++) {
    let any = false;
    for (const [, queue] of queues) {
      if (queue[index]) {
        selected.push(queue[index]);
        any = true;
        if (selected.length >= n) break;
      }
    }
    if (!any) break;
  }
  return selected;
}

/** The page is a local file: text lives here and in the answer cache, never in a report or label file. */
export function renderReviewPage(items, { title = "Memory bench judge audit" } = {}) {
  const payload = JSON.stringify(
    items.map((item) => ({ id: item.id, ability: item.ability, question: item.question, gold: item.gold, answer: item.answer })),
  ).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>body{font:15px/1.5 system-ui;margin:2rem auto;max-width:60rem;padding:0 1rem}
.card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
.meta{color:#666;font-size:12px}pre{white-space:pre-wrap;background:#f6f6f6;padding:.5rem}
button{margin-right:.5rem;padding:.4rem .8rem}</style></head>
<body><h1>${escape(title)}</h1>
<p class="meta">Text stays in this file. The downloaded labels contain ids and verdicts only.</p>
<p><button id="download" disabled>Download labels</button> <span id="count"></span></p>
<div id="items"></div>
<script>
const items=${payload};
const labels=JSON.parse(localStorage.getItem("prism-audit-labels")||"{}");
const box=document.getElementById("items");
function render(){
  box.innerHTML="";
  for(const item of items){
    const card=document.createElement("div");card.className="card";
    const meta=document.createElement("div");meta.className="meta";meta.textContent=item.ability+" · "+item.id;
    const q=document.createElement("p");q.textContent=item.question;
    const gold=document.createElement("pre");gold.textContent="Gold: "+item.gold;
    const answer=document.createElement("pre");answer.textContent="Answer: "+item.answer;
    const ok=document.createElement("button");ok.textContent="Correct";
    const no=document.createElement("button");no.textContent="Incorrect";
    ok.onclick=()=>{labels[item.id]="correct";render()};
    no.onclick=()=>{labels[item.id]="incorrect";render()};
    if(labels[item.id]) card.style.borderColor=labels[item.id]==="correct"?"#2a7":"#c33";
    card.append(meta,q,gold,answer,ok,no);box.append(card);
  }
  const done=Object.keys(labels).length;
  document.getElementById("count").textContent=done+"/"+items.length;
  document.getElementById("download").disabled=done===0;
}
document.getElementById("download").onclick=()=>{
  const rows=Object.entries(labels).sort(([a],[b])=>a.localeCompare(b)).map(([id,verdict])=>({id,verdict}));
  const blob=new Blob([JSON.stringify({items:rows},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="judge-audit-labels.json";a.click();
};
render();
</script></body></html>
`;
}

/** Label files are ids and verdicts only; a text field is a hard error, not something to ignore. */
export function parseAuditLabels(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(rows) || !rows.length) throw new Error("MemoryBenchAudit: labels must be a nonempty array");
  const seen = new Set();
  const labels = rows.map((row) => {
    if (!row || typeof row.id !== "string" || !row.id.trim()) throw new Error("MemoryBenchAudit: label id");
    if (!AUDIT_VERDICTS.includes(row.verdict)) throw new Error("MemoryBenchAudit: label verdict");
    if (Object.keys(row).some((key) => key !== "id" && key !== "verdict"))
      throw new Error("MemoryBenchAudit: labels must contain only id and verdict");
    if (seen.has(row.id)) throw new Error("MemoryBenchAudit: duplicate label id");
    seen.add(row.id);
    return { id: row.id, verdict: row.verdict };
  });
  return labels;
}

/**
 * Per-judge kappa against the human labels. A judge is dropped below the floor; text never enters
 * this result, only ids and counts.
 */
export function auditKappas(rows, labels, refs, { threshold = AUDIT_KAPPA_MIN } = {}) {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const pairs = labels.map((label) => ({ label, row: byId.get(label.id) })).filter(({ row }) => row);
  const judges = {};
  for (const ref of refs) {
    const usable = pairs.filter(({ row }) => row.judgeVerdicts?.[ref]);
    const human = usable.map(({ label }) => (label.verdict === "correct" ? 1 : 0));
    const judged = usable.map(({ row }) => (row.judgeVerdicts[ref] === "yes" ? 1 : 0));
    judges[ref] = { n: usable.length, kappa: human.length ? (cohensKappa(human, judged) ?? null) : null };
  }
  const active = refs.filter((ref) => typeof judges[ref].kappa === "number" && judges[ref].kappa >= threshold);
  return {
    n: pairs.length,
    threshold,
    judges,
    active,
    dropped: refs.filter((ref) => !active.includes(ref)),
  };
}
