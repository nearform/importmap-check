import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { createAnalysisError } from "../analysis/load.js";
import { rewriteSpecifier } from "./specifier.js";

const escapeRegex = (text) => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Preserve the original encoding style: if the specifier in the URL was
// percent-encoded, percent-encode the new specifier the same way; otherwise
// emit the raw form (caret/tilde selectors typically appear decoded in import
// maps even though strict URL parsing would require encoding). Shared by the
// outer-slot and `?deps=` rewrites so both keep the identical philosophy.
const encodeLikeOriginal = (originalSpec, newSpecifier) => {
  return originalSpec.includes("%")
    ? encodeURIComponent(newSpecifier)
    : newSpecifier;
};

const replaceUrlSpecifier = (url, newSpecifier) => {
  // Scope the version-`@` search to the PATH portion (before any `?` query
  // string). esm.sh URLs can carry `?deps=<pkg>@<version>` pins whose `@` sits
  // after the outer package's `@`; a plain `url.lastIndexOf("@")` would land
  // on the dep pin and rewrite the wrong slot. Within the path portion, the
  // last `@` is still the outer version separator, since scoped packages
  // carry a leading `@scope/` earlier in the path.
  const questionMarkIndex = url.indexOf("?");
  const pathEnd = questionMarkIndex === -1 ? url.length : questionMarkIndex;
  const versionSeparatorIndex = url.lastIndexOf("@", pathEnd - 1);

  if (versionSeparatorIndex === -1) {
    return url;
  }

  let specifierEnd = pathEnd;
  const slashIndex = url.indexOf("/", versionSeparatorIndex + 1);

  if (slashIndex !== -1 && slashIndex < specifierEnd) {
    specifierEnd = slashIndex;
  }

  const encodedSpec = url.slice(versionSeparatorIndex + 1, specifierEnd);
  const newEncodedSpec = encodeLikeOriginal(encodedSpec, newSpecifier);

  return (
    url.slice(0, versionSeparatorIndex + 1) +
    newEncodedSpec +
    url.slice(specifierEnd)
  );
};

// Splice a single dependency's version token inside an esm.sh `?deps=` query
// value, in place, preserving dependency order, separators, and per-token
// encoding. We operate on the raw query text — never re-serializing through a
// URL query parser — because a round-trip would re-encode the whole query
// (`@`→`%40`, `,`→`%2C`) and decode `+` to a space, both of which would corrupt
// the minimal-diff the tool guarantees. Separator handling mirrors the parse
// side (`parseDependencyPins`): literal `,` between tokens and literal `@`
// before the version. Every token whose package identity matches is spliced.
export const replaceDepsSpecifier = (url, packageName, newSpecifier) => {
  const questionMarkIndex = url.indexOf("?");

  if (questionMarkIndex === -1) {
    return url;
  }

  const query = url.slice(questionMarkIndex + 1);
  let changed = false;

  const newParams = query.split("&").map((param) => {
    if (!param.startsWith("deps=")) {
      return param;
    }

    const value = param.slice("deps=".length);
    const newTokens = value.split(",").map((token) => {
      const versionSeparatorIndex = token.lastIndexOf("@");

      if (versionSeparatorIndex <= 0) {
        return token;
      }

      // Trim only for identity comparison; splice preserves the raw token.
      if (token.slice(0, versionSeparatorIndex).trim() !== packageName) {
        return token;
      }

      const rawVersion = token.slice(versionSeparatorIndex + 1);
      const newEncodedSpec = encodeLikeOriginal(rawVersion, newSpecifier);

      if (rawVersion === newEncodedSpec) {
        return token;
      }

      changed = true;

      return token.slice(0, versionSeparatorIndex + 1) + newEncodedSpec;
    });

    return `deps=${newTokens.join(",")}`;
  });

  if (!changed) {
    return url;
  }

  return url.slice(0, questionMarkIndex + 1) + newParams.join("&");
};

const rewriteDestinationUrls = (content, replacements) => {
  // Sort longer URLs first so a shorter URL substring never accidentally
  // rewrites a longer URL's prefix. The `:\s*` lookbehind restricts each match
  // to a JSON *value* slot — i.e. an import-map `"key": "value"` pair where the
  // URL sits on the value side of the colon. URL keys with their own pinned
  // version (e.g. `"https://esm.sh/react@19.1.0/": "https://esm.sh/react@19.2.3"`)
  // share the value's URL bytes only when they happen to match exactly, and
  // skipping them preserves the user's intentional pin while still rewriting
  // the value side.
  const sorted = [...replacements]
    .filter(({ newUrl, oldUrl }) => newUrl !== oldUrl)
    .sort((left, right) => right.oldUrl.length - left.oldUrl.length);

  let updated = content;

  for (const { newUrl, oldUrl } of sorted) {
    const pattern = new RegExp(`(?<=:\\s*)"${escapeRegex(oldUrl)}"`, "g");
    updated = updated.replace(pattern, `"${newUrl}"`);
  }

  return updated;
};

const stripIntegrityEntry = (content, url) => {
  // Match a single import map `integrity` property: `"url": "<hash>"`, with
  // any surrounding whitespace, optional leading comma (interior property),
  // and optional trailing comma. Removing the trailing comma when the
  // property precedes another leaves the surrounding object JSON-valid.
  const escaped = escapeRegex(`"${url}"`);
  const re = new RegExp(`[,\\s]*${escaped}\\s*:\\s*"[^"]*"\\s*,?`, "g");

  return content.replace(re, "");
};

const collectEdits = (report) => {
  // One edit per updateable occurrence, including `?deps=` query-pin
  // occurrences (which share the outer entry's destinationUrl). Each edit
  // records which slot it targets — the outer version, or a specific dep
  // token — so the coalescing pass can apply the right surgery. Dist-tag and
  // other non-rewritable specifiers return null from rewriteSpecifier and are
  // dropped here.
  const resultByName = new Map(
    report.packageResults.map((result) => [result.packageName, result]),
  );
  const edits = [];

  for (const occurrence of report.allOccurrences) {
    const result = resultByName.get(occurrence.packageName);

    if (!result || !result.hasUpdate) {
      continue;
    }

    const newSpecifier = rewriteSpecifier(
      occurrence.specifier,
      result.latestVersion,
    );

    if (newSpecifier === null) {
      continue;
    }

    edits.push({
      currentVersion: occurrence.currentVersion,
      destinationUrl: occurrence.destinationUrl,
      fromDepsQuery: Boolean(occurrence.fromDepsQuery),
      latestVersion: result.latestVersion,
      newSpecifier,
      oldSpecifier: occurrence.specifier,
      packageName: occurrence.packageName,
    });
  }

  return edits;
};

const collectRewritesFromReport = (report) => {
  // Coalesce every edit that applies to a single destination URL — an outer
  // version bump plus any number of `?deps=` dependency bumps sharing that URL
  // — into ONE {oldUrl, newUrl} pair. A per-occurrence model would emit
  // multiple pairs keyed on the same oldUrl, and the downstream whole-value
  // string replacement would consume the string on the first pair and silently
  // drop the rest.
  //
  // Outer edits are applied before dep edits for a stable order, though the two
  // touch disjoint regions of the URL (path before `?` vs. the `?deps=` query),
  // so the result is independent of order.
  const edits = collectEdits(report).sort(
    (left, right) => Number(left.fromDepsQuery) - Number(right.fromDepsQuery),
  );
  const byUrl = new Map();
  const effectiveRewrites = [];

  for (const edit of edits) {
    const entry = byUrl.get(edit.destinationUrl) ?? {
      newUrl: edit.destinationUrl,
      oldUrl: edit.destinationUrl,
      triggeringPackages: [],
    };
    const nextUrl = edit.fromDepsQuery
      ? replaceDepsSpecifier(entry.newUrl, edit.packageName, edit.newSpecifier)
      : replaceUrlSpecifier(entry.newUrl, edit.newSpecifier);

    if (nextUrl === entry.newUrl) {
      // This edit changed nothing (e.g. no-op splice); do not surface it.
      continue;
    }

    entry.newUrl = nextUrl;
    entry.triggeringPackages.push(edit.packageName);
    byUrl.set(edit.destinationUrl, entry);

    // Per-package transformation record consumed by the post-rewrite summary.
    effectiveRewrites.push({
      currentVersion: edit.currentVersion,
      latestVersion: edit.latestVersion,
      newSpecifier: edit.newSpecifier,
      oldSpecifier: edit.oldSpecifier,
      packageName: edit.packageName,
    });
  }

  const urlReplacements = [...byUrl.values()].filter(
    (entry) => entry.newUrl !== entry.oldUrl,
  );

  return { rewrites: effectiveRewrites, urlReplacements };
};

const collectStrippedIntegrityEntries = (report, urlReplacements) => {
  // For each coalesced URL replacement, check whether an occurrence at that URL
  // had an `integrity` map attached. If the original or rewritten URL appears
  // as a key in that map, strip it and record a hard warning. This covers URL
  // changes originating from an outer rewrite, a `?deps=` pin rewrite, or both,
  // since any change to the URL's bytes invalidates its integrity hash.
  const stripped = [];
  const seen = new Set();

  for (const { newUrl, oldUrl, triggeringPackages } of urlReplacements) {
    const occurrence = report.allOccurrences.find(
      (occurrence) => occurrence.destinationUrl === oldUrl,
    );

    if (!occurrence || !occurrence.integrity) {
      continue;
    }

    for (const url of [oldUrl, newUrl]) {
      if (occurrence.integrity[url] && !seen.has(url)) {
        seen.add(url);
        stripped.push({
          message: `Stripped integrity entry for ${url} (triggered by ${triggeringPackages[0]}).`,
          packageName: triggeringPackages[0],
          url,
        });
      }
    }
  }

  return stripped;
};

// Pure computation of the rewrite plan: which entries change, which integrity
// entries get stripped, and the exact would-be-written content — with NO file
// modification. `--update` follows this with `commitTargetRewrite`; `--dry-run`
// renders the plan (via the unified diff) and never commits.
export const planTargetRewrite = async (targetPath, report) => {
  const { rewrites, urlReplacements } = collectRewritesFromReport(report);

  if (urlReplacements.length === 0) {
    return {
      lookupFailures: report.lookupFailures,
      notes: report.notes,
      noChanges: true,
      originalContent: null,
      rewrites: [],
      strippedIntegrityEntries: [],
      targetPath,
      updatedContent: null,
      warnings: report.warnings,
    };
  }

  const originalContent = await readFile(targetPath, "utf8");
  const strippedIntegrityEntries = collectStrippedIntegrityEntries(
    report,
    urlReplacements,
  );
  const strippedUrls = new Set(
    strippedIntegrityEntries.map((entry) => entry.url),
  );

  // Strip integrity entries FIRST (keyed by the OLD URL), then apply URL
  // rewrites. If we rewrite first, the integrity block's keys would already
  // be re-keyed to the new URL by the time the stripper runs, which would
  // leave stale hashes silently migrated to new URLs.
  let strippedContent = originalContent;

  for (const url of strippedUrls) {
    strippedContent = stripIntegrityEntry(strippedContent, url);
  }

  const updatedContent = rewriteDestinationUrls(
    strippedContent,
    urlReplacements.map(({ newUrl, oldUrl }) => ({ newUrl, oldUrl })),
  );

  return {
    lookupFailures: report.lookupFailures,
    notes: report.notes,
    noChanges: false,
    originalContent,
    rewrites,
    strippedIntegrityEntries,
    targetPath,
    updatedContent,
    warnings: [...report.warnings, ...strippedIntegrityEntries],
  };
};

// The only side effect: atomically write the planned content onto the target.
// A no-change plan is a no-op so callers can commit unconditionally.
export const commitTargetRewrite = async (targetPath, plan) => {
  if (plan.noChanges) {
    return;
  }

  const originalStat = await stat(targetPath);
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.importmap-check-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await writeFile(tempPath, plan.updatedContent);
    await chmod(tempPath, originalStat.mode & 0o777);
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    const wrapped = createAnalysisError(
      `Failed to write update to ${targetPath}: ${error.message}`,
    );
    wrapped.cause = error;
    throw wrapped;
  }
};

export const rewriteTargetInPlace = async (targetPath, report) => {
  const plan = await planTargetRewrite(targetPath, report);
  await commitTargetRewrite(targetPath, plan);

  return plan;
};
