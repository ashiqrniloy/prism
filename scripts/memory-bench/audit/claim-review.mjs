/**
 * Plan 208 Task 2: the human side of the claim-support audit. Same discipline as `review.mjs`: the
 * review page is a local file that holds claim and note text; the downloaded labels hold claim ids and
 * verdicts only. The page never shows a panel label (label-blind).
 */
import { stableHash } from "../journal.mjs";

export const CLAIM_LABELS = Object.freeze(["supported", "partially-supported", "unsupported", "contradicted"]);
export const HUMAN_AUDIT_CLAIMS = 60;

const escape = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * Stratified, seeded draw: claims are grouped by `stratum`, each group is ordered by a hash that
 * depends only on the seed and the claim id, and groups are drawn round-robin. Label-blind by
 * construction: nothing about a claim's text or panel label enters the order.
 */
export function drawStratified(claims, { n, seed, forced = [] }) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("MemoryBenchAudit: sample size must be a positive integer");
  const forcedIds = new Set(forced.map((claim) => claim.id));
  const selected = forced.slice(0, n);
  const groups = new Map();
  for (const claim of claims) {
    if (forcedIds.has(claim.id)) continue;
    if (!groups.has(claim.stratum)) groups.set(claim.stratum, []);
    groups.get(claim.stratum).push(claim);
  }
  const queues = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => [...items].sort((a, b) => stableHash(`${seed}:${a.id}`).localeCompare(stableHash(`${seed}:${b.id}`))));
  for (let index = 0; selected.length < n; index++) {
    let any = false;
    for (const queue of queues) {
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

/** The 60-claim human set. Development partitions only: a claim from any other partition is refused. */
export function selectHumanAuditClaims(claims, { n = HUMAN_AUDIT_CLAIMS, seed = "prism-208-human-claim-audit" } = {}) {
  const outside = claims.find((claim) => claim.partition !== "dev");
  if (outside) throw new Error("MemoryBenchAudit: the human audit set is drawn from development partitions only");
  return drawStratified(claims, { n, seed });
}

/** Local review page. Claim and cited-note text live here only. */
export function renderClaimReviewPage(items, { title = "Ontology claim-support audit" } = {}) {
  const payload = JSON.stringify(items.map((item) => ({ id: item.id, claim: item.claim, notes: item.notes }))).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>body{font:15px/1.5 system-ui;margin:2rem auto;max-width:60rem;padding:0 1rem}
.card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
.meta{color:#666;font-size:12px}pre{white-space:pre-wrap;background:#f6f6f6;padding:.5rem}
button{margin-right:.5rem;padding:.4rem .8rem}</style></head>
<body><h1>${escape(title)}</h1>
<p>For each claim, decide whether the cited notes below fully support it. Use only those notes.
<b>supported</b>: all of it follows. <b>partially-supported</b>: some of it follows. <b>unsupported</b>: the notes do not establish it.
<b>contradicted</b>: a note says the opposite.</p>
<p class="meta">Text stays in this file. The downloaded labels contain ids and verdicts only.</p>
<p><button id="download" disabled>Download labels</button> <span id="count"></span></p>
<div id="items"></div>
<script>
const items=${payload};
const kinds=${JSON.stringify(CLAIM_LABELS)};
const labels=JSON.parse(localStorage.getItem("prism-claim-audit-labels")||"{}");
const box=document.getElementById("items");
function render(){
  box.innerHTML="";
  for(const item of items){
    const card=document.createElement("div");card.className="card";
    const meta=document.createElement("div");meta.className="meta";meta.textContent=item.id;
    const claim=document.createElement("p");claim.textContent="Claim: "+item.claim;
    card.append(meta,claim);
    item.notes.forEach((note,i)=>{const pre=document.createElement("pre");pre.textContent="["+(i+1)+"] "+note;card.append(pre)});
    for(const kind of kinds){
      const b=document.createElement("button");b.textContent=kind+(labels[item.id]===kind?" ✓":"");
      b.onclick=()=>{labels[item.id]=kind;localStorage.setItem("prism-claim-audit-labels",JSON.stringify(labels));render()};
      card.append(b);
    }
    box.append(card);
  }
  const done=Object.keys(labels).length;
  document.getElementById("count").textContent=done+"/"+items.length;
  document.getElementById("download").disabled=done===0;
}
document.getElementById("download").onclick=()=>{
  const rows=Object.entries(labels).sort(([a],[b])=>a.localeCompare(b)).map(([id,verdict])=>({id,verdict}));
  const blob=new Blob([JSON.stringify({items:rows},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="claim-audit-labels.json";a.click();
};
render();
</script></body></html>
`;
}

/** Label files are ids and verdicts only; a text field is a hard error, not something to ignore. */
export function parseClaimLabels(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(rows) || !rows.length) throw new Error("MemoryBenchAudit: labels must be a nonempty array");
  const seen = new Set();
  return rows.map((row) => {
    if (!row || typeof row.id !== "string" || !row.id.trim()) throw new Error("MemoryBenchAudit: label id");
    if (!CLAIM_LABELS.includes(row.verdict)) throw new Error("MemoryBenchAudit: label verdict");
    if (Object.keys(row).some((key) => key !== "id" && key !== "verdict"))
      throw new Error("MemoryBenchAudit: labels must contain only id and verdict");
    if (seen.has(row.id)) throw new Error("MemoryBenchAudit: duplicate label id");
    seen.add(row.id);
    return { id: row.id, verdict: row.verdict };
  });
}
