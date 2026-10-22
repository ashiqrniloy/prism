import { expect, test } from "bun:test";
import { createMemoryCheckpointStore, type CheckpointStore } from "@arnilo/prism-workflows";
import { policyDefault, routeHostUi } from "../index.js";

test("answer_log_has_no_values_and_survives_restart", async () => {
  const store = createMemoryCheckpointStore({ maxPageSize: 1 });
  const router = routeHostUi(
    [
      {
        name: "private",
        kinds: ["input", "secret"],
        ui: {
          async request() {
            return { status: "answered", value: "private-answer" } as never;
          },
        },
      },
    ],
    { answerLog: store, ownership: { tenantId: "ours" } },
  );
  await router.request({ kind: "input", title: "private-title", value: "private-prefill", sessionId: "s" });
  await router.request({ kind: "secret", title: "Key", ref: "env:KEY", sessionId: "s" });
  const restarted = routeHostUi([policyDefault()], { answerLog: store, ownership: { tenantId: "ours" } });
  expect(await restarted.answers()).toHaveLength(2);
  expect(await restarted.answers({ sessionId: "s", limit: 1 })).toHaveLength(1);
  expect(await restarted.answers({ sessionId: "other" })).toHaveLength(0);
  const serialized = JSON.stringify([await router.answers(), await store.listCheckpoints({ namespace: "headless.answers" })]);
  for (const text of ["private-answer", "private-title", "private-prefill", "env:KEY"]) expect(serialized).not.toContain(text);
  const foreign = routeHostUi([policyDefault()], { answerLog: store, ownership: { tenantId: "theirs" } });
  expect(await foreign.answers()).toEqual([]);
  const unscoped = routeHostUi([policyDefault()], { answerLog: store });
  expect(await unscoped.answers()).toEqual([]);
});

test("answer_log_is_bounded_and_returns_copies", async () => {
  const router = routeHostUi([policyDefault()], { limits: { maxAnswers: 2 } });
  for (const sessionId of ["a", "b", "c"]) await router.request({ kind: "confirm", title: "?", sessionId });
  expect((await router.answers()).map((row) => row.sessionId)).toEqual(["b", "c"]);
  Object.assign((await router.answers())[0]!, { route: "mutated" });
  expect((await router.answers())[0]!.route).toBe("policy");
});

test("answer_log_write_failure_is_surfaced", async () => {
  const store: CheckpointStore = {
    ...createMemoryCheckpointStore(),
    async saveCheckpoint() {
      throw new Error("disk failed");
    },
  };
  const router = routeHostUi([policyDefault()], { answerLog: store });
  await expect(router.request({ kind: "confirm", title: "?" })).rejects.toThrow("disk failed");
});
