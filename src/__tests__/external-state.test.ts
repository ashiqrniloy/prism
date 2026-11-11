import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  type JsonValue,
  type LoopStrategy,
  type RunController,
} from "../index.js";
import { MAX_EXTERNAL_STATE_ENTRIES } from "../session/external-state.js";
import { loopConformance } from "../testing/index.js";

function driverLoop(body: (run: RunController) => Promise<void>): LoopStrategy {
  return { name: "driver", revision: "1", usesModel: false as const, run: body };
}

async function withState(body: (run: RunController) => Promise<void>, extra: { store?: ReturnType<typeof createMemorySessionStore> } = {}) {
  const store = extra.store ?? createMemorySessionStore();
  const out = await loopConformance({ probe: false, store, loop: driverLoop(body) });
  return { ...out, store };
}

describe("external state", () => {
  it("external_state_round_trip", async () => {
    let loaded: readonly JsonValue[] = [];
    const { store, session } = await withState(async (run) => {
      const log = run.state("transcript");
      await log.append([{ line: 1 }, "two"]);
      await log.append([3]);
      loaded = await log.load();
      assert.deepEqual(await run.state("other").load(), []);
    });
    assert.deepEqual(loaded, [{ line: 1 }, "two", 3]);
    const rows = (await store.list(session.id)).filter((entry) => entry.kind === "external_state");
    assert.deepEqual(
      rows.map((row) => (row.data as { seq: number; vendor: string }).seq),
      [1, 2],
    );
    assert.equal((rows[0]!.data as { vendor: string }).vendor, "driver");
  });

  it("external_state_excluded_from_messages", async () => {
    const { session } = await withState(async (run) => {
      await run.state("transcript").append(["hello"]);
    });
    assert.equal(JSON.stringify(await session.messages()).includes("hello"), false);
  });

  it("external_state_copied_on_fork_and_deleted_with_session", async () => {
    const { store, session } = await withState(async (run) => {
      await run.state("transcript").append(["kept"]);
    });
    const fork = await session.fork();
    const copied = (await store.list(fork.id)).filter((entry) => entry.kind === "external_state");
    assert.equal(copied.length, 1);
    assert.deepEqual((copied[0]!.data as { data: unknown }).data, ["kept"]);
    await store.deleteSession?.(session.id);
    assert.equal((await store.list(session.id)).length, 0);
    assert.equal((await store.list(fork.id)).filter((entry) => entry.kind === "external_state").length, 1);
  });

  it("external_state_limit_rejects", async () => {
    const codes: string[] = [];
    const { store, session } = await withState(async (run) => {
      const log = run.state("transcript");
      await log.append(new Array(MAX_EXTERNAL_STATE_ENTRIES).fill(0));
      for (const batch of [[1], ["x".repeat(70 * 1024)]]) {
        await log.append(batch).catch((error: { code?: string }) => codes.push(error.code ?? "?"));
      }
      await run.state("big").append(["x".repeat(60 * 1024)]);
    });
    assert.deepEqual(codes, ["external_state_limit", "external_state_limit"]);
    assert.equal((await store.list(session.id)).filter((entry) => entry.kind === "external_state").length, 2);
  });

  it("external_state_redacted", async () => {
    const secret = "sk-live-0123456789abcdef";
    const store = createMemorySessionStore();
    const agent = await createAgent({
      redactor: createSecretRedactor([secret]),
      slots: {
        store,
        loop: driverLoop(async (run) => {
          await run.state("transcript").append([{ token: secret }]);
        }),
      },
    });
    const session = await agent.session({ id: "s", create: true });
    await session.run("go");
    const rows = (await store.list("s")).filter((entry) => entry.kind === "external_state");
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(rows).includes(secret), false);
  });

  it("external_state_rejects_non_json", async () => {
    let code = "";
    await withState(async (run) => {
      await run
        .state("transcript")
        .append([() => 1] as unknown as JsonValue[])
        .catch((error: { code?: string }) => {
          code = error.code ?? "?";
        });
    });
    assert.equal(code, "state_not_json");
  });
});
