---
"importmap-check": patch
---

Handle esm.sh's leading `*` (external-deps marker) when parsing package URLs. URLs like `https://esm.sh/*pkg@<version>` and `https://esm.sh/*@scope/pkg@<version>` now strip the `*` before scope-vs-unscoped resolution, so the package identity is recovered correctly and the registry lookup for `*` no longer 404s.
