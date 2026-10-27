import type { ErrorInfo } from "./contracts.js";
export interface TrustRequest {
    readonly kind: "project" | "resource" | "extension" | string;
    readonly target: string;
    readonly capability?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface TrustDecision {
    readonly trusted: boolean;
    readonly reason?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface TrustPolicy {
    check(request: TrustRequest): TrustDecision | Promise<TrustDecision>;
}
export interface PermissionRequest {
    readonly kind: "tool" | "extension" | "resource" | string;
    readonly action: string;
    readonly target: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface PermissionDecision {
    readonly allowed: boolean;
    readonly reason?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface PermissionPolicy {
    check(request: PermissionRequest): PermissionDecision | Promise<PermissionDecision>;
}
export declare class TrustDeniedError extends Error {
    readonly request: TrustRequest;
    readonly decision: TrustDecision;
    readonly code = "ERR_PRISM_UNTRUSTED";
    constructor(request: TrustRequest, decision: TrustDecision);
}
export declare class PermissionDeniedError extends Error {
    readonly request: PermissionRequest;
    readonly decision: PermissionDecision;
    readonly code = "ERR_PRISM_PERMISSION_DENIED";
    constructor(request: PermissionRequest, decision: PermissionDecision);
}
export declare function isTrusted(policy: TrustPolicy | undefined, request: TrustRequest): Promise<boolean>;
export declare function assertTrusted(policy: TrustPolicy | undefined, request: TrustRequest): Promise<void>;
export declare function createStaticTrustPolicy(decision: boolean | TrustDecision): TrustPolicy;
export declare function checkPermission(policy: PermissionPolicy | undefined, request: PermissionRequest): Promise<PermissionDecision>;
export declare function assertPermission(policy: PermissionPolicy | undefined, request: PermissionRequest): Promise<void>;
export declare function createStaticPermissionPolicy(options: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
} | boolean): PermissionPolicy;
export declare function denialToErrorInfo(error: unknown): ErrorInfo;
