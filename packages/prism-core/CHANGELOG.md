## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

# Changelog

All notable changes to `@arnilo/prism-core` will be documented in this file.

## [0.3.3] - 2026-09-01

### Added
- Initial release of `@arnilo/prism-core` family package consolidating runtime, sessions, governance, credentials, enterprise persistence, and work integrations into explicit subpaths.
- `/runtime/server`, `/runtime/supervisor`, `/runtime/workflows`
- `/sessions/codecs`, `/sessions/sqlite`, `/sessions/postgres`, `/sessions/nats`
- `/governance/policy`, `/governance/evals`, `/governance/prompts`, `/governance/model-router`, `/governance/observability`
- `/credentials/node` (including `/credentials/node/oidc`)
- `/enterprise/postgres`
- `/integrations/work` (including `/integrations/work/microsoft365`, `/integrations/work/google-workspace`)
- `/validation/json-schema`

## [0.1.0] - 2026-08-09

### Changed
- Finalized 0.1.0 package baseline.

## [0.0.28] - 2026-08-08

### Added
- Pre-release baseline.
