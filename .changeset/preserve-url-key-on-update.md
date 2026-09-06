---
"importmap-check": patch
---

Preserve URL-style import map keys under `--update`. The rewriter now scopes each URL substitution to value slots only (the right-hand side of a `:`), so remap-style entries whose key is itself a pinned URL — including entries where multiple keys skew the same package at different versions — keep their original key bytes and only the value side floats to the new latest. This also covers the self-mapping case where the key and value URLs are byte-identical.
