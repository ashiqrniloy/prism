import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import { createScheduler } from "../../index.js";

const [dir, mode, owner] = process.argv.slice(2);
const readClock = () => Number(readFileSync(`${dir}/clock`, "utf8"));
// This fake clock only moves when the test writes it, so re-reading at `sleep()` entry would add a
// whole `ms` on top of a jump that landed between the scheduler's `now()` reading and its sleep, and
// the due tick would never fire. Honouring the reading the scheduler actually saw keeps `sleep(ms)`
// ending at the deadline the caller computed; the polling loop re-reads the file, so a jump past that
// deadline still returns immediately.
let lastNow = readClock();
// Child crashes are otherwise invisible: the test only sees "worker did not settle" when the
// `ready-<owner>` file never appears. The failure lands in `error-<owner>` for the test to report.
const fail = (e) => {
  appendFileSync(`${dir}/error-${owner}`, `${(e && (e.stack || e.message)) || e}\n`);
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
const persistence = createSqlitePersistence({ filename: `${dir}/store.db` });
const agent = await createAgent({
  id: "worker",
  ownership: { tenantId: "test" },
  slots: { store: persistence },
  model: { provider: "mock", model: "test" },
  packages: [mockProvider([])],
});
const checkpoints = {
  ...persistence.checkpoints,
  async saveCheckpoint(input) {
    const row = await persistence.checkpoints.saveCheckpoint(input);
    if (mode === "crash" && input.value.lastFiring?.status === "running") {
      writeFileSync(`${dir}/claimed`, "yes");
      await new Promise(() => {});
    }
    return row;
  },
};
const target = {
  ...agent,
  async session(options) {
    const session = await agent.session(options);
    if (!options?.parent) return session;
    return {
      ...session,
      id: session.id,
      close: () => session.close(),
      async run() {
        appendFileSync(`${dir}/firings`, `${JSON.stringify({ owner, now: Number(readFileSync(`${dir}/clock`, "utf8")) })}\n`);
        return { status: "completed" };
      },
    };
  },
};
const scheduler = createScheduler({
  checkpoints,
  leases: persistence.leases,
  ownership: { tenantId: "test" },
  clock: {
    now: () => (lastNow = readClock()),
    async sleep(ms, signal) {
      const until = lastNow + ms;
      while (!signal.aborted && readClock() < until) await Bun.sleep(2);
    },
  },
  targets: { job: { kind: "agent", agent: target, input: "run" } },
});
if (mode === "inspect") console.log(JSON.stringify(await scheduler.list()));
else if (mode === "prepare") await scheduler.schedule({ id: "ticks", target: "job", cron: "* * * * *" });
else {
  scheduler.start();
  writeFileSync(`${dir}/ready-${owner}`, "yes");
  while (!existsSync(`${dir}/stop`)) await Bun.sleep(2);
}
await scheduler.stop();
await agent.dispose();
persistence.close();
