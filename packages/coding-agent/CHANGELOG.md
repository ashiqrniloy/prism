# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Added

- Finite validated defaults/hard caps for text scans, image/file/input/edit counts, shell wall time, display output, and total shell output.
- Exported coding limit constants plus bounded `ReadOperations.readText` page contracts.

### Changed

- Text reads stream one bounded page instead of loading the entire file; edit/image reads use a shared bounded file reader after stat checks.
- Shell defaults to a 600-second timeout, kills the operation at 64 MiB combined output, and creates exclusive Unix `0600` spill files.
- Failed/aborted/timed-out/output-limited shell calls delete unpublished spill files; successful truncated output remains host-owned at `metadata.fullOutputPath`.
- Custom `ReadOperations` now require `readText` and `statFile`; custom `EditOperations` require `statFile` and receive byte/signal options.
- Removed non-exported filesystem edit-preview helpers that duplicated the edit tool's file read path.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

### Added

- `read` tool image bounds: `maxImageBytes` (default 10 MB), optional `transformImage` callback, `DEFAULT_MAX_IMAGE_BYTES`, and `ReadOperations.statFile` for stat-first rejection.

### Changed

- Shell tools expose `exclusive: true`; all coding tools can apply host `ExecutionPolicy` checks before side effects.
- `autoResizeImages` on `read` is deprecated; it is ignored unless `transformImage` is also provided.
- Image read metadata now includes `image.bytes` and `image.resized` reflects whether `transformImage` ran.

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
