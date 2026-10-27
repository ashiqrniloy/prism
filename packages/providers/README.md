# Provider packages

Each vendor ships as its own package here: `packages/providers/<vendor>/` →
`@arnilo/prism-provider-<vendor>`. The seven shipped adapters are Hyper, Laya, Liquid, OpenAI Codex,
OpenCode Go, OpenRouter, and Typesafe; there is no provider family umbrella package.

A provider package is a `definePackage` definition plus a named factory, both built on the shared
surface in `@arnilo/prism/provider-kit` (`defineProviderPackage`, `providerPackageInstance`,
`secretRefProperty`/`baseUrlProperty`/`modelsProperty`, `refSource`/`optionalRefSource`). The
vendor-specific parts stay in the package: its config schema, its `setup` body, its wire helpers,
and its model catalog. `docs/provider-kit.md` documents the surface and shows a minimal
package.

Tooling: `workspacePackageCounts()` (`scripts/package-truth.mjs`) counts a package one level under a
non-package group directory, and `packaging.test.ts` accepts a grouped dir with a TypeScript-source
export (`sourceExport: true`). The root `workspaces` glob is `packages/providers/*`. Provider
packages stay on the kernel version line (lockstep) until Phase 11, so they are **not** listed in
`scripts/independent-packages.json`.
