# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-07-08

### Added

- Initial release of `@arnilo/prism-coding-agent`: first-party optional coding tools package for Prism.
- `shell` tool: run host shell commands with bounded output, timeout, abort support, and cross-platform process-tree cleanup.
- `read` tool: read text files with offset/limit/continuation and truncation, or read supported image files (PNG/JPEG/GIF/WebP/BMP) as `ImageContent`.
- `write` tool: create or overwrite files, creating parent directories as needed, with UTF-8 byte-correct confirmation.
- `edit` tool: precise exact-then-fuzzy text replacement in existing files, returning diff/patch metadata.
- Aggregator factories: `createCodingTools`, `createReadOnlyTools`, `createAllTools`.
- Pluggable operation backends for every tool (`BashOperations`, `ReadOperations`, `WriteOperations`, `EditOperations`).
- Behavioral ports of pi coding-agent primitives: `truncate`, `edit-diff`, `path-utils`, `output-accumulator`, `file-mutation-queue`.
- Runtime dependency on `diff` for unified patch generation; otherwise Node standard library only.
