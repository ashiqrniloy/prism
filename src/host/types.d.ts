/** Host port (roadmap §2.3): kernel-to-host capabilities a package may use. */
/** Every request carries the package/session that raised it; both are kernel-set. Package-authored `title`, `detail`, `options`, and `notify.message` are untrusted text: a host renders them as text, never as markup or a command. */
export interface HostUiRequestBase {
    readonly package?: string;
    readonly sessionId?: string;
}
export interface HostUiConfirmRequest extends HostUiRequestBase {
    readonly kind: "confirm";
    readonly title: string;
    readonly detail?: string;
}
export interface HostUiSelectOption {
    readonly value: string;
    readonly label?: string;
}
export interface HostUiSelectRequest extends HostUiRequestBase {
    readonly kind: "select";
    readonly title: string;
    readonly options: readonly HostUiSelectOption[];
    readonly multiple?: boolean;
    readonly detail?: string;
}
export interface HostUiInputRequest extends HostUiRequestBase {
    readonly kind: "input";
    readonly title: string;
    readonly detail?: string;
    readonly placeholder?: string;
    readonly value?: string;
}
/** The host captures a secret and returns it once. The kernel stores it at `ref` through the credentials slot and never hands it back to the package, so `HostUiAnswerMap.secret` is `undefined` from the package's side. */
export interface HostUiSecretRequest extends HostUiRequestBase {
    readonly kind: "secret";
    readonly title: string;
    readonly ref: string;
    readonly detail?: string;
}
export interface HostUiOpenUrlRequest extends HostUiRequestBase {
    readonly kind: "open-url";
    readonly title: string;
    readonly url: string;
}
export interface HostUiNotifyRequest extends HostUiRequestBase {
    readonly kind: "notify";
    readonly level: "info" | "warn" | "error";
    readonly message: string;
}
/**
 * Run an interactive command (a vendor login) in the host's terminal. `command` is untrusted package text
 * a host shows, never shell-interprets. `env` holds non-secret values such as paths: the kernel rejects a
 * credential ref (`env:`/`keyring:`) with `terminal_env_secret`. The terminal's input and output never reach
 * the kernel or the package; the answer carries only the exit code.
 */
export interface HostUiTerminalRequest extends HostUiRequestBase {
    readonly kind: "terminal";
    readonly title: string;
    readonly command: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
}
export type HostUiRequest = HostUiConfirmRequest | HostUiSelectRequest | HostUiInputRequest | HostUiSecretRequest | HostUiOpenUrlRequest | HostUiNotifyRequest | HostUiTerminalRequest;
/**
 * Answer value per request kind. `select` is a list when the request set `multiple`, else a single
 * value. `secret` is the value the host captured: it reaches the kernel, is stored at the request's
 * `ref`, and is `undefined` on the way back to the package (roadmap §2.3).
 */
export interface HostUiAnswerMap {
    confirm: boolean;
    select: string | readonly string[];
    input: string;
    secret: string | undefined;
    "open-url": undefined;
    notify: undefined;
    terminal: {
        readonly exitCode: number;
    };
}
export type HostUiRequestKind = keyof HostUiAnswerMap;
/**
 * `answered` carries the kind's value; `dismissed` means the host showed it and the user declined;
 * `unavailable` means no UI is attached (a package must then fail closed).
 */
export type HostUiResponse<K extends HostUiRequestKind = HostUiRequestKind> = {
    readonly status: "answered";
    readonly value: HostUiAnswerMap[K];
} | {
    readonly status: "dismissed";
} | {
    readonly status: "unavailable";
};
export interface HostUi {
    request<K extends HostUiRequestKind>(request: Extract<HostUiRequest, {
        kind: K;
    }>): Promise<HostUiResponse<K>>;
}
/** Structured logger. A package's calls reach the host's logger redacted, or nowhere when there is none. */
export interface Logger {
    debug(message: string, data?: Readonly<Record<string, unknown>>): void;
    info(message: string, data?: Readonly<Record<string, unknown>>): void;
    warn(message: string, data?: Readonly<Record<string, unknown>>): void;
    error(message: string, data?: Readonly<Record<string, unknown>>): void;
}
/** Host-supplied capabilities. A host without `ui` answers every request `unavailable`. */
export interface HostPort {
    readonly ui?: HostUi;
    readonly log?: Logger;
}
