// Plan 079 Task 2: channel limits. Defaults come from the Task 1 review section 6; hard caps
// cannot be raised, only lowered (the store/platform ceilings in that table stay above them).
import type { ChannelLimits, ResolvedChannelLimits } from "./types.js";

export const DEFAULT_CHANNEL_LIMITS: ResolvedChannelLimits = {
  maxInputBytes: 32 * 1024,
  maxResponseBytes: 64 * 1024,
  maxPendingPerBinding: 8,
  maxPendingPerProcess: 100,
  maxActiveSessions: 4,
  maxRoutes: 1_000,
  maxSeenEventsPerConnection: 1_000,
  stopDeadlineMs: 30_000,
  retentionDays: 7,
  maxJournalPage: 100,
  maxJournalRecordBytes: 128 * 1024,
  leaseTtlMs: 30_000,
  approvalTtlMs: 5 * 60_000,
  maxAttachmentBytes: 1024 * 1024,
};

export const HARD_CHANNEL_LIMITS: ResolvedChannelLimits = {
  maxInputBytes: 64 * 1024,
  maxResponseBytes: 128 * 1024,
  maxPendingPerBinding: 32,
  maxPendingPerProcess: 500,
  maxActiveSessions: 16,
  maxRoutes: 10_000,
  maxSeenEventsPerConnection: 10_000,
  stopDeadlineMs: 5 * 60_000,
  retentionDays: 90,
  maxJournalPage: 500,
  maxJournalRecordBytes: 512 * 1024,
  leaseTtlMs: 5 * 60_000,
  approvalTtlMs: 5 * 60_000,
  maxAttachmentBytes: 4 * 1024 * 1024,
};

export function resolveChannelLimits(input: ChannelLimits = {}): ResolvedChannelLimits {
  const out = {} as Record<keyof ResolvedChannelLimits, number>;
  for (const key of Object.keys(DEFAULT_CHANNEL_LIMITS) as (keyof ResolvedChannelLimits)[]) {
    const value = input[key] ?? DEFAULT_CHANNEL_LIMITS[key];
    if (!Number.isFinite(value) || value < 1 || value > HARD_CHANNEL_LIMITS[key]) {
      throw new TypeError(`Channel limit ${key} must be a positive number no greater than ${HARD_CHANNEL_LIMITS[key]}`);
    }
    out[key] = value;
  }
  return out as ResolvedChannelLimits;
}
