/**
 * Host-pinned work sandbox image. The 64-zero digest is a fixture placeholder —
 * operators replace it with `docker image inspect --format '{{.Id}}'` after build.
 * `createDockerSandbox` requires `name@sha256:<64-hex>` and never pulls.
 */
export const WORK_SANDBOX_IMAGE = "prism-work-sandbox@sha256:0000000000000000000000000000000000000000000000000000000000000000";
