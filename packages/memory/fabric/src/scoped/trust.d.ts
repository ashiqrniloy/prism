import type { MemoryFabric } from "../types.js";
export declare function scanScopedMemoryContent(text: string): {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly class: "prompt-injection" | "exfil" | "invisible-unicode";
};
export declare function gateScopedMemoryContent(text: string): void;
export declare function listScopedPending(ledgerFile: string): Promise<readonly {
    readonly id: string;
    readonly kind: "review" | "archive";
    readonly gist: string;
    readonly createdAt: string;
}[]>;
export declare function approveScopedPending(input: {
    readonly fabric: MemoryFabric;
    readonly ledgerFile: string;
    readonly id: string;
}): Promise<void>;
export declare function rejectScopedPending(input: {
    readonly ledgerFile: string;
    readonly id: string;
}): Promise<void>;
