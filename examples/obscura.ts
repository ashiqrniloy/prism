/**
 * Obscura composition example (plan 039): one host-installed binary, three generic
 * surfaces — agent tools, managed CDP + Playwright, and the full MCP surface.
 * Install first: `npm install @arnilo/prism-obscura` and install the Obscura CLI
 * (https://github.com/h4ckf0r0day/obscura). Every factory fails closed until the
 * binary exists; hosts need no Obscura-specific branch because everything here is
 * a plain `ToolDefinition[]`.
 */
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createBrowserTools } from "@arnilo/prism-browser";
import { createPrismMcpServer } from "@arnilo/prism-mcp";
import {
  connectObscuraCdp,
  createObscuraMcpTools,
  createObscuraWebTools,
  DEFAULT_OBSCURA_PROCESS_LIMITS,
  validateObscuraCommand,
} from "@arnilo/prism-obscura";

const OBSCURA = "/usr/local/bin/obscura";

export async function demo() {
  validateObscuraCommand({ command: OBSCURA }, DEFAULT_OBSCURA_PROCESS_LIMITS);

  // 1. Bounded CLI web tools: web_search/web_fetch + obscura_fetch/obscura_scrape.
  const web = createObscuraWebTools({ command: OBSCURA });

  // 2. Managed CDP server + Playwright browser composed into generic browser tools.
  const cdp = await connectObscuraCdp({ command: OBSCURA, args: ["serve", "--port", "9222"] });
  const browser = createBrowserTools({ browser: cdp.browser });

  // 3. Full Obscura MCP surface (navigation, snapshots, interaction, capture).
  const mcp = await createObscuraMcpTools({ transport: { type: "stdio", command: OBSCURA, args: ["mcp"] } });

  // The same ToolDefinition[] works in every Prism host (sessions, MCP server,
  // server handler, AG-UI/ACP, workflows, supervisors, Antigravity exposure).
  const agent = createAgent({
    model: { provider: "openai", model: "gpt-5.2" },
    provider: createMockProvider([providerTextDelta("demo"), providerDone()]), // replace with a real provider
    tools: [...web.tools, ...browser, ...mcp.tools],
  });
  void agent;

  await mcp.close();
  await cdp.close(); // closes the browser, then the owned `obscura serve` child
  void createPrismMcpServer;
}

void demo;
