/**
 * Opaque, host-asserted actor. The kernel never synthesizes or verifies an
 * identity; packages that need a verified one enforce it themselves
 * (`@arnilo/prism-extensions/governance`, durable effects in `tools-coding`).
 */
export interface Principal {
  readonly kind: "user" | "service" | "agent" | string;
  readonly id: string;
  readonly displayName?: string;
}
