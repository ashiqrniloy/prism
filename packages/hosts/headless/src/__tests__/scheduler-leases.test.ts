import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 1000; i++) {
    if (await check()) return;
    await Bun.sleep(5);
  }
  throw new Error("worker did not settle");
}
const base = Date.parse("2026-10-13T00:00:00Z");
for (const crash of [false, true])
  test(crash ? "crash_after_claim_is_not_replayed" : "two_processes_fire_each_tick_once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scheduler-leases-"));
    const children: ReturnType<typeof spawn>[] = [];
    const spawn = (mode: string, owner: string): ReturnType<typeof Bun.spawn> => {
      const child = Bun.spawn([process.execPath, join(import.meta.dirname, "fixtures/scheduler-worker.mjs"), dir, mode, owner], {
        stdout: "pipe",
        stderr: "pipe",
      });
      children.push(child);
      return child;
    };
    const lines = () =>
      existsSync(`${dir}/firings`)
        ? readFileSync(`${dir}/firings`, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [];
    try {
      writeFileSync(`${dir}/clock`, String(base));
      expect(await spawn("prepare", "prepare").exited).toBe(0);
      if (crash) {
        const dead = spawn("crash", "dead");
        await until(() => existsSync(`${dir}/ready-dead`));
        writeFileSync(`${dir}/clock`, String(base + 60000));
        await until(() => existsSync(`${dir}/claimed`));
        dead.kill("SIGKILL");
        await dead.exited;
        const inspect = spawn("inspect", "inspect");
        const state = JSON.parse(await new Response(inspect.stdout).text())[0];
        expect(await inspect.exited).toBe(0);
        expect(state).toMatchObject({ lastFiring: { status: "running" }, nextRunAt: new Date(base + 120000).toISOString() });
      }
      spawn("run", "a");
      spawn("run", "b");
      await until(() => existsSync(`${dir}/ready-a`) && existsSync(`${dir}/ready-b`));
      for (let tick = crash ? 2 : 1; tick <= 10; tick++) {
        writeFileSync(`${dir}/clock`, String(base + tick * 60000));
        await until(() => lines().length === tick - (crash ? 1 : 0));
        await Bun.sleep(15);
      }
      writeFileSync(`${dir}/stop`, "yes");
      for (const child of children.slice(crash ? 3 : 1)) {
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stderr).text()).toBe("");
      }
      const inspect = spawn("inspect", "final");
      const state = JSON.parse(await new Response(inspect.stdout).text())[0];
      expect(await inspect.exited).toBe(0);
      expect(state.lastFiring).toMatchObject({ status: "completed", fencingToken: 1, dueAt: new Date(base + 10 * 60000).toISOString() });
      const firings = lines();
      expect(firings).toHaveLength(crash ? 9 : 10);
      expect(new Set(firings.map((f) => f.now)).size).toBe(firings.length);
      expect(firings.every((f) => ["a", "b"].includes(f.owner))).toBe(true);
    } finally {
      for (const child of children) {
        child.kill();
        await child.exited;
      }
      for (const name of readdirSync(dir).filter((entry) => entry.startsWith("error-")))
        console.error(`${name}: ${readFileSync(join(dir, name), "utf8")}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
