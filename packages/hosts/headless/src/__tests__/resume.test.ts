import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, createMemorySessionStore, type HostUi, type HostUiResponse, type Session } from "@arnilo/prism";
import { createDispatcher, createMemoryTransportPair, pendingDecisionsOf as remotePending, serveAgent } from "@arnilo/prism-hosts/remote";
import { createResumeAuthority, policyDefault, routeHostUi } from "../index.js";
import { pendingDecisionsOf } from "../pending.js";
import { build } from "./fixtures/agent.js";

const ui = (value: HostUiResponse): HostUi => ({
  async request() {
    return value as never;
  },
});
const collect = async (events: AsyncIterable<AgentEvent>) => {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function suspended(options: Parameters<typeof build>[0] = {}) {
  const built = await build(options);
  const session = await built.agent.session();
  expect((await session.run("deploy")).status).toBe("suspended");
  return { ...built, session, authority: createResumeAuthority(built.agent) };
}

test("later_channel_answer_resumes_run", async () => {
  const first = deferred<HostUiResponse>();
  const later = deferred<HostUiResponse>();
  let calls = 0;
  const routes = [
    { name: "client", ui: ui({ status: "unavailable" }) },
    { name: "channel", timeoutMs: 1, ui: { request: () => (++calls === 1 ? first.promise : later.promise) as never } },
    policyDefault(),
  ];
  const inline = routeHostUi(routes);
  const { agent, session, authority, executed } = await suspended({ ui: inline });
  const router = routeHostUi(routes, { resumeAuthority: authority });
  const resultPromise = router.resumeWhenAnswered(session);
  later.resolve({ status: "answered", value: true });
  const result = await resultPromise;
  expect(result.status).toBe("resumed");
  if (result.status === "resumed") expect((await collect(result.events)).at(-1)?.type).toBe("run.completed");
  expect(executed()).toBe(1);
  const rows = await router.answers();
  expect(rows.at(-1)).toMatchObject({ route: "channel", kind: "confirm", status: "answered", approvalId: expect.any(String) });
  expect(await router.resumeWhenAnswered(session)).toEqual({ status: "already_resolved" });
  first.resolve({ status: "answered", value: true });
  await agent.dispose();
});

test("dismissed_becomes_deny_with_route", async () => {
  const { agent, session, authority, executed } = await suspended();
  const applied: unknown[] = [];
  const observed = {
    ...authority,
    resume(...args: Parameters<typeof authority.resume>) {
      applied.push(...args[1]);
      return authority.resume(...args);
    },
  };
  const router = routeHostUi([{ name: "channel", ui: ui({ status: "dismissed" }) }], { resumeAuthority: observed });
  const result = await router.resumeWhenAnswered(session);
  if (result.status !== "resumed") throw new Error(result.status);
  const events = await collect(result.events);
  expect(
    events.some((event) => event.type === "decision.resolved" && event.decisions.some((decision) => decision.outcome === "deny")),
  ).toBe(true);
  expect(applied).toMatchObject([{ outcome: "reject_once", reason: "dismissed via channel" }]);
  expect(executed()).toBe(0);
  await agent.dispose();
});

test("elicitation_answer_validated_by_kernel", async () => {
  const { agent, session, authority } = await suspended({ elicitation: true });
  let kind = "";
  let value = "z";
  const router = routeHostUi(
    [
      {
        name: "channel",
        ui: {
          async request(request) {
            kind = request.kind;
            return { status: "answered", value } as never;
          },
        },
      },
    ],
    { resumeAuthority: authority },
  );
  const wrong = await router.resumeWhenAnswered(session);
  expect(kind).toBe("select");
  if (wrong.status !== "resumed") throw new Error(wrong.status);
  await expect(collect(wrong.events)).rejects.toMatchObject({ code: "ERR_PRISM_DECISION_INVALID" });
  expect(pendingDecisionsOf(await session.entries())).toHaveLength(1);
  value = "a";
  const right = await router.resumeWhenAnswered(session);
  if (right.status !== "resumed") throw new Error(right.status);
  expect((await collect(right.events)).at(-1)?.type).toBe("run.completed");
  await agent.dispose();
});

test("foreign_session_not_offered_and_forged_object_not_used", async () => {
  const store = createMemorySessionStore();
  const foreign = await suspended({ store, ownership: { tenantId: "foreign" } });
  const local = await suspended({ store, ownership: { tenantId: "local" } });
  let asked = 0;
  const router = routeHostUi(
    [
      {
        name: "channel",
        ui: {
          async request() {
            asked++;
            return { status: "answered", value: true } as never;
          },
        },
      },
    ],
    { resumeAuthority: local.authority, ownership: { tenantId: "local" } },
  );
  await expect(router.resumeWhenAnswered(foreign.session)).rejects.toMatchObject({ code: "session_not_found" });
  expect(asked).toBe(0);
  const forged = {
    id: local.session.id,
    entries() {
      throw new Error("foreign reader");
    },
    resume() {
      throw new Error("foreign resume");
    },
  } as unknown as Session;
  const result = await router.resumeWhenAnswered(forged);
  if (result.status !== "resumed") throw new Error(result.status);
  await collect(result.events);
  expect(local.executed()).toBe(1);
  expect(foreign.executed()).toBe(0);
  await foreign.agent.dispose();
  await local.agent.dispose();
});

test("abort_signal_stops_waiting_and_discards_late_answer", async () => {
  const { agent, session, authority, executed } = await suspended();
  const answer = deferred<HostUiResponse>();
  const asked = deferred<void>();
  const router = routeHostUi(
    [
      {
        name: "channel",
        ui: {
          request() {
            asked.resolve();
            return answer.promise as never;
          },
        },
      },
    ],
    { resumeAuthority: authority },
  );
  const controller = new AbortController();
  const result = router.resumeWhenAnswered(session, undefined, { signal: controller.signal });
  await asked.promise;
  controller.abort();
  expect(await result).toEqual({ status: "aborted" });
  answer.resolve({ status: "answered", value: true });
  await Promise.resolve();
  await Promise.resolve();
  expect((await router.answers()).at(-1)?.status).toBe("late");
  expect(pendingDecisionsOf(await session.entries())).toHaveLength(1);
  expect(executed()).toBe(0);
  await agent.dispose();
});

test("invalid_route_values_fall_through_and_unavailable_keeps_suspension", async () => {
  const { agent, session, authority, executed } = await suspended();
  const unavailable = routeHostUi([policyDefault()], { resumeAuthority: authority });
  expect(await unavailable.resumeWhenAnswered(session)).toEqual({ status: "unavailable" });
  const router = routeHostUi(
    [
      { name: "bad", ui: ui({ status: "answered", value: "yes" }) },
      { name: "good", ui: ui({ status: "answered", value: true }) },
    ],
    { resumeAuthority: authority },
  );
  const result = await router.resumeWhenAnswered(session);
  if (result.status !== "resumed") throw new Error(result.status);
  await collect(result.events);
  expect(executed()).toBe(1);
  expect((await router.answers()).map((row) => row.status)).toEqual(["unavailable", "answered"]);
  await agent.dispose();
});

test("branch_tip_reader_matches_remote", async () => {
  const { agent, session } = await suspended();
  const entries = await session.entries();
  const tip = entries.at(-1);
  if (!tip) throw new Error("missing suspension");
  for (const branch of [
    entries,
    [...entries, { ...tip, kind: "package_state" as const }],
    [...entries, { ...tip, kind: "message" as const }],
    [{ ...tip, data: {} }],
  ]) {
    expect(pendingDecisionsOf(branch)).toEqual(remotePending(branch));
  }
  await agent.dispose();
});

test("first_answer_wins_with_serve_agent", async () => {
  for (const winner of ["router", "remote"]) {
    const { agent, session, authority: original, executed } = await suspended();
    let attempts = 0;
    const lost = deferred<void>();
    const firstEvent = deferred<void>();
    const releaseRemote = deferred<void>();
    const errors: string[] = [];
    const authority = {
      ...original,
      async *resume(...args: Parameters<typeof original.resume>) {
        const attempt = ++attempts;
        try {
          for await (const event of original.resume(...args)) {
            if (winner === "remote" && attempt === 1) {
              firstEvent.resolve();
              await releaseRemote.promise;
            }
            yield event;
          }
        } catch (error) {
          errors.push((error as { code: string }).code);
          lost.resolve();
          throw error;
        }
      },
    };
    const routeAnswer = deferred<HostUiResponse>();
    const clientAnswer = deferred<HostUiResponse>();
    const routeAsked = deferred<void>();
    const clientAsked = deferred<void>();
    const router = routeHostUi(
      [
        {
          name: "channel",
          ui: {
            request() {
              routeAsked.resolve();
              return routeAnswer.promise as never;
            },
          },
        },
      ],
      { resumeAuthority: authority },
    );
    const offered = router.resumeWhenAnswered(session);
    const [serverTransport, clientTransport] = createMemoryTransportPair();
    const served = serveAgent(agent, { transport: serverTransport, resumeAuthority: authority });
    const settled = deferred<void>();
    const client = createDispatcher({
      transport: clientTransport,
      role: "client",
      capabilities: { hostUi: true },
      requests: {
        "hostUi.request": async () => {
          clientAsked.resolve();
          return (await clientAnswer.promise) as never;
        },
      },
      notifications: { "run.settled": () => settled.resolve() },
    });
    await client.initialize();
    await client.request("sessions.open", { id: session.id });
    await Promise.all([routeAsked.promise, clientAsked.promise]);
    if (winner === "router") {
      routeAnswer.resolve({ status: "answered", value: true });
      const result = await offered;
      if (result.status !== "resumed") throw new Error(result.status);
      const iterator = result.events[Symbol.asyncIterator]();
      await iterator.next(); // Hold the authority claim while the remote reply arrives.
      clientAnswer.resolve({ status: "answered", value: true });
      await lost.promise;
      const rest = { [Symbol.asyncIterator]: () => iterator };
      await collect(rest);
    } else {
      clientAnswer.resolve({ status: "answered", value: true });
      await firstEvent.promise;
      routeAnswer.resolve({ status: "answered", value: true });
      const result = await offered;
      if (result.status !== "resumed") throw new Error(result.status);
      await expect(collect(result.events)).rejects.toMatchObject({ code: "resume_busy" });
      releaseRemote.resolve();
      await settled.promise;
    }
    expect(attempts).toBe(2);
    expect(errors).toEqual(["resume_busy"]);
    expect(executed()).toBe(1);
    expect(pendingDecisionsOf(await (await authority.session(session.id)).entries())).toEqual([]);
    await served.close();
    await agent.dispose();
  }
});

test("resume_after_restart_reads_entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "headless-resume-"));
  const fixture = join(import.meta.dirname, "fixtures/restart.mjs");
  const run = async (mode: string, id = "") => {
    const child = Bun.spawn([process.execPath, fixture, join(dir, "sessions.db"), mode, id], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    return JSON.parse(stdout);
  };
  try {
    const first = await run("suspend");
    expect(first.status).toBe("suspended");
    const second = await run("resume", first.id);
    expect(second).toMatchObject({ status: "resumed", terminal: "run.completed", executed: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("all_pending_decisions_are_offered_once_without_timeout", async () => {
  const { agent, session, authority, executed } = await suspended({ multiple: true });
  const asked = deferred<void>();
  const answer = deferred<HostUiResponse>();
  let calls = 0;
  let settled = false;
  const router = routeHostUi(
    [
      {
        name: "channel",
        timeoutMs: 1,
        kinds: ["confirm"],
        ui: {
          request() {
            calls++;
            asked.resolve();
            return (calls === 1 ? answer.promise : Promise.resolve({ status: "answered", value: true })) as never;
          },
        },
      },
    ],
    { resumeAuthority: authority },
  );
  const promise = router.resumeWhenAnswered(session).then((result) => {
    settled = true;
    return result;
  });
  await asked.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  answer.resolve({ status: "answered", value: true });
  const result = await promise;
  if (result.status !== "resumed") throw new Error(result.status);
  await collect(result.events);
  expect(calls).toBe(2);
  expect(executed()).toBe(2);
  expect(new Set((await router.answers()).map((row) => row.approvalId)).size).toBe(2);
  await agent.dispose();
});

test("complex_elicitation_uses_json_input_and_invalid_json_falls_through", async () => {
  const { agent, session, authority } = await suspended({
    elicitation: true,
    schema: { type: "object", required: ["choice", "note"], properties: { choice: { type: "string" }, note: { type: "string" } } },
  });
  let kind = "";
  const router = routeHostUi(
    [
      { name: "bad", ui: ui({ status: "answered", value: "not JSON" }) },
      {
        name: "good",
        ui: {
          async request(request) {
            kind = request.kind;
            return { status: "answered", value: '{"choice":"a","note":"hello"}' } as never;
          },
        },
      },
    ],
    { resumeAuthority: authority },
  );
  const result = await router.resumeWhenAnswered(session);
  expect(kind).toBe("input");
  if (result.status !== "resumed") throw new Error(result.status);
  await collect(result.events);
  const rows = await router.answers();
  expect(rows.map((row) => row.status)).toEqual(["unavailable", "answered"]);
  expect(JSON.stringify(rows)).not.toContain("hello");
  await agent.dispose();
});

test("stale_pending_and_unconfigured_authority_fail_closed", async () => {
  const { agent, session, authority } = await suspended();
  const router = routeHostUi([policyDefault()], { resumeAuthority: authority });
  await expect(router.resumeWhenAnswered(session, [])).rejects.toMatchObject({ code: "stale_decisions" });
  expect(await router.answers()).toEqual([]);
  await expect(routeHostUi([policyDefault()]).resumeWhenAnswered(session)).rejects.toMatchObject({ code: "resume_authority_required" });
  const wrongScope = routeHostUi([policyDefault()], { resumeAuthority: authority, ownership: { tenantId: "foreign" } });
  await expect(wrongScope.resumeWhenAnswered(session)).rejects.toMatchObject({ code: "session_not_found" });
  const controller = new AbortController();
  controller.abort();
  expect(await router.resumeWhenAnswered(session, undefined, { signal: controller.signal })).toEqual({ status: "aborted" });
  await agent.dispose();
});
