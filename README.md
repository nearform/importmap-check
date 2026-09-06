# importmap-check

Dependency checker/updater for ESM dependencies from common CDNs.

## Overview

importmap-check reads your ESM import maps and identifies dependency versions and available upgrades. The default invocation is check-only: it analyzes targets and reports findings without modifying files. Pass `--update` / `-u` to rewrite updateable entries in place.

Features:

- Modern CDN support: [jsDelivr](https://www.jsdelivr.com/esm), [esm.sh](https://esm.sh/)
- Simple, no-dep CLI.

## Installation

Run it on demand with `npx`:

```sh
$ npx importmap-check <target-path>
```

Or install it globally:

```sh
$ npm install --global importmap-check
```

## Usage

```sh
$ importmap-check [options] <target-path>
```

Options:

- `--sources` — Show the import-map entry origins that contributed to each conflated package row.
- `--width <num>` — Override the available report width (used with `--sources`). Defaults to the terminal width, or `120` when not running in a TTY.
- `-u, --update` — Rewrite updateable entries in the target file in place. See **Update Mode** below for behavior, judgment calls, and caveats.
- `--dry-run` — Preview the entries `--update` would rewrite as a unified diff, without writing the target file. Usable on its own, and takes precedence over `--update` when both are passed. `--sources` / `--width` have no effect in this mode. See **Update Mode** below.

Environment:

- `IMPORTMAP_CHECK_REGISTRY_URL` — Base URL of the npm registry used to resolve versions and dist-tags. Defaults to `https://registry.npmjs.org`. Point it at a private registry mirror if needed.

Supported target types:

- Standalone import map JSON files
- HTML files with one or more inline `<script type="importmap">` blocks

What importmap-check analyzes:

- Parses import map `imports` entries from JSON and inline HTML
- Supports package-style keys and remap-style URL/path keys
- Analyzes `jsdelivr` and `esm.sh` destination URLs
- Combines multiple inline import maps into one package-level analysis result
- Warns for supported-but-unparseable entries and unsupported `scopes`

## Update Mode

```sh
$ importmap-check --update [options] <target-path>
```

`--update` / `-u` rewrites updateable import map entries in the target file in place and prints a post-rewrite summary to stdout describing what changed. The default target is the npm registry's `latest` dist-tag.

> ⚠️ **Make sure your target file is in version control and all changes are committed before running `--update`**, or preview the exact edits first with `--dry-run` (see **Previewing changes** below). importmap-check does not snapshot before writing; the atomic write step protects against interrupted writes but not against losing work you hadn't committed.

### Previewing changes with `--dry-run`

```sh
$ importmap-check --dry-run <target-path>
```

`--dry-run` computes the same rewrite plan `--update` would apply and prints it as a unified line diff, **without writing the target file**. It is usable on its own, and when combined with `--update` the dry run wins — no file is written either way.

```bash
$ importmap-check --dry-run ./public/index.html
Dry run — no files written.

--- ./public/index.html
+++ ./public/index.html
@@ -6,8 +6,8 @@
         "imports": {
-          "react": "https://esm.sh/react@19.2.3",
-          "react-dom/client": "https://esm.sh/react-dom@19.2.3/client"
+          "react": "https://esm.sh/react@19.3.0",
+          "react-dom/client": "https://esm.sh/react-dom@19.3.0/client"
         }
```

Because the diff is computed from the bytes `--update` would write, integrity entries that would be stripped appear as removed (`-`) lines. The same **Warnings**, **Stripped integrity entries**, **Lookup Failures**, and **Notes** sections that follow an `--update` are printed after the diff. When nothing would change, `--dry-run` prints `No changes would be written.` plus any applicable warnings or notes.

### Rewrite behavior by specifier class

importmap-check preserves the specifier style you wrote. The exact rewrite depends on the specifier class:

| Specifier class     | Example         | When `--update` finds an update, the entry becomes                                                         |
| ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| Pinned              | `react@19.2.3`  | `react@<latest>`                                                                                           |
| Caret range         | `react@^19.2.3` | `react@^<latest major>.0.0`                                                                                |
| Tilde range         | `react@~19.2.3` | `react@~<latest major>.0.0` (cross-major) or `react@~<latest>.<latest minor>.0` (cross-minor within major) |
| Major-only selector | `react@18`      | `react@<latest major>`                                                                                     |
| Minor-only selector | `react@18.3`    | `react@<latest major>.<latest minor>`                                                                      |
| Dist-tag            | `react@beta`    | **not rewritten** — see _Dist-tag entries_ below                                                           |

Each rewrite preserves every other portion of the URL (CDN family, scoped package name, subpath, and non-`deps` query parameters). Updateable `?deps=` pins on the same URL are rewritten too — see **`?deps=` query pins are rewritten in place** below. Caret and tilde rewrites follow npm's semver locking rules: caret locks the leftmost non-zero element of `[major, minor, patch]`; tilde locks the position immediately left of the rightmost-specified position.

### URL-style keys are preserved; only the value is rewritten

Import map keys can be full URLs (the [import remap](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap#mapping_import_specifiers_as_URLs) shape), and `--update` treats them as intentional pins: the key side of `"<URL-key>": "<URL-value>"` is never rewritten, even when the key and value URL happen to be byte-identical. Only the value side is lifted to the new latest:

```diff
- "https://cdn.jsdelivr.net/npm/react@19.0.0/": "https://cdn.jsdelivr.net/npm/react@19.2.3/",
- "https://cdn.jsdelivr.net/npm/react@19.1.0/": "https://cdn.jsdelivr.net/npm/react@19.2.3/",
- "https://cdn.jsdelivr.net/npm/react-dom@19.1.0/": "https://cdn.jsdelivr.net/npm/react-dom@19.2.3/"
+ "https://cdn.jsdelivr.net/npm/react@19.0.0/": "https://cdn.jsdelivr.net/npm/react@19.3.0/",
+ "https://cdn.jsdelivr.net/npm/react@19.1.0/": "https://cdn.jsdelivr.net/npm/react@19.3.0/",
+ "https://cdn.jsdelivr.net/npm/react-dom@19.1.0/": "https://cdn.jsdelivr.net/npm/react-dom@19.3.0/"
```

The matching is scoped to value slots only: a URL is only rewritten when it sits on the right-hand side of a `:`, so URL keys that skew the same package (multiple keys pinning different versions) all keep their original bytes while their shared value floats to the new latest.

### Major-version-zero ranges

Per npm's "0.x changes are breaking" rule, ranges on `0.x` packages lock the minor position (not the major):

- `react@^0.1.0` with `latest=0.2.5` rewrites to `^0.2.0` (within-0.x lift, locked-minor moves from 0.1 to 0.2)
- `react@^0.1.0` with `latest=1.0.0` rewrites to `^1.0.0` (fallthrough to major-locked semantics)
- `react@^0.0.3` with `latest=0.0.5` rewrites to `^0.0.5` (within-0.0.x lift, only the locked patch position moves)
- `react@^0.0.3` with `latest=0.1.0` rewrites to `^0.1.0` (promotion from patch-locked to minor-locked)
- `react@~0.0.3` follows npm's quirk where `~0.0.z := >=0.0.z <0.0.z+1` (same as caret on 0.0.x), and rewrites the same way as `^0.0.3`

The narrow `^0.0.z` handling is intentional: ESM CDNs apply actual npm semver rules at request time, so broadening `^0.0.3` to `^0.5.0` would silently admit any 0.x version esm.sh serves — which is not what the `^0.0.3` specifier expresses.

### Dist-tag entries are not rewritten

Dist-tag entries (e.g. `react@beta`, `react@next`, `react@latest`) are **not rewritten** by `--update`. ESM CDNs re-resolve dist-tags from the npm registry live at request time, so a `react@beta` URL already floats to whatever `dist-tags.beta` currently points to — there is no time-of-authoring version lag the tool is responsible for closing. Rewriting `react@beta` to e.g. `react@19.0.0-beta-...` would only snapshot a value the user already had access to via the floating tag, which is an opt-in decision the user should make explicitly.

If the analyzer produces informational notes about dist-tag entries during check-only analysis (for example, when the stable `latest` differs from the resolved tag), those notes are preserved verbatim in the post-rewrite summary. Future changes will add `--pin` and `--pin-channel` flags for opt-in dist-tag flattening.

### Integrity entries are stripped, not regenerated

When `--update` rewrites a URL that has a corresponding entry in the import map's `integrity` section, importmap-check **strips** that integrity entry and emits a hard warning:

```
## Stripped integrity entries
- https://esm.sh/react@19.3.0 (triggered by react)
```

Stripped entries are **not regenerated** in this version. SRI hashes are author-time commitments to specific bytes the browser will fetch; computing a replacement hash requires fetching the new URL's body and matching the request-shaping a browser would use, which has documented edge cases around brotli/gzip encodings and esm.sh's user-agent-sensitive build-target selection. Rather than ship brittle regeneration silently, importmap-check leaves re-pinning to you: validate the new URL in a browser, then re-add the SRI hash manually.

A future change will add `--regenerate-integrity` (with a `--no-regenerate-integrity` opt-out) once the browser-vs-CLI byte-stability question has been empirically validated.

### `?deps=` query pins are rewritten in place

esm.sh URLs may carry a `?deps=react@18,react-dom@19.2.3` query string pinning dependency versions. `--update` rewrites updateable dependency pins the same way it rewrites the outer package: each pin's specifier class (pinned, caret, tilde, major-only, minor-only) is resolved and lifted per the same rules in the table above. Dist-tag dependency pins (e.g. `?deps=react@beta`) are left floating, matching outer dist-tag behavior.

Dependency pins are rewritten by splicing the individual dependency token in place — the query string's dependency order, separators, and per-token encoding are preserved. importmap-check never re-serializes the query string through a URL parser, so a rewrite touches only the version tokens that actually change (keeping the diff minimal and avoiding the `+`→space decoding a round-trip would introduce).

When a single URL needs several edits at once — an outer version bump plus one or more dependency-pin bumps — all edits are coalesced into one rewrite, so no edit overwrites another:

```
- "app": "https://esm.sh/app@1.0.0?deps=react@18.2.0,scheduler@^0.23.0"
+ "app": "https://esm.sh/app@2.0.0?deps=react@19.3.0,scheduler@^0.24.0"
```

If a rewritten URL has a corresponding `integrity` entry, that entry is stripped and a hard warning is emitted (see **Integrity entries are stripped, not regenerated** above) — this applies whether the URL changed because of the outer package, a `?deps=` pin, or both.

> **Known limitation:** the post-rewrite summary groups rewrites by package name, so a package that appears both as an outer import-map entry and as a `?deps=` pin inside another package's URL produces summary lines that cannot be told apart. The rewrites themselves are still applied correctly to each distinct URL; only the summary is ambiguous. Distinguishing dependency-context rows is deferred to a future summary-clarity change.

Encoded separators between dependencies (a `%2C` in place of the literal `,` esm.sh emits) are out of scope: both the parser and the rewriter operate on the literal-separator form esm.sh produces. If encoded separators surface in the wild, parse and rewrite support will be added together.

### Resolution tightening (check-only behavior change)

This change also tightens importmap-check's existing range-resolution logic for `^0.x.y` and `~0.0.z` specifiers in check-only mode. Previously, `^0.2.3` was treated as `^0` (resolved to the highest 0.x version published), and `~0.0.3` was treated as `~0.0`. Both were looser than npm's strict semver rules.

Going forward, `^0.2.3` resolves to the highest 0.2.x version, and `^0.0.3` resolves to the highest 0.0.x version — matching what esm.sh itself serves at request time. This may change the `Resolved` value importmap-check reports for some import map entries versus prior versions of the tool. The previous values were reflecting looser-than-npm semantics; the new values reflect what the CDN actually serves.

### Single target, single invocation

importmap-check operates on exactly one target path per invocation. Multi-target scanning and `--filter`/`--reject` (per-package targeting) are deferred to future changes. `--update` rewrites every updateable entry in the file; to apply updates selectively, use version control to revert unwanted changes after the write, or wait for the `--filter` / `--interactive` follow-up changes.

### Atomic write

`--update` writes the rewritten content to a temporary file in the same directory as the target, then atomically moves the temporary file onto the target path. An interrupted update never leaves a half-written target file. The temporary file is cleaned up if the write or move step fails.

## Development Workflow

- Run `npm run format` after repo changes from a shell where the expected Node version is already active.
- Treat formatting as part of done: auto-fix what can be fixed, and investigate any remaining failures before considering the work complete.

## Example Output

```bash
$ importmap-check
Target: ./public/index.html

## Updates
Package    Resolved  Latest
---------  --------  ------
react      19.2.3    19.3.0
react-dom  19.2.3    19.3.0

## Warnings
- ./public/index.html contains `scopes`, which are not yet supported.
```

## Example: Update Mode

```bash
$ importmap-check --update ./public/index.html
Updated ./public/index.html:

  react         19.2.3 → 19.3.0
  react-dom     ^19.2.3 → ^20.0.0
  swr           18 → 19
  @scope/lib    ^0.1.0 → ^0.2.0

## Stripped integrity entries
- https://esm.sh/react@19.3.0 (triggered by react)
- https://esm.sh/react-dom@^20.0.0 (triggered by react-dom)

## Notes
- typescript has import map integrity metadata tied to a URL that would need review if updated.
```

Run `importmap-check --update` again against the same file with stable `latest` dist-tags and you'll see `No changes to write` — the update is idempotent until the npm registry's `latest` moves.
