export declare class MemoryError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class MemoryValidationError extends MemoryError {
    constructor(message: string);
}
export declare class MemoryConflictError extends MemoryError {
    constructor(message: string);
}
export declare class MemoryScopeError extends MemoryError {
    constructor(message: string);
}
export declare class MemoryLimitError extends MemoryError {
    constructor(message: string);
}
export declare class MemoryAbortError extends MemoryError {
    constructor(message?: string);
}
