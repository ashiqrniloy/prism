/**
 * Live Drive import (plan 073 Task 12). Skip-not-fail without
 * PRISM_TEST_DRIVE_ACCESS_TOKEN. Revoke/change journeys stay in the hermetic
 * suite — this probe only imports one page and asserts a second pass embeds nothing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCheckpointStore } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "../../index.js";
import { createGoogleDriveConnector } from "../connectors/google-drive.js";
import { createMemoryIngestionStatusStore } from "../ingestion-status.js";
import { syncKnowledge } from "../sync.js";

const TOKEN = process.env.PRISM_TEST_DRIVE_ACCESS_TOKEN;
const FOLDER = process.env.PRISM_TEST_DRIVE_FOLDER_ID;
const DRIVE = process.env.PRISM_TEST_DRIVE_SHARED_DRIVE_ID;

describe("google drive live", () => {
  it("imports one page then no-ops embeddings on the replay", {
    skip: !TOKEN && "set PRISM_TEST_DRIVE_ACCESS_TOKEN to probe a real Drive changes.list",
  }, async () => {
    const token = TOKEN!;
    const embedder = createHashEmbedder({ dimensions: 8 });
    let embeds = 0;
    const counted = {
      id: embedder.id,
      dimensions: embedder.dimensions,
      async embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }) {
        embeds += 1;
        return embedder.embed(texts, options);
      },
    };
    const store = createMemoryVectorStore();
    const checkpoints = createMemoryCheckpointStore();
    const statusStore = createMemoryIngestionStatusStore();
    const scope = { tenantId: "live", resourceId: "drive", corpusId: "probe" };
    const connector = createGoogleDriveConnector({
      tokenProvider: () => token,
      folderId: FOLDER || undefined,
      driveId: DRIVE || undefined,
      resolveAccess: (permission) =>
        permission.type === "user" && permission.emailAddress
          ? { principalId: permission.emailAddress }
          : permission.type === "group" && permission.emailAddress
            ? { groupId: permission.emailAddress }
            : undefined,
    });
    try {
      const first = await syncKnowledge({
        connector,
        checkpoints,
        checkpoint: { namespace: "prism.rag.sync", key: "live-drive", tenantId: scope.tenantId },
        store,
        embedder: counted,
        scope,
        statusStore,
        maxPages: 1,
      });
      assert.ok(first.pages === 1);
      const afterFirst = embeds;
      await syncKnowledge({
        connector,
        checkpoints,
        checkpoint: { namespace: "prism.rag.sync", key: "live-drive", tenantId: scope.tenantId },
        store,
        embedder: counted,
        scope,
        statusStore,
        maxPages: 1,
      });
      assert.equal(embeds, afterFirst);
    } catch (error) {
      assert.ok(!String(error).includes(token), "error transcript must not contain the credential");
      throw error;
    }
  });
});
