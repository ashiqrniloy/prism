import { createMemoryPolicyDecisionStore, createPolicyEvaluator, evaluateAndAppend, exportPolicyDecisions } from "@arnilo/prism-policy";
const identity = {
    tenantId: "tenant-a",
    userId: "user-1",
    principal: { kind: "user", id: "user-1" },
    scopes: ["Mail.Send"],
    issuedAt: new Date().toISOString(),
    verified: true,
};
/** Network-free policy evaluate → append → cursor export. */
export async function demo() {
    const store = createMemoryPolicyDecisionStore();
    const evaluator = createPolicyEvaluator({
        policyId: "mail-external",
        policyVersion: "2026-07-23",
        evaluate: ({ action }) => action === "mail.send"
            ? { outcome: "approval", reason: "external recipient", evidenceRefs: ["rule:external-send"] }
            : { outcome: "allow" },
    });
    const record = await evaluateAndAppend({
        identity,
        action: "mail.send",
        resource: { kind: "message", id: "draft-1" },
    }, { store, evaluator, id: "decision-1" });
    const pages = [];
    for await (const page of exportPolicyDecisions({
        store,
        tenantId: "tenant-a",
        userId: "user-1",
    })) {
        pages.push(page.items.length);
    }
    return { outcome: record.outcome, exportPages: pages.length };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(await demo()));
}
