import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGoogleDriveConnector } from "../connectors/google-drive.js";
import { RagSyncCursorError, RagSyncThrottleError } from "../errors.js";

const token = "ya29.not-a-secret-for-tests";

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("google drive connector", () => {
  it("bootstraps files then changes, maps ACL, and uses shared-drive params", async () => {
    const seen: string[] = [];
    const connector = createGoogleDriveConnector({
      tokenProvider: () => token,
      driveId: "sdrive",
      folderId: "folder1",
      allowLoopback: true,
      resolveAccess: (permission) =>
        permission.type === "user" && permission.emailAddress
          ? { principalId: permission.emailAddress }
          : permission.type === "group" && permission.emailAddress
            ? { groupId: permission.emailAddress }
            : undefined,
      fetch: async (input) => {
        const url = new URL(String(input));
        seen.push(`${url.pathname}?${url.searchParams.toString()}`);
        if (url.pathname.endsWith("/changes/startPageToken")) return json({ startPageToken: "1" });
        if (url.pathname.endsWith("/files") && !url.searchParams.has("alt")) {
          assert.equal(url.searchParams.get("driveId"), "sdrive");
          assert.equal(url.searchParams.get("q"), "'folder1' in parents and trashed = false");
          return json({
            files: [
              {
                id: "fileA",
                mimeType: "text/plain",
                md5Checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                permissions: [
                  { type: "user", emailAddress: "alice@example.com" },
                  { type: "group", emailAddress: "eng@example.com" },
                ],
              },
              {
                id: "public",
                mimeType: "text/plain",
                permissions: [{ type: "anyone" }],
              },
            ],
          });
        }
        if (url.searchParams.get("alt") === "media") return new Response("alpha policy text", { status: 200 });
        if (url.pathname.endsWith("/changes")) {
          return json({
            changes: [{ fileId: "fileA", removed: true }],
            newStartPageToken: "2",
          });
        }
        return json({}, 404);
      },
    });
    const first = await connector.listChanges({ limit: 10 });
    assert.equal(first.done, false);
    assert.equal(first.changes[0]?.kind, "upsert");
    if (first.changes[0]?.kind === "upsert") {
      assert.equal(first.changes[0].sourceId, "drive:fileA");
      assert.deepEqual(first.changes[0].grants?.principalIds, ["alice@example.com"]);
      assert.deepEqual(first.changes[0].grants?.groupIds, ["eng@example.com"]);
    }
    assert.equal(first.changes[1]?.kind, "withhold");
    const second = await connector.listChanges({ cursor: first.resumeCursor, limit: 10 });
    assert.equal(second.done, true);
    assert.deepEqual(second.changes, [{ kind: "delete", sourceId: "drive:fileA" }]);
    assert.ok(seen.some((entry) => entry.includes("driveId=sdrive")));
  });

  it("withholds 403, deletes 404, retries 429, and treats a bad page token as invalid", async () => {
    const connector = createGoogleDriveConnector({
      tokenProvider: () => token,
      allowLoopback: true,
      resolveAccess: (permission) =>
        permission.type === "user" && permission.emailAddress ? { principalId: permission.emailAddress } : undefined,
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/changes/startPageToken")) return json({ startPageToken: "1" });
        if (url.pathname.endsWith("/files") && !url.searchParams.has("alt")) {
          return json({
            files: [{ id: "denied", mimeType: "text/plain", permissions: [{ type: "user", emailAddress: "alice@example.com" }] }],
          });
        }
        if (url.searchParams.get("alt") === "media") return new Response("", { status: 403 });
        return json({}, 404);
      },
    });
    const page = await connector.listChanges({ limit: 5 });
    assert.equal(page.changes[0]?.kind, "withhold");

    const throttled = createGoogleDriveConnector({
      tokenProvider: () => token,
      allowLoopback: true,
      resolveAccess: () => ({ principalId: "alice" }),
      fetch: async () => new Response("rateLimitExceeded", { status: 429, headers: { "retry-after": "2" } }),
    });
    await assert.rejects(() => throttled.listChanges({ limit: 1 }), RagSyncThrottleError);

    const invalid = createGoogleDriveConnector({
      tokenProvider: () => token,
      allowLoopback: true,
      resolveAccess: () => ({ principalId: "alice" }),
      fetch: async () => json({ error: { message: "invalid" } }, 410),
    });
    await assert.rejects(
      () => invalid.listChanges({ cursor: JSON.stringify({ v: 1, phase: "changes", pageToken: "x", startPageToken: "x" }), limit: 1 }),
      RagSyncCursorError,
    );
  });
});
