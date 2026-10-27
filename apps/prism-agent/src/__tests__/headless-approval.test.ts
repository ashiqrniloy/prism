import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { HostConfig } from "../host/index.js";
import { headlessApprovalSuspendsThenChannelResumes, type HeadlessApprovalResult } from "../scenarios/headless-approval.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

let root: string;
let result: HeadlessApprovalResult;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "pa-ha-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  spawnSync("git", ["init"], { cwd: workspace });
  const config: HostConfig = {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace,
    approval: "ask",
    web: { backend: "obscura" },
  };
  result = await headlessApprovalSuspendsThenChannelResumes(config);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("headless_approval_suspends_then_channel_resumes_in_fresh_process", () => {
  assert.equal(result.firstExit, 3);
  assert.equal(result.resumed, "resumed");
  assert.equal(result.completed, true);
});

test("answer_log_records_channel_route_without_value", () => {
  // The one-shot run offered the client, then the channel, then the policy default; none approved.
  // The host process then offered the client again before the channel answered.
  assert.deepEqual([...new Set(result.runRoutes)], ["client", "channel", "policy"]);
  assert.equal(result.channelAnswered, 1);
  assert.equal(result.valuesLogged, 0);
  const answered = result.answers.find((row) => row.route === "channel" && row.status === "answered");
  assert.ok(answered?.approvalId, "the channel answer carries the approval id");
});

test("secret_request_never_reaches_channel", () => {
  assert.equal(result.secretAnswer, "unavailable");
  assert.equal(result.secretReachedChannel, 0);
});

test("unpaired_channel_reply_refused", () => {
  assert.deepEqual(result.unpairedRefusal, { status: "denied", reason: "rejected" });
});
