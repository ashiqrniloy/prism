import { createAgUiMcpAppHandler, createAgUiMcpAppSandbox } from "@arnilo/prism-ag-ui";
const apps = {
    serverId: "demo",
    negotiated: true,
    tools: [
        { name: "refresh", prismName: "mcp:demo:refresh", inputSchema: { type: "object" }, resourceUri: "ui://demo/card", visibility: ["app"] },
    ],
    listResources: async () => [{ uri: "ui://demo/card", name: "demo", mimeType: "text/html;profile=mcp-app" }],
    readResource: async () => ({
        uri: "ui://demo/card",
        name: "demo",
        mimeType: "text/html;profile=mcp-app",
        html: "<!doctype html><html><body>demo</body></html>",
        ui: { csp: { connectDomains: ["https://api.example.test"] } },
    }),
    callTool: async (_name, _args, context) => ({ toolCallId: context.toolCallId, name: "mcp:demo:refresh", value: { refreshed: true } }),
};
export async function demo() {
    const proxy = createAgUiMcpAppHandler({
        apps,
        authorize: () => ({ ownership: { tenantId: "demo", userId: "demo" } }),
        context: ({ messageId }) => ({ sessionId: "demo-session", runId: "demo-run", toolCallId: `app:${messageId}` }),
        approveToolCall: () => true,
        allowedOrigins: ["https://host.example.test"],
    });
    const response = await proxy(new Request("https://host.example.test/mcp-app", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://host.example.test" },
        body: JSON.stringify({
            serverId: "demo",
            message: { jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "ui://demo/card" } },
        }),
    }));
    const resource = (await response.json());
    const sandbox = createAgUiMcpAppSandbox(await apps.readResource("ui://demo/card"));
    return { status: response.status, html: resource.result.contents[0]?.text.includes("demo"), sandbox: sandbox.sandbox };
}
if (import.meta.main)
    console.log(JSON.stringify(await demo()));
