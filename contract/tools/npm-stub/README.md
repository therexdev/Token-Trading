# npm-stub

`somap` — a single-file "sorted map, implemented as a binary search tree"
library — declares the **npm CLI** as a runtime dependency:

```json
"dependencies": { "npm": "^8.3.0" }
```

Nothing in `somap.js` ever requires it; the entry is a packaging mistake
upstream. But it is a real dependency edge, so installing the contract
toolchain pulls the whole npm CLI into `node_modules`:

    contract
    └── @koinos/sdk-as
        └── @koinos/mock-vm
            └── somap
                └── npm          ~1000 packages, ~10 MB, never executed

Everything npm bundles inside its own tarball (`form-data`, `ip`,
`brace-expansion`, `tar`, `undici`, `ip-address`, …) then shows up in
`npm audit` and in external dependency scanners. Those copies are
`inBundle` — they ship *inside* the npm tarball rather than being resolved
separately — so npm `overrides` cannot patch them, and they only change when
npm itself cuts a release.

This directory is a placeholder package that `contract/package.json` points
`npm` at:

```json
"overrides": { "npm": "file:../../tools/npm-stub" }
```

The CLI is never installed, and the contract build is unaffected —
`npm run build` produces a byte-identical `contract.wasm`.

## If you touch this

- **Keep `version` inside `somap`'s declared range (`^8.3.0`).** `npm ci`
  validates the resolved package against the range of the package that
  declares the dependency, and fails with `Missing: npm@<version> from lock
  file` if it falls outside.
- The `file:` specifier is resolved **relative to the package that declares
  the dependency** (`node_modules/somap/`), not relative to the workspace
  root — hence the `../../` prefix.
- Drop the override entirely if `somap` ever removes its `npm` dependency,
  or if `@koinos/mock-vm` stops depending on `somap`.
