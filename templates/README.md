# Templates

`templates/package/` is the scaffold behind `prism new package <name>`: a package directory with
`package.json`, `src/index.ts` (a `definePackage` default export), `src/__tests__/package.test.ts`
(the `packageConformance` suite from `@arnilo/prism/testing`), and `README.md`.

Files end in `.tmpl` so the repository's own tooling does not treat them as source. The test template is `package.test.ts.tmpl` at the top level because the published tarball denies `__tests__` paths; `prism new package` writes it to `src/__tests__/`. `{{name}}` and
`{{kernelVersion}}` are the only tokens.
