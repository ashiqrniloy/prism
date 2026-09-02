# Ponytail fixture provenance

`upstream-full/` and `upstream-minimal/` vendor the ponytail plugin
([github.com/DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail))
so Prism's extension-loading tests exercise a realistic third-party upstream
layout without network access.

- Upstream version: 4.9.0
- Vendored from: local pi agent install
  (`~/.pi/agent/git/github.com/DietrichGebert/ponytail`), hooks + skills only —
  no assets, benchmarks, docs, or mcp/extension files.
- Test consumption: `src/ponytail/__tests__/upstream.test.ts` (`upstream-full`
  as a registered extension upstream; `upstream-minimal` for resolve tests).
  Only `ponytail-subagent.js` is executed by tests; other hooks are inert
  fixtures.

## Local patches (drift from upstream)

- `hooks/ponytail-activate.js` — CodeQL js/file-system-race (alert 94):
  the `existsSync(settingsPath)` + `readFileSync` pair became a single
  read-or-catch, and the `.ponytail-statusline-nudged` check-then-write became
  an exclusive-create (`flag: "wx"`). Upstream 4.9.0 still contains the race,
  so re-vendoring does not fix it; re-check upstream on the next re-vendor and
  drop this patch when upstream is race-free.