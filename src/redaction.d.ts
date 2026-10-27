import type { AgentEvent, ErrorInfo, Message, ProviderRequest, RunLedgerRecord, SessionEntry } from "./contracts.js";
export interface SecretRedactor {
    redact<T>(value: T): T;
}
export declare function createSecretRedactor(secrets: readonly (string | undefined)[]): SecretRedactor;
export declare function redactMessage(message: Message, redactor?: SecretRedactor): Message;
export declare function redactAgentEvent(event: AgentEvent, redactor?: SecretRedactor): AgentEvent;
export declare function redactSessionEntry(entry: SessionEntry, redactor?: SecretRedactor): SessionEntry;
export declare function redactProviderRequest(request: ProviderRequest, redactor?: SecretRedactor): ProviderRequest;
export declare function redactRunLedgerRecord<T extends RunLedgerRecord>(record: T, redactor?: SecretRedactor): T;
export declare function resolveRedactor(redactor?: SecretRedactor, secrets?: readonly (string | undefined)[]): SecretRedactor | undefined;
export declare function redactSecrets<T>(value: T, secrets: readonly (string | undefined)[]): T;
export declare function errorToErrorInfo(error: unknown, secrets?: readonly (string | undefined)[]): ErrorInfo;
