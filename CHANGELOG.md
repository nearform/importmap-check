# importmap-check

## 0.1.1

### Patch Changes

- [#4](https://github.com/nearform/importmap-check/pull/4) [`8a39028`](https://github.com/nearform/importmap-check/commit/8a39028e68ea083ed8902bffce37a6d61e313926) - Preserve URL-style import map keys under `--update`. The rewriter now scopes each URL substitution to value slots only (the right-hand side of a `:`), so remap-style entries whose key is itself a pinned URL — including entries where multiple keys skew the same package at different versions — keep their original key bytes and only the value side floats to the new latest. This also covers the self-mapping case where the key and value URLs are byte-identical.

## 0.1.0

### Minor Changes

- 2013b69: Initial release of importmap-check.

  Check and update ESM package versions pinned in browser import maps and CDN URL specifiers, available as both a CLI (`importmap-check`) and a programmatic API.

  - **Check**: scan HTML import maps / CDN URLs and report which pinned packages have newer versions available.
  - **Preview / dry-run**: show a unified diff of the version rewrites that would be applied, without touching files.
  - **Update**: rewrite specifiers in place to the latest versions allowed by each pin's semver range.
  - Semver-range-aware version resolution (caret, tilde, and 0.x quirks) with support for `?deps=` query pins.
