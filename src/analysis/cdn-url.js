import { MAJOR_SELECTOR_PATTERN, MINOR_SELECTOR_PATTERN } from "../semver.js";

const tryParseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const PINNED_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SEMVER_RANGE_PATTERN = /^[~^]\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;
// npm dist-tags are arbitrary strings (e.g. `latest`, `beta`, `preview`,
// `insider`, `canary-minor`). We accept any token of word characters, dots,
// and dashes as a potential specifier and let the registry resolve it.
// Reference: https://docs.npmjs.com/cli/v9/commands/npm-dist-tag
const SPECIFIER_TOKEN_PATTERN = /^[~^]?[\w.+-]+$/;

const isResolvedSpecifier = (token) => {
  return (
    SEMVER_RANGE_PATTERN.test(token) ||
    MAJOR_SELECTOR_PATTERN.test(token) ||
    MINOR_SELECTOR_PATTERN.test(token) ||
    SPECIFIER_TOKEN_PATTERN.test(token)
  );
};

const extractVersionedPackage = (firstSegment, scopeSegment = null) => {
  const versionSeparatorIndex = firstSegment.lastIndexOf("@");

  if (versionSeparatorIndex <= 0) {
    return null;
  }

  const packageName = scopeSegment
    ? `${scopeSegment}/${firstSegment.slice(0, versionSeparatorIndex)}`
    : firstSegment.slice(0, versionSeparatorIndex);
  let versionToken;

  try {
    versionToken = decodeURIComponent(
      firstSegment.slice(versionSeparatorIndex + 1),
    );
  } catch {
    return null;
  }

  if (!packageName || !versionToken) {
    return null;
  }

  if (PINNED_VERSION_PATTERN.test(versionToken)) {
    return { currentVersion: versionToken, packageName, specifier: "" };
  }

  if (isResolvedSpecifier(versionToken)) {
    return { currentVersion: null, packageName, specifier: versionToken };
  }

  return null;
};

const parseJsdelivrPackage = (parsedUrl) => {
  // jsDelivr ESM package URL shapes are documented at https://www.jsdelivr.com/esm
  const segments = parsedUrl.pathname.split("/").filter(Boolean);

  if (segments[0] !== "npm" || segments.length < 2) {
    return null;
  }

  if (segments[1].startsWith("@")) {
    if (segments.length < 3) {
      return null;
    }

    return extractVersionedPackage(segments[2], segments[1]);
  }

  return extractVersionedPackage(segments[1]);
};

const parseEsmShPackage = (parsedUrl) => {
  // esm.sh package URL shapes are documented at https://esm.sh/
  // Supported shapes include:
  //   - https://esm.sh/<pkg>@<version>
  //   - https://esm.sh/<pkg>@<version>/<subpath>
  //   - https://esm.sh/v<digits>/<pkg>@<version>/<subpath>  (build-mark prefix)
  //   - https://esm.sh/@scope/<pkg>@<version>/<subpath>
  //   - https://esm.sh/v<digits>/@scope/<pkg>@<version>/<subpath>
  //   - https://esm.sh/*<pkg>@<version>          (* marks all deps as external)
  //   - https://esm.sh/*@scope/<pkg>@<version>   (* marks all deps as external)
  const segments = parsedUrl.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  let startIndex = 0;

  // esm.sh emits a "/v<digits>/" build-mark prefix for pinned build-line URLs.
  if (/^v\d+$/.test(segments[0])) {
    startIndex = 1;
  }

  if (segments.length <= startIndex) {
    return null;
  }

  // esm.sh's leading `*` flag marks every dependency as external. It is a
  // URL-level marker and is not part of the package identity, so it must be
  // stripped before the scope-vs-unscoped decision is made; otherwise an
  // unscoped `*<pkg>@<ver>` would surface a package name of `*<pkg>` and the
  // scoped `*@scope/<pkg>@<ver>` form would mis-extract `*` as the package.
  const packageSegment = segments[startIndex].startsWith("*")
    ? segments[startIndex].slice(1)
    : segments[startIndex];

  if (!packageSegment) {
    return null;
  }

  if (packageSegment.startsWith("@")) {
    if (segments.length <= startIndex + 1) {
      return null;
    }

    return extractVersionedPackage(segments[startIndex + 1], packageSegment);
  }

  return extractVersionedPackage(packageSegment);
};

export const parseSupportedPackageFromUrl = (value) => {
  const parsedUrl = tryParseUrl(value);

  if (!parsedUrl) {
    return null;
  }

  if (parsedUrl.hostname === "cdn.jsdelivr.net") {
    const parsedPackage = parseJsdelivrPackage(parsedUrl);

    return parsedPackage
      ? { ...parsedPackage, cdnFamily: "jsdelivr" }
      : {
          cdnFamily: "jsdelivr",
          currentVersion: null,
          packageName: null,
        };
  }

  if (parsedUrl.hostname === "esm.sh") {
    const parsedPackage = parseEsmShPackage(parsedUrl);

    return parsedPackage
      ? { ...parsedPackage, cdnFamily: "esm.sh" }
      : {
          cdnFamily: "esm.sh",
          currentVersion: null,
          packageName: null,
        };
  }

  return null;
};

export const parseDependencyPins = (value) => {
  const parsedUrl = tryParseUrl(value);

  if (!parsedUrl || parsedUrl.hostname !== "esm.sh") {
    return [];
  }

  const dependencies = parsedUrl.searchParams.get("deps");

  if (!dependencies) {
    return [];
  }

  return dependencies
    .split(",")
    .map((dependency) => dependency.trim())
    .filter(Boolean)
    .map((dependency) => {
      if (dependency.startsWith("@")) {
        const slashIndex = dependency.indexOf("/");

        if (slashIndex === -1) {
          return null;
        }

        return extractVersionedPackage(
          dependency.slice(slashIndex + 1),
          dependency.slice(0, slashIndex),
        );
      }

      return extractVersionedPackage(dependency);
    });
};

export const buildCdnSpec = (cdnFamily, specifier) => {
  return specifier ? `${cdnFamily}@${specifier}` : cdnFamily;
};

export const formatSourceLabel = (occurrence) => {
  return `${occurrence.key} (${buildCdnSpec(
    occurrence.cdnFamily,
    occurrence.specifier,
  )})`;
};
