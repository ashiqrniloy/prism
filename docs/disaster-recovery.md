# Disaster recovery and backup operations

## What it does

This page is the operator runbook for backup, restore, migration rollback, point-in-time recovery (PITR), and disaster recovery (DR), proven by plan 027 Task 7 with a protected drill that uses only standard PostgreSQL tools (`pg_dump` custom format, `pg_restore`, `pg_basebackup`, `psql`) plus the existing migration runner. The drill seeds representative multi-tenant 0.2.7 state (sessions, workflow/saga/ACP/conversation checkpoints, leases, legal holds, tenant quotas, policy decisions, evaluations, work idempotency, tool effects, model-router budgets, ERP outbox/inbox, approvals) through the real store APIs, backs it up, restores it into an explicitly confirmed disposable database, verifies per-table row counts and content digests equal the source, rehearses the 0.2.6 → 0.2.7 migration forward with old rows preserved, rehearses rollback by restoring the pre-upgrade backup, and runs PITR against a WAL-archived cluster to a point between two known writes. The recorded run lives in `docs/_evidence/phase27-dr-evidence.json`.

## When to use it

- Before running any migration or release in a production environment: decide the rollback path first (roll-forward repair preferred; backup-restore is the last resort and only in a disposable environment).
- When an operator must restore a database: read the guarded-command requirements below — this project has no "force restore" shortcut, and destructive commands always require explicit positive confirmation.
- When sizing backup windows or reviewing RPO/RTO: read the measured numbers in the evidence file and the ownership table (managed backup, encryption, retention scheduling, and cross-region replication are operator-owned and not claimed by Prism).

## Inputs / request

- A source instance URL (`PRISM_TEST_POSTGRES_URL` in the drill; any supported PostgreSQL ≥ 14 in practice).
- An explicitly named, disposable target database on a loopback non-production instance, supplied as `--target` plus the confirmation token `--confirm-target prism_dr_restore`. The target must not already exist; the drill refuses dirty state rather than clobbering it.
- A separate WAL-archived cluster for PITR (`PRISM_PITR_URL`) with `wal_level=replica`, `archive_mode=on`, and `archive_command='cp %p /wal_archive/%f'`; source and PITR containers must mount a shared host dir at `/dr` for artifact exchange.
- Sufficient free space (the drill asserts ≥ 512 MB headroom on the artifact dir before starting).

## Outputs / response / events

- A custom-format backup artifact (`.dump`) with its SHA-256 digest, byte size, duration, and table list count.
- A restore report: per-table count and content-digest equality against the source (application-level verification, not just exit codes), and duration.
- A migration report: the 0.2.6-era schema (migrations 001–003) with legacy rows, the upgraded 0.2.7 schema (all five migrations) with old rows preserved and new tables initialized empty, and the rollback rehearsal showing the pre-upgrade backup restores exactly and excludes 0.2.7 tables.
- A PITR report: recovery target time between two known writes, the earlier write present and the later write absent, recovery duration, and measured RPO/RTO.

## Request/response example

```sh
# Protected drill (standard tools only, orchestrated by the script):
PRISM_PITR_URL=postgresql://user:***@localhost:55436/postgres \
  node scripts/phase27-dr.test.mjs \
    --source "$PRISM_TEST_POSTGRES_URL" \
    --target postgresql://user:***@localhost:55432/prism_dr_target \
    --confirm-target prism_dr_restore
```

```ts
// Verifying a restore at the application level (from the drill):
const before = await digest(pool, "prism_erp_outbox");   // md5 of ordered rows
const after = await digest(restorePool, "prism_erp_outbox");
assert.equal(after, before);                              // content equality, not exit code
```

## Implementation example

The drill's legs: (1) seed multi-tenant state through `createPostgresPersistence` and `createPostgresEnterpriseState` plus `createPostgresApprovalStore` with a host authority; (2) `pg_dump -F c` into the shared `/dr` mount; (3) `createdb` the confirmed target and `pg_restore --no-owner --no-privileges`, then verify counts and digests per table; (4) build the 0.2.6-era schema from the raw DDL builders with the recorded migration registry rows, seed legacy rows through the real stores, take a backup, run `applyEnterpriseMigrations` (004/005 apply, old rows preserved, new tables empty), then restore the pre-upgrade backup into a fresh database and confirm 0.2.7 tables are absent; (5) on the WAL-archived cluster, take a `pg_basebackup`, insert two marker transactions a known distance apart, switch WAL and wait for archiving, then start a recovered instance with `recovery.signal`, a bounded `restore_command`, and `recovery_target_time` set between the two writes with `recovery_target_action=pause`, and verify the earlier marker exists and the later one does not.

## Extension and configuration notes

- Storage, encryption at rest, retention scheduling, and cross-region replication are operator-owned: the drill proves the command and verification path, not a managed backup service.
- Rollback decision tree: prefer roll-forward repair after a production migration. Restore-from-backup is the last resort, permitted only in a disposable evidence environment; the recorded loss window is "writes between the pre-upgrade backup and the rollback restore".
- Recovery parameters: `recovery_target_time` in the recovered instance needs `recovery.signal` (or `standby.signal`) present, a `restore_command`, and a full timestamp including the sub-second fraction and offset — truncating to whole seconds can land the recovery point before the intended write.
- Guards that must stay in place: source and target databases must differ; the target host must be loopback and the database name must not match production patterns; the target must not pre-exist; the confirmation token is mandatory; secret canaries seeded into the data must never appear in the manifest or console output.
- Quarterly re-run the drill and refresh `docs/_evidence/phase27-dr-evidence.json` as the schema evolves; treat any change to table counts/digests as needing a new recorded run.

## Security and performance notes

- Credentials are explicit and redacted: the manifest stores URLs with passwords masked, and the drill asserts the source/target/PITR passwords and the seeded secret canary never appear in the evidence, logs, or console. Connection strings are passed to the tools via the container environment, never printed.
- Destructive commands (dropping schemas/databases, restoring over an existing target) require explicit operator action; the drill fails closed on dirty state and never deletes anything itself.
- Legal-hold data is verified: legal-hold records and their referenced rows survive backup and restore with content digests intact; enforcement of holds stays host-owned (the stores preserve the records; the leases/quota/outbox lifecycle logic stays unchanged).
- Performance: measured in the disposable environment — backup 108,291 bytes in 122 ms, restore 382 ms, PITR recovery 1.2 s with the two markers a sub-second apart (RPO ≈ 0 s, RTO ≈ 1 s). These are environment-local measurements for sizing, not guarantees; the drill records sizes, timings, and digests in the evidence file and fails on breached frozen budgets.
- No exactly-once guarantee is claimed anywhere in the backup/restore path; the drill verifies observable equality (counts and digests) instead.

## Related APIs

- `createPostgresPersistence` / `createPostgresEnterpriseState` / `createPostgresApprovalStore` — the stores whose state the drill seeds and verifies.
- `applyEnterpriseMigrations` — the migration runner used for the forward upgrade rehearsal.
- `scripts/phase27-dr.test.mjs` — the protected drill; `docs/_evidence/phase27-dr-evidence.json` — the recorded run.
- [Operations runbook: high availability, failover, and fencing](operations.md) — the lease/fence model and failover ceiling the same state relies on.
- [Signed, hash-chained audit export](audit-export.md) — the append-only audit ledger preserved through backup/restore.