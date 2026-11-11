import { askEveryTool, createAgent, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import sqliteStore from "@arnilo/prism-extensions/store-sqlite";
import { createResumeAuthority, routeHostUi } from "../../index.js";

const [path, mode, id] = process.argv.slice(2);
let executed = 0;
const first = [{ type: "tool_call", call: { type: "tool_call", id: "call", name: "deploy", arguments: {} } }, { type: "done" }];
const last = [providerTextDelta("finished"), { type: "done" }];
const agent = await createAgent({
  id: "restart-test",
  model: { provider: "mock", model: "test" },
  hooks: askEveryTool(),
  packages: [mockProvider(mode === "resume" ? [last] : [first, last]), sqliteStore({ path })],
  tools: {
    add: [
      {
        name: "deploy",
        parameters: { type: "object", properties: {} },
        execute(_args, context) {
          executed++;
          return { name: "deploy", toolCallId: context.toolCallId, value: "done" };
        },
      },
    ],
  },
});
const session = await agent.session(id ? { id } : {});
if (mode === "suspend") console.log(JSON.stringify({ id: session.id, status: (await session.run("deploy")).status }));
else {
  const router = routeHostUi(
    [
      {
        name: "channel",
        ui: {
          async request() {
            return { status: "answered", value: true };
          },
        },
      },
    ],
    { resumeAuthority: createResumeAuthority(agent) },
  );
  const result = await router.resumeWhenAnswered(session);
  let terminal = "";
  if (result.status === "resumed") for await (const event of result.events) terminal = event.type;
  console.log(JSON.stringify({ status: result.status, terminal, executed }));
}
await agent.dispose();
