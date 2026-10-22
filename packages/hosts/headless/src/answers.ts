import type { HostUiRequestKind, OwnershipScope } from "@arnilo/prism";
import type { CheckpointStore } from "@arnilo/prism-workflows";
import { answerLimit } from "./limits.js";

export interface RoutedAnswer {
  readonly route: string;
  readonly kind: HostUiRequestKind;
  readonly status: "answered" | "dismissed" | "unavailable" | "late" | "error";
  readonly sessionId?: string;
  readonly approvalId?: string;
  readonly at: string;
}

export interface AnswerQuery {
  readonly sessionId?: string;
  readonly limit?: number;
}

export function createAnswerLog(maxAnswers: number, store?: CheckpointStore, ownership: OwnershipScope = {}) {
  const scope = { tenantId: ownership.tenantId, accountId: ownership.accountId, userId: ownership.userId };
  const memory: RoutedAnswer[] = [];
  let sequence = 0;
  let lateWrite: Promise<void> = Promise.resolve();
  let lateFailure: unknown;
  const record = async (answer: RoutedAnswer): Promise<void> => {
    // The offer order is the contract; `at` alone ties within a millisecond, so store a sequence too.
    const ordered = { ...answer, seq: (sequence += 1) };
    if (store)
      await store.saveCheckpoint({
        ...scope,
        namespace: "headless.answers",
        key: crypto.randomUUID(),
        version: 1,
        expectedVersion: 0,
        value: ordered,
      });
    memory.push(Object.freeze({ ...answer }));
    if (memory.length > maxAnswers) memory.splice(0, memory.length - maxAnswers);
  };
  return {
    record,
    recordLate(answer: RoutedAnswer): void {
      lateWrite = lateWrite
        .then(() => record(answer))
        .catch((error) => {
          lateFailure = error;
        });
    },
    async answers(query: AnswerQuery = {}): Promise<readonly RoutedAnswer[]> {
      await lateWrite;
      if (lateFailure !== undefined) throw lateFailure;
      const limit = query.limit === undefined ? maxAnswers : Math.min(answerLimit(query.limit), maxAnswers);
      let rows: (RoutedAnswer & { seq: number })[] = memory.map((row, index) => ({ ...row, seq: index }));
      if (store) {
        rows = [];
        let cursor: string | undefined;
        do {
          const page = await store.listCheckpoints({
            ...scope,
            namespace: "headless.answers",
            limit: maxAnswers,
            ...(cursor === undefined ? {} : { cursor }),
          });
          for (const row of page.items) {
            // An omitted ownership field is a wildcard in listCheckpoints, so check exact scope here.
            if (row.tenantId !== scope.tenantId || row.accountId !== scope.accountId || row.userId !== scope.userId) continue;
            const value = row.value as RoutedAnswer & { seq?: number };
            rows.push({
              route: value.route,
              kind: value.kind,
              status: value.status,
              at: value.at,
              seq: value.seq ?? 0,
              ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
              ...(value.approvalId === undefined ? {} : { approvalId: value.approvalId }),
            });
          }
          rows = rows.filter((row) => query.sessionId === undefined || row.sessionId === query.sessionId);
          rows.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
          if (rows.length > limit) rows.splice(0, rows.length - limit);
          cursor = page.nextCursor;
        } while (cursor !== undefined);
        rows.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
      }
      return rows
        .filter((row) => query.sessionId === undefined || row.sessionId === query.sessionId)
        .slice(-limit)
        .map(({ seq: _seq, ...row }) => ({ ...row }));
    },
  };
}
