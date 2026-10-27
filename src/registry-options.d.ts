export type DuplicateRegistrationPolicy = "replace" | "error";
export interface DuplicateRegistrationOptions {
    readonly duplicate?: DuplicateRegistrationPolicy;
}
export declare function assertCanRegister<K>(map: ReadonlyMap<K, unknown>, key: K, label: string, displayKey?: string, duplicate?: DuplicateRegistrationPolicy): void;
