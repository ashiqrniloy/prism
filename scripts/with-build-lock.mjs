#!/usr/bin/env node
// Build serialization (plan 023 Task 1, Option A frozen in Task 0): one O_EXCL lockfile at
// <root>/node_modules/.prism-build.lock. The root is derived from THIS file's location (not
// cwd) so root and workspace leaves contend the SAME lock — required because workspace tests
// import root dist/ via the @arnilo/prism self-symlink. Wrap emit-producing leaves (tsc) and
// dist-consuming test leaves (node --test dist/__tests__/*.test.js) ONLY; never the
// orchestrator scripts (npm test / sdk:ready) — leaf-only acquisition avoids nested deadlock.
// PRISM_BUILD_LOCK_HELD=1 is exported to the child as a non-nesting guard: if a wrapped leaf
// ever spawns another wrapped leaf, the grandchild skips acquisition (already inside the
// critical section).
import { spawnSync } from "node:child_process";
import { openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(ROOT, "node_modules", ".prism-build.lock");
const TIMEOUT_MS = Number(process.env.PRISM_BUILD_LOCK_TIMEOUT_MS ?? 120_000);
const RETRY_MS = 100;
const UNPARSEABLE_GRACE_MS = 1_000; // empty/unparseable lock: give the writer 1s, then reclaim

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("with-build-lock: usage: with-build-lock.mjs <command> [args...]");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but owned by another user — still alive
  }
}

function readHolderPid() {
  try {
    const pid = Number(String(readFileSync(LOCK, "utf8")).trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null; // vanished between check and read
  }
}

async function acquire() {
  const deadline = Date.now() + TIMEOUT_MS;
  let unparseableSince = null;
  for (;;) {
    let fd;
    try {
      fd = openSync(LOCK, "wx"); // O_EXCL: EEXIST if another holder exists
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw new Error(`cannot create build lock ${LOCK}: ${err.message}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `build lock timeout after ${TIMEOUT_MS}ms (holder pid ${readHolderPid() ?? "unknown"}); ` +
            "stale lock reclaim only when the holder PID is dead — check for a hung build or " +
            `kill it manually (rm -f ${LOCK})`,
        );
      }
      const pid = readHolderPid();
      if (pid === null) {
        // Empty/unparseable: either mid-write or abandoned. Grace, then reclaim
        // with an atomic rename to a unique tombstone — no read-then-unlink pair
        // on the shared lock path (CodeQL js/file-system-race, alert 74).
        if (unparseableSince === null) unparseableSince = Date.now();
        else if (Date.now() - unparseableSince >= UNPARSEABLE_GRACE_MS) {
          const tombstone = `${LOCK}.reclaim-${process.pid}-${Date.now()}`;
          try {
            renameSync(LOCK, tombstone); // atomic steal; loser re-acquires via EEXIST
            unlinkSync(tombstone);
          } catch {
            // vanished or concurrently reclaimed — retry acquisition
          }
          continue;
        }
        await sleep(RETRY_MS);
        continue;
      }
      if (!isAlive(pid)) {
        // Reclaim via atomic rename to a unique tombstone, then confirm the
        // stolen content still names the dead pid before deleting it. If a new
        // holder replaced the lock mid-flight, restore it (unique path per
        // attempt: no check-then-use on the shared lock path).
        const tombstone = `${LOCK}.reclaim-${process.pid}-${Date.now()}`;
        try {
          renameSync(LOCK, tombstone);
          const holder = Number(String(readFileSync(tombstone, "utf8")).trim().split(/\s+/)[0]);
          if (holder === pid) unlinkSync(tombstone);
          else renameSync(tombstone, LOCK);
        } catch {
          // vanished, restored, or concurrently reclaimed — retry acquisition
        }
        continue;
      }
      await sleep(RETRY_MS);
      continue;
    }
    try {
      writeFileSync(fd, `${process.pid} ${Date.now()}\n`);
      // Fail-closed: confirm our own pid is readable before running anything.
      if (readHolderPid() !== process.pid) {
        throw new Error("ownership not confirmed");
      }
    } catch (err) {
      unlinkSync(LOCK);
      throw new Error(`build lock write-back failed: ${err.message}`);
    }
    return;
  }
}

function release() {
  try {
    unlinkSync(LOCK);
  } catch {
    // already gone (external rm) — fine
  }
}

function runChild() {
  // NODE_TEST_* env leaks from a test-worker parent would make nested `node --test`
  // runs skip everything ("recursively within a test file"); strip it.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST_")));
  const child = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...childEnv, PRISM_BUILD_LOCK_HELD: "1" },
  });
  if (child.error) {
    console.error(`with-build-lock: failed to run "${cmd}": ${child.error.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = child.status ?? 1; // propagate child exit code (signal => non-zero)
}

if (process.env.PRISM_BUILD_LOCK_HELD) {
  // Already inside a critical section: run directly, do not re-acquire (non-nesting guard).
  runChild();
} else {
  try {
    await acquire();
  } catch (err) {
    console.error(`with-build-lock: ${err.message}`);
    process.exit(1); // fail-closed: never proceed to emit/consume without the lock
  }
  try {
    runChild();
  } finally {
    release();
  }
}
