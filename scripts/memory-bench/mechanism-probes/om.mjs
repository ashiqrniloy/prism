/** Plan 210 Task 2: observational-memory probes (observer, reflector, droppers, task state, compaction, recall). */
import { digest, events, packages, receivedText, responder } from "./harness.mjs";

const OM_MODEL = "worker/om";
const ids = (text) => [...new Set(text.match(/\b[0-9a-f]{12}\b/g) ?? [])];

/**
 * One agent with the real observational package. The worker answers whichever OM tool its request
 * offers: an observation per prompt entry, a reflection over shown observations, a drop, a task state.
 */
export async function omAgent({ config = {}, mainCalls = [], compaction, mainModel, reflect = true } = {}) {
  const { prism, testing } = await packages();
  const om = await import("@arnilo/prism-memory-system");
  const ev = await events();
  const requests = [];
  const workerCalls = { record_event: 0, record_reflection: 0, drop_observations: 0, record_task_state: 0 };
  const queue = [...mainCalls];
  const main = await responder(
    "mock",
    (request) => {
      if (request.messages.at(-1)?.role !== "tool" && queue.length) {
        const [call] = queue.splice(0, 1);
        return ev.call(call.name, call.args, `m${requests.length}`);
      }
      return ev.say("ok");
    },
    (request) =>
      requests.push(
        structuredClone({ context: request.context, messages: request.messages, tools: request.tools?.map((tool) => tool.name) }),
      ),
  );
  const worker = await responder("worker", (request) => {
    if (request.messages.some((message) => message.role === "tool")) return ev.say("");
    const tools = (request.tools ?? []).map((tool) => tool.name);
    const text = receivedText({ messages: request.messages });
    if (tools.includes("record_event")) {
      const source = /\[[^\]]+\] \[([^\]]+)\] message:/.exec(text)?.[1];
      workerCalls.record_event++;
      if (tools.includes("record_task_state") && /task/.test(text)) workerCalls.record_task_state++;
      return source
        ? [
            testing.providerToolCall(
              testing.toolCallContent("o1", "record_event", {
                kind: "statement",
                description: "User asked about the staging cluster",
                relevance: "high",
                sourceEntryIds: [source],
              }),
            ),
            testing.providerToolCall(
              testing.toolCallContent("o2", "record_event", {
                kind: "statement",
                description: "User mentioned lunch plans",
                relevance: "low",
                sourceEntryIds: [source],
              }),
            ),
            ...(tools.includes("record_task_state")
              ? [testing.providerToolCall(testing.toolCallContent("t1", "record_task_state", { goal: "migrate the staging cluster" }))]
              : []),
            testing.providerDone(),
          ]
        : ev.say("");
    }
    if (tools.includes("record_reflection")) {
      workerCalls.record_reflection++;
      if (!reflect) return ev.say("");
      const shown = ids(text);
      return shown.length
        ? ev.call("record_reflection", {
            content: "The user is migrating the staging cluster",
            supportingObservationIds: shown.slice(0, 2),
          })
        : ev.say("");
    }
    if (tools.includes("drop_observations")) {
      workerCalls.drop_observations++;
      const shown = ids(text);
      return ev.call("drop_observations", { observationIds: shown.slice(-1) });
    }
    return ev.say("");
  });
  const agent = await prism.createAgent({
    // OM fails closed without a context window (compactAt needs it), so the probe model declares one.
    model: mainModel ?? { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
    packages: [main, worker, om.default({ enabled: true, stm: { model: OM_MODEL, triggerTokens: 1 }, ...config })],
    ...(compaction ? { slots: { compaction } } : {}),
  });
  const session = await agent.session({ id: "om", create: true });
  const settle = async () => {
    for (let i = 0; i < 50; i++) await new Promise((done) => setTimeout(done, 2));
  };
  return {
    agent,
    session,
    requests,
    workerCalls,
    queueMain: (...calls) => queue.push(...calls),
    async run(text) {
      const results = [];
      const pump = (async () => {
        for await (const event of session.subscribe())
          if (event.type === "tool.completed") results.push({ name: event.name, result: event.result });
      })();
      await session.run(text);
      await pump;
      await settle();
      return results;
    },
    status: () => agent.commands.run("memory:session:status", {}, { session }),
    view: () => agent.commands.run("memory:session:view", {}, { session }),
    async close() {
      await session.close();
      await agent.dispose();
    },
  };
}

/** The OM block: the pinned context block (`observational-memory`) or OM's own compaction summary. */
const omBlock = (request) =>
  [...(request?.context ?? []), ...(request?.messages ?? [])].filter((item) =>
    /session-memory|# Session Memory/.test(JSON.stringify(item)),
  );

export const probes = [
  {
    id: "om.observer",
    async run() {
      const arm = async (enabled) => {
        const h = await omAgent({ config: { enabled } });
        try {
          await h.run("Where does the staging cluster run?");
          const status = await h.status();
          return { recorded: status.observations.recorded, calls: h.workerCalls.record_event, view: (await h.view()).text };
        } finally {
          await h.close();
        }
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "rendered-om-block",
        property: "past messageTokens the observer makes one call on its own model and records observations sourced from the new entries",
        fires: on.calls,
        reaches: digest(on.view) !== digest(off.view),
        correct: on.recorded === 2 && /staging cluster/.test(on.view) && off.calls === 0 && off.recorded === 0,
        on: digest(on.view),
        off: digest(off.view),
        counts: { observations: on.recorded },
      };
    },
  },
  {
    id: "om.reflector",
    async run() {
      const arm = async (observationTokens) => {
        const h = await omAgent({
          // Plan 216: `reflector` → `wm`, `dropper` → `rehearsal` (inert here, as before), which needs `ltm` on (Task 6).
          config: {
            wm: { model: OM_MODEL, observationTokens },
            rehearsal: { targetTokens: 2_000_000, policy: "lowest-relevance" },
            ltm: {},
          },
        });
        try {
          await h.run("Where does the staging cluster run?");
          await h.run("And the failover?");
          const status = await h.status();
          return { reflections: status.reflections.recorded, view: (await h.view()).text };
        } finally {
          await h.close();
        }
      };
      const on = await arm(1);
      const off = await arm(1_000_000);
      return {
        surface: "rendered-om-block",
        property: "past reflector.observationTokens the reflector condenses observations into a reflection that the rendered block shows",
        fires: on.reflections,
        reaches: digest(on.view) !== digest(off.view),
        correct: on.reflections >= 1 && /migrating the staging cluster/.test(on.view) && off.reflections === 0,
        on: digest(on.view),
        off: digest(off.view),
      };
    },
  },
  {
    id: "om.dropper-model",
    async run() {
      const arm = async (targetTokens) => {
        // The reflector declines, so the observation pool stays over the dropper's target.
        const h = await omAgent({
          reflect: false,
          config: {
            // Plan 216: `reflector` → `wm`, `dropper` → `rehearsal`, which needs `ltm` on (Task 6).
            wm: { model: OM_MODEL, observationTokens: targetTokens },
            rehearsal: { model: OM_MODEL, targetTokens, policy: "model" },
            ltm: {},
          },
        });
        try {
          await h.run("Where does the staging cluster run?");
          const status = await h.status();
          return { dropped: status.observations.dropped, calls: h.workerCalls.drop_observations, view: (await h.view()).text };
        } finally {
          await h.close();
        }
      };
      const on = await arm(1);
      const off = await arm(1_000_000);
      return {
        surface: "rendered-om-block",
        property: "over dropper.targetTokens the model dropper makes one call and the observations it names leave the active pool",
        fires: on.calls,
        reaches: digest(on.view) !== digest(off.view),
        correct: on.calls >= 1 && on.dropped >= 1 && off.dropped === 0,
        on: digest(on.view),
        off: digest(off.view),
        counts: { dropped: on.dropped },
      };
    },
  },
  {
    id: "om.dropper-lowest-relevance",
    async run() {
      const arm = async (targetTokens) => {
        const h = await omAgent({
          reflect: false,
          config: {
            wm: { model: OM_MODEL, observationTokens: targetTokens },
            rehearsal: { targetTokens, policy: "lowest-relevance" },
            ltm: {},
          },
        });
        try {
          await h.run("Where does the staging cluster run?");
          const status = await h.status();
          return { dropped: status.observations.dropped, calls: h.workerCalls.drop_observations, view: (await h.view()).text };
        } finally {
          await h.close();
        }
      };
      const on = await arm(1);
      const off = await arm(1_000_000);
      return {
        surface: "rendered-om-block",
        property: "lowest-relevance drops the lowest-relevance observations first with no model call",
        fires: on.dropped,
        reaches: digest(on.view) !== digest(off.view),
        correct: on.dropped >= 1 && on.calls === 0 && !/lunch plans/.test(on.view) && /lunch plans/.test(off.view),
        on: digest(on.view),
        off: digest(off.view),
      };
    },
  },
  {
    id: "om.task-state",
    async run() {
      const h = await omAgent();
      try {
        await h.run("Help me with the task of migrating the staging cluster.");
        const view = (await h.view()).text;
        return {
          surface: "rendered-om-block",
          property: "the observer's record_task_state replaces the current task section the rendered block shows",
          control: "trigger-absent",
          fires: /migrate the staging cluster/.test(view) ? 1 : 0,
          reaches: /migrate the staging cluster/.test(view),
          correct: /migrate the staging cluster/.test(view),
          on: digest(view),
          off: digest(""),
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    id: "om.compaction",
    async run() {
      const arm = async (enabled) => {
        const h = await omAgent({ config: { enabled } });
        try {
          await h.run("Where does the staging cluster run?");
          await h.session.compact();
          await h.run("And the failover?");
          const entries = await h.session.entries();
          const compaction = entries.filter((entry) => entry.kind === "compaction").at(-1);
          return { strategy: compaction?.data?.strategy, block: omBlock(h.requests.at(-1)) };
        } finally {
          await h.close();
        }
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "request",
        property:
          "OM owns the compaction slot: a compaction is built from the ledger and the next request carries the observational-memory block",
        fires: on.strategy && on.strategy !== "default-compaction" ? 1 : 0,
        reaches: digest(on.block) !== digest(off.block),
        correct:
          on.strategy !== undefined &&
          on.strategy !== "default-compaction" &&
          /staging cluster/.test(JSON.stringify(on.block)) &&
          off.block.length === 0,
        on: digest(on.block),
        off: digest(off.block),
      };
    },
  },
  {
    id: "om.recall-tool",
    async run() {
      const arm = async (recall) => {
        const h = await omAgent({ config: { recall } });
        try {
          await h.run("Where does the staging cluster run?");
          // The tool reads by exact observation id (or pages raw messages by cursor); take an id from the ledger view.
          const id = /\[([0-9a-f]{12})\][^\n]*staging cluster/.exec((await h.view()).text)?.[1] ?? "000000000000";
          h.queueMain({ name: "recall", args: { id } });
          const results = await h.run("what did I ask before?");
          const tools = h.requests.at(-1)?.tools ?? [];
          return {
            text: results.map((row) => receivedText({ messages: [{ content: row.result.content }] })).join("\n"),
            visible: tools.includes("recall"),
          };
        } finally {
          await h.close();
        }
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "tool-result",
        property: "the OM recall tool reads this session's observation by exact id (and pages raw messages by cursor)",
        fires: /staging cluster/.test(on.text) ? 1 : 0,
        reaches: digest(on.text) !== digest(off.text),
        correct: on.visible && /staging cluster/.test(on.text) && !off.visible,
        on: digest(on.text),
        off: digest(off.text),
      };
    },
  },
  {
    id: "om.pinned-context",
    async run() {
      let compactions = 0;
      const foreign = { name: "foreign", compact: () => ({ summary: `foreign summary ${++compactions}` }) };
      const h = await omAgent({ compaction: foreign });
      try {
        await h.run("Where does the staging cluster run?");
        await h.session.compact();
        await h.run("two");
        const first = omBlock(h.requests.at(-1));
        await h.run("three");
        const second = omBlock(h.requests.at(-1));
        const status = await h.status();
        return {
          surface: "request",
          property:
            "under a foreign compactor, OM pins its ledger block after the compaction and keeps it byte-identical; it never forces the foreign owner",
          control: "trigger-absent",
          fires: status.contextMode === "pinned" ? 1 : 0,
          reaches: first.length > 0,
          correct: status.contextMode === "pinned" && digest(first) === digest(second) && compactions === 1,
          on: digest(first),
          off: digest(second),
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    id: "om.commands",
    async run() {
      const h = await omAgent({ config: { enabled: false } });
      try {
        const before = await h.status();
        const toggled = await h.agent.commands.run("memory:session", {}, { session: h.session });
        await h.run("Where does the staging cluster run?");
        const after = await h.status();
        const view = await h.view();
        return {
          surface: "command-result",
          property: "om toggles the session, om:status reports counts and pass state, om:view renders the ledger",
          fires: toggled?.enabled === true ? 1 : 0,
          reaches: before.observations.recorded !== after.observations.recorded,
          correct: before.enabled === false && after.enabled === true && after.observations.recorded === 2 && view.observations === 2,
          on: digest(after.observations),
          off: digest(before.observations),
          finding: "Inspectability now rests on the named test om_commands_expose_session_state_for_inspection (observational.test.ts).",
        };
      } finally {
        await h.close();
      }
    },
  },
];
