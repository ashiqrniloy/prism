import { assertIdentityActive, assertIdentityPropagation, narrowIdentity } from "@arnilo/prism";
/** Network-free verified identity narrowing and propagation checks. */
export async function demo() {
    const parent = {
        tenantId: "tenant-a",
        userId: "user-1",
        principal: { kind: "user", id: "user-1" },
        scopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite"],
        issuedAt: new Date().toISOString(),
        verified: true,
    };
    assertIdentityActive(parent);
    const child = narrowIdentity(parent, { scopes: ["Mail.Read"] });
    assertIdentityPropagation(parent, child);
    return { tenantId: child.tenantId, scopes: child.scopes, verified: child.verified };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(await demo()));
}
