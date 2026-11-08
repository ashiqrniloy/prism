import type { Secret } from "../contracts.js";

/** A stored secret with the name/provider keys a credential store addresses it by (`@arnilo/prism-keyring`). */
export interface CredentialRecord {
  readonly name: string;
  readonly provider?: string;
  readonly credential: Secret;
}
