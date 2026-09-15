import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentIdentity,
  type ArtifactBodyRef,
  type ArtifactBodyStore,
  createMemoryCheckpointStore,
  type ToolExecutionContext,
} from "@arnilo/prism";
import {
  canonicalJson,
  computePayloadDigest,
  createCheckpointWorkDraftStore,
  createGoogleWorkspaceCliAdapter,
  createMemoryIdempotencyStore,
  createMemoryWorkDraftStore,
  createMicrosoft365CliAdapter,
  createWorkTools,
  extractDraftRecipients,
  validateApproval,
  type WorkCliExecResult,
  type WorkDraft,
  type WorkDraftApproval,
} from "../index.js";

const identity: AgentIdentity = {
  tenantId: "tenant-corp",
  userId: "worker-1",
  principal: { kind: "user", id: "worker-1" },
  scopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

const otherIdentity: AgentIdentity = {
  tenantId: "tenant-other",
  userId: "worker-2",
  principal: { kind: "user", id: "worker-2" },
  scopes: ["Mail.Read", "Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

function ctx(idempotencyKey = "prism:work:test-key:1"): ToolExecutionContext {
  return { sessionId: "sess-1", runId: "run-1", toolCallId: "tc-1", idempotencyKey };
}

function fakeRunner(handler: (argv: readonly string[]) => WorkCliExecResult | Promise<WorkCliExecResult>) {
  return {
    async exec(argv: readonly string[]) {
      return handler(argv);
    },
  };
}

function createMemoryArtifactBodyStore(): ArtifactBodyStore {
  const map = new Map<string, Buffer>();
  return {
    async put(ref: ArtifactBodyRef, body: Uint8Array) {
      map.set(`${ref.artifactId}:${ref.version}`, Buffer.from(body));
    },
    async get(ref: ArtifactBodyRef) {
      const b = map.get(`${ref.artifactId}:${ref.version}`);
      if (!b) throw new Error("Body not found");
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(b);
          controller.close();
        },
      });
    },
    async delete(ref: ArtifactBodyRef) {
      map.delete(`${ref.artifactId}:${ref.version}`);
    },
    async presign(ref: ArtifactBodyRef) {
      return `https://example.test/bodies/${ref.artifactId}/${ref.version}`;
    },
  };
}

describe("draft utilities and canonical hashing", () => {
  it("computes deterministic payload digests invariant to key ordering", () => {
    const payload1 = { to: "a@contoso.com", subject: "Hello", body: "World" };
    const payload2 = { subject: "Hello", body: "World", to: "a@contoso.com" };
    assert.equal(computePayloadDigest(payload1), computePayloadDigest(payload2));
    assert.match(computePayloadDigest(payload1), /^sha256:[a-f0-9]{64}$/);
  });

  it("extracts recipients across mail and calendar payload fields", () => {
    const recipients = extractDraftRecipients({
      to: "a@contoso.com, b@contoso.com",
      cc: "c@contoso.com",
      bcc: "d@contoso.com",
      recipients: ["e@contoso.com"],
    });
    assert.deepEqual(recipients, ["a@contoso.com", "b@contoso.com", "c@contoso.com", "d@contoso.com", "e@contoso.com"]);
  });

  it("canonicalJson rejects non-serializable values", () => {
    assert.throws(() => canonicalJson({ fn: () => {} }), /Draft payload must be JSON serializable/);
  });
});

describe("createMemoryWorkDraftStore", () => {
  it("creates, updates, and approves drafts with revision increment and approval invalidation", () => {
    const store = createMemoryWorkDraftStore();
    const draft = store.createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "a@contoso.com", subject: "Review", bodyContents: "Please review" },
    });
    assert.equal(draft.revision, 1);
    assert.equal(draft.status, "pending_approval");
    assert.ok(draft.payloadDigest);

    const approval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: draft.revision,
      payloadDigest: draft.payloadDigest,
      identityKey: draft.identityKey,
      approvedAt: new Date().toISOString(),
    };
    const approved = store.approveDraft({ draftId: draft.draftId, identity, approval });
    assert.equal(approved.status, "approved");
    assert.deepEqual(approved.approval?.payloadDigest, draft.payloadDigest);

    // Editing draft increments revision and invalidates approval
    const updated = store.updateDraft({
      draftId: draft.draftId,
      identity,
      payload: { to: "a@contoso.com", subject: "Updated Review", bodyContents: "Please review v2" },
      expectedRevision: 1,
    });
    assert.equal(updated.revision, 2);
    assert.equal(updated.status, "pending_approval");
    assert.equal(updated.approval, undefined);
    assert.notEqual(updated.payloadDigest, draft.payloadDigest);
  });

  it("enforces identity isolation between tenants", () => {
    const store = createMemoryWorkDraftStore();
    const draft = store.createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "a@contoso.com", subject: "Secret", bodyContents: "Internal" },
    });
    // Another identity cannot read or update
    const read = store.getDraft({ draftId: draft.draftId, identity: otherIdentity });
    assert.equal(read, undefined);

    assert.throws(
      () =>
        store.updateDraft({
          draftId: draft.draftId,
          identity: otherIdentity,
          payload: { to: "attacker@evil.com" },
        }),
      /Draft identity mismatch/,
    );
  });
});

describe("createCheckpointWorkDraftStore", () => {
  it("persists exact business-action drafts across store restarts", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const bodies = createMemoryArtifactBodyStore();

    const store1 = createCheckpointWorkDraftStore({ checkpoints, bodies });
    const draft1 = await store1.createDraft({
      draftId: "draft-durable-1",
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "boss@contoso.com", subject: "Q3 Numbers", bodyContents: "Revenue is up 12%" },
    });
    assert.equal(draft1.draftId, "draft-durable-1");
    assert.equal(draft1.revision, 1);
    assert.ok(draft1.bodyRef);

    // Simulate process restart: instantiate a new store pointing to same checkpoints
    const store2 = createCheckpointWorkDraftStore({ checkpoints, bodies });
    const loaded = await store2.getDraft({ draftId: "draft-durable-1", identity });
    assert.ok(loaded);
    assert.equal(loaded.draftId, "draft-durable-1");
    assert.equal(loaded.revision, 1);
    assert.equal(loaded.payloadDigest, draft1.payloadDigest);
    assert.deepEqual(loaded.payload, draft1.payload);

    // Body was persisted in bodies store
    const stream = await bodies.get(loaded.bodyRef!);
    const reader = stream.getReader();
    const { value: chunk } = await reader.read();
    assert.equal(Buffer.from(chunk!).toString("utf8"), "Revenue is up 12%");
  });

  it("handles two-worker race with CAS conflict", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createCheckpointWorkDraftStore({ checkpoints });
    const draft = await store.createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "team@contoso.com", subject: "Meeting" },
    });

    // Worker 1 updates draft to revision 2
    await store.updateDraft({
      draftId: draft.draftId,
      identity,
      payload: { to: "team@contoso.com", subject: "Meeting at 2pm" },
      expectedRevision: 1,
    });

    // Worker 2 attempts update with stale revision 1
    await assert.rejects(
      async () =>
        store.updateDraft({
          draftId: draft.draftId,
          identity,
          payload: { to: "team@contoso.com", subject: "Meeting at 3pm" },
          expectedRevision: 1,
        }),
      /Draft revision conflict/,
    );
  });
});

describe("end-to-end draft lifecycle with tools and adapters", () => {
  it("Requirement 1: draft / restart / approve / resume exact revision", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const bodies = createMemoryArtifactBodyStore();
    const idempotencyStore = createMemoryIdempotencyStore();
    let runnerExecCalls = 0;
    let runnerSentSubject = "";

    const runner = fakeRunner(async (argv) => {
      if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
      runnerExecCalls += 1;
      const subjIdx = argv.indexOf("--subject");
      if (subjIdx !== -1) runnerSentSubject = argv[subjIdx + 1];
      return { exitCode: 0, stdout: JSON.stringify({ id: "outlook_msg_999" }), stderr: "" };
    });

    // Process 1: Adapter 1 creates a draft
    const adapter1 = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      configDir: "/tmp/prism-m365-test",
      identity,
      checkpoints,
      bodies,
      runner,
    });
    const draft1 = (await adapter1.createDraft("mail.send", {
      to: "exec@contoso.com",
      subject: "Important Proposal",
      bodyContents: "Detailed plan for next quarter",
    })) as WorkDraft;
    assert.equal(draft1.revision, 1);
    assert.equal(draft1.status, "pending_approval");

    // Process 2: Restart! Adapter 2 connects to the same durable checkpoint store
    const adapter2 = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      configDir: "/tmp/prism-m365-test",
      identity,
      checkpoints,
      bodies,
      runner,
    });
    const resumedDraft = (await adapter2.getDraft(draft1.draftId)) as WorkDraft;
    assert.ok(resumedDraft);
    assert.equal(resumedDraft.revision, 1);
    assert.equal(resumedDraft.payloadDigest, draft1.payloadDigest);

    // Host approves exact revision 1
    const approval: WorkDraftApproval = {
      draftId: resumedDraft.draftId,
      revision: 1,
      payloadDigest: resumedDraft.payloadDigest,
      identityKey: resumedDraft.identityKey,
      approvedAt: new Date().toISOString(),
    };
    await adapter2.approveDraft!(approval);

    // Worker resumes approved draft via tool send without re-specifying payload
    const send = createWorkTools({
      microsoft365: adapter2,
      idempotencyStore,
      approval: { isApproved: () => approval },
      externalRecipients: { allow: () => true },
    }).find((t) => t.name === "m365_mail_draft_send")!;

    const result = await send.execute(
      {
        draftId: resumedDraft.draftId,
        revision: 1,
      },
      ctx("idempotency-resume-1"),
    );
    const value = result.value as { draftId: string; revision: number; resourceId: string; status: string };

    assert.equal(value.status, "executed");
    assert.equal(value.draftId, draft1.draftId);
    assert.equal(value.revision, 1);
    assert.equal(value.resourceId, "outlook_msg_999");
    assert.equal(runnerExecCalls, 1);
    assert.equal(runnerSentSubject, "Important Proposal");

    // Check draft status is now executed
    const executedDraft = (await adapter2.getDraft(draft1.draftId)) as WorkDraft;
    assert.equal(executedDraft?.status, "executed");
  });

  it("Requirement 2: edits invalidate approval and increment revision", async () => {
    const store = createMemoryWorkDraftStore();
    const idempotencyStore = createMemoryIdempotencyStore();
    let runnerCalls = 0;
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      configDir: "/tmp/prism-m365-test",
      identity,
      draftStore: store,
      runner: fakeRunner(async (argv) => {
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        runnerCalls += 1;
        return { exitCode: 0, stdout: JSON.stringify({ id: "msg_edited" }), stderr: "" };
      }),
    });

    const draft = adapter.createDraft("mail.send", {
      to: "colleague@contoso.com",
      subject: "Original Subject",
      bodyContents: "Draft body",
    }) as WorkDraft;

    const approval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: 1,
      payloadDigest: draft.payloadDigest,
      identityKey: draft.identityKey,
      approvedAt: new Date().toISOString(),
    };
    adapter.approveDraft!(approval);

    // Edit the draft
    const updated = adapter.updateDraft!(
      draft.draftId,
      { to: "colleague@contoso.com", subject: "Changed Subject", bodyContents: "Draft body" },
      { expectedRevision: 1 },
    ) as WorkDraft;

    assert.equal(updated.revision, 2);
    assert.equal(updated.status, "pending_approval");
    assert.equal(updated.approval, undefined);

    // Trying to resume with prior approval gate (which only approved rev 1)
    const send = createWorkTools({
      microsoft365: adapter,
      idempotencyStore,
      approval: { isApproved: (input) => "revision" in input && input.revision === 1 },
      externalRecipients: { allow: () => true },
    }).find((t) => t.name === "m365_mail_draft_send")!;

    const res = await send.execute({ draftId: draft.draftId, revision: 2 }, ctx());
    const val = res.value as { status: string; draftId: string; revision: number };
    // Prior approval is invalidated, returns pending_approval without executing
    assert.equal(val.status, "pending_approval");
    assert.equal(val.revision, 2);
    assert.equal(runnerCalls, 0);
  });

  it("Requirement 3: recipient change invalidates approval and checks external recipient policy", async () => {
    const store = createMemoryWorkDraftStore();
    const idempotencyStore = createMemoryIdempotencyStore();
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      configDir: "/tmp/prism-m365-test",
      identity,
      draftStore: store,
      runner: fakeRunner(async () => ({ exitCode: 0, stdout: "{}", stderr: "" })),
    });

    const draft = adapter.createDraft("mail.send", {
      to: "colleague@contoso.com",
      subject: "Internal Note",
      bodyContents: "Notice",
    }) as WorkDraft;

    const send = createWorkTools({
      microsoft365: adapter,
      idempotencyStore,
      externalRecipients: {
        allow: (addr) => !addr.includes("external.test"),
      },
    }).find((t) => t.name === "m365_mail_draft_send")!;

    await assert.rejects(
      async () =>
        send.execute(
          {
            draftId: draft.draftId,
            to: "evil@external.test",
          },
          ctx(),
        ),
      /External recipient denied/,
    );
  });

  it("Requirement 4: duplicate approve is idempotent, but revision mismatch rejects", () => {
    const store = createMemoryWorkDraftStore();
    const draft = store.createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "lead@contoso.com", subject: "Report" },
    });

    const approval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: 1,
      payloadDigest: draft.payloadDigest,
      identityKey: draft.identityKey,
      approvedAt: new Date().toISOString(),
    };

    const first = store.approveDraft({ draftId: draft.draftId, identity, approval });
    assert.equal(first.status, "approved");

    // Calling approveDraft again with the exact same approval is idempotent
    const second = store.approveDraft({ draftId: draft.draftId, identity, approval });
    assert.equal(second.status, "approved");

    // Stale revision rejection
    assert.throws(
      () =>
        store.approveDraft({
          draftId: draft.draftId,
          identity,
          approval: { ...approval, revision: 99 },
        }),
      /Approval revision 99 does not match draft revision 1/,
    );

    // Mismatched payload digest rejection
    assert.throws(
      () =>
        store.approveDraft({
          draftId: draft.draftId,
          identity,
          approval: { ...approval, payloadDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
        }),
      /does not match draft digest/,
    );
  });

  it("Requirement 5: two-worker race rejects conflicting update", () => {
    const store = createMemoryWorkDraftStore();
    const draft = store.createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "a@contoso.com", subject: "Sync" },
    });

    // Worker 1 updates with expectedRevision: 1
    store.updateDraft({
      draftId: draft.draftId,
      identity,
      payload: { to: "a@contoso.com", subject: "Sync v2" },
      expectedRevision: 1,
    });

    // Worker 2 attempts update with expectedRevision: 1 (stale)
    assert.throws(
      () =>
        store.updateDraft({
          draftId: draft.draftId,
          identity,
          payload: { to: "a@contoso.com", subject: "Sync v3" },
          expectedRevision: 1,
        }),
      /Draft revision conflict/,
    );
  });

  it("Requirement 6: body hash mismatch rejection in approval validation", () => {
    const draft = createMemoryWorkDraftStore().createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "user@contoso.com", subject: "Hello", bodyContents: "Authentic Body" },
    });

    const forgedApproval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: draft.revision,
      payloadDigest: "sha256:baadf00dbaadf00dbaadf00dbaadf00dbaadf00dbaadf00dbaadf00dbaadf00d",
      approvedAt: new Date().toISOString(),
    };

    assert.throws(() => validateApproval(draft, forgedApproval), /Approval payloadDigest .* does not match draft digest/);
  });

  it("Requirement 7: policy/consent revocation fails closed", () => {
    const draft = createMemoryWorkDraftStore().createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity,
      payload: { to: "user@contoso.com", subject: "Subject" },
      policyRevision: "policy-v2",
    });

    // Expired approval
    const expiredApproval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: 1,
      payloadDigest: draft.payloadDigest,
      approvedAt: new Date(Date.now() - 3600_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      policyRevision: "policy-v2",
    };
    assert.throws(() => validateApproval(draft, expiredApproval), /Approval has expired/);

    // Stale/revoked policy revision
    const stalePolicyApproval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: 1,
      payloadDigest: draft.payloadDigest,
      approvedAt: new Date().toISOString(),
      policyRevision: "policy-v1",
    };
    assert.throws(
      () => validateApproval(draft, stalePolicyApproval, { policyRevision: "policy-v2" }),
      /Policy revision changed \(expected policy-v2, got policy-v1\)/,
    );
  });

  it("Requirement 8 & 9: ambiguous connector failure becomes unknown and refuses repetition without reconciliation", async () => {
    const store = createMemoryIdempotencyStore();
    const draftStore = createMemoryWorkDraftStore();
    let runnerAttempts = 0;

    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      configDir: "/tmp/prism-m365-test",
      identity,
      draftStore,
      runner: fakeRunner(async (argv) => {
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        runnerAttempts += 1;
        throw new Error("ETIMEDOUT: Connection reset by peer");
      }),
    });

    const send = createWorkTools({
      microsoft365: adapter,
      idempotencyStore: store,
      approval: { isApproved: () => true },
      externalRecipients: { allow: () => true },
    }).find((t) => t.name === "m365_mail_draft_send")!;

    const args = { to: "user@contoso.com", subject: "Hi", bodyContents: "Text" };

    // Initial execution fails ambiguously
    let caughtError: unknown;
    try {
      await send.execute(args, ctx("mutation-ambiguous-1"));
    } catch (err) {
      caughtError = err;
    }
    assert.ok(caughtError);
    assert.equal(runnerAttempts, 1);

    // Record in idempotency store is unknown
    const record = await store.get({ identity, key: "mutation-ambiguous-1", op: "mail.send" });
    assert.equal(record?.status, "unknown");

    // Subsequent call with same idempotency key fails closed without repeating mutation
    await assert.rejects(async () => send.execute(args, ctx("mutation-ambiguous-1")), /mutation outcome requires reconciliation/);
    assert.equal(runnerAttempts, 1); // runner was NOT called again
  });

  it("Requirement 10: Google Workspace draft-then-approve parity for mail and calendar", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const idempotencyStore = createMemoryIdempotencyStore();
    let executedCalendarOps = 0;

    const runner = fakeRunner(async (argv) => {
      if (argv[0] === "version") return { exitCode: 0, stdout: '"v0.1.0"', stderr: "" };
      if (argv[0] === "calendar" && argv[1] === "events" && argv[2] === "insert") {
        executedCalendarOps += 1;
        return { exitCode: 0, stdout: JSON.stringify({ id: "gws_event_42" }), stderr: "" };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    });

    const gws = createGoogleWorkspaceCliAdapter({
      binary: "/usr/bin/gws",
      configDir: "/tmp/prism-gws-test",
      identity,
      checkpoints,
      runner,
    });

    // 1. Create calendar draft
    const draft = (await gws.createDraft("calendar.add", {
      summary: "Quarterly Review",
      start: "2026-10-01T10:00:00Z",
      end: "2026-10-01T11:00:00Z",
    })) as WorkDraft;
    assert.equal(draft.provider, "google-workspace");
    assert.equal(draft.revision, 1);
    assert.equal(draft.status, "pending_approval");

    // 2. Approve draft
    const approval: WorkDraftApproval = {
      draftId: draft.draftId,
      revision: 1,
      payloadDigest: draft.payloadDigest,
      identityKey: draft.identityKey,
      approvedAt: new Date().toISOString(),
    };
    await gws.approveDraft!(approval);

    // 3. Resume approved draft via tool
    const calendarAdd = createWorkTools({
      googleWorkspace: gws,
      idempotencyStore,
      approval: { isApproved: () => approval },
    }).find((t) => t.name === "gws_calendar_draft_add")!;

    const result = await calendarAdd.execute(
      {
        draftId: draft.draftId,
        revision: 1,
      },
      ctx("gws-cal-1"),
    );
    const value = result.value as { status: string; draftId: string; revision: number; resourceId: string };

    assert.equal(value.status, "executed");
    assert.equal(value.draftId, draft.draftId);
    assert.equal(value.revision, 1);
    assert.equal(value.resourceId, "gws_event_42");
    assert.equal(executedCalendarOps, 1);

    const executedDraft = (await gws.getDraft(draft.draftId)) as WorkDraft;
    assert.equal(executedDraft?.status, "executed");
  });
});
