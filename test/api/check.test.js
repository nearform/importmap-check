import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../src/index.js";
import { fixturesRoot } from "../helpers/cli.js";
import { packument, startMockRegistry } from "../helpers/mock-registry.js";

// Layer-2 contract tests for the `check` verb: assert on the returned
// { output, data } semantically (values, section presence, source handling) —
// not on exact table spacing, which the reporting spec calls a non-goal.

const fixture = (name) => path.join(fixturesRoot, name);

let registry;

before(async () => {
  registry = await startMockRegistry({
    react: packument("react", { latest: "19.3.0" }),
    "react-dom": packument("react-dom", { latest: "19.3.0" }),
  });
});

after(async () => {
  await registry.close();
});

const runCheck = (name, options = {}) =>
  check(fixture(name), {
    colorEnabled: false,
    registryBaseUrl: registry.url,
    ...options,
  });

test("returns structured data for an updateable package", async () => {
  const { data } = await runCheck("inline-importmap.html");
  const react = data.packageResults.find((r) => r.packageName === "react");

  assert.deepEqual(react.resolvedVersions, ["19.2.3"]);
  assert.equal(react.latestVersion, "19.3.0");
  assert.equal(react.hasUpdate, true);
  assert.equal(react.severity, "minor");
  assert.deepEqual(react.specifiers, []);
});

test("renders an Updates section with a package/resolved/latest row", async () => {
  const { output } = await runCheck("inline-importmap.html");

  assert.match(output, /## Updates/);
  assert.match(output, /Package[^\n]*Resolved[^\n]*Latest/);
  assert.match(output, /react[^\n]*19\.2\.3[^\n]*19\.3\.0/);
  assert.match(output, /react-dom[^\n]*19\.2\.3[^\n]*19\.3\.0/);
});

test("omits the Source column by default and includes it with sources", async () => {
  const withoutSources = await runCheck("inline-importmap.html");

  assert.doesNotMatch(withoutSources.output, /Source/);
  for (const result of withoutSources.data.packageResults) {
    assert.equal(result.sources, undefined);
  }

  const withSources = await runCheck("inline-importmap.html", {
    sources: true,
    width: 200,
  });

  assert.match(
    withSources.output,
    /Package[^\n]*Resolved[^\n]*Latest[^\n]*Source/,
  );
  assert.match(withSources.output, /react[^\n]*react \(jsdelivr\)/);
  const react = withSources.data.packageResults.find(
    (r) => r.packageName === "react",
  );
  assert.ok(Array.isArray(react.sources) && react.sources.length >= 1);
});

test("deduplicates and sorts sources across import maps", async () => {
  const { data } = await runCheck("duplicate-sources.html", { sources: true });
  const react = data.packageResults.find((r) => r.packageName === "react");

  assert.equal(react.sources.length, 1);
  assert.equal(react.sources[0].label, "react (esm.sh)");

  const scoped = await runCheck("scopes-and-remaps.html", { sources: true });
  const scopedReact = scoped.data.packageResults.find(
    (r) => r.packageName === "react",
  );

  assert.deepEqual(
    scopedReact.sources.map((s) => s.label),
    [
      "./vendor/react.js (esm.sh)",
      "https://cdn.jsdelivr.net/npm/react@19.0.0/ (jsdelivr)",
      "react/ (jsdelivr)",
    ],
  );
});

test("wraps overflowing sources onto multiple lines (behavior, not exact indent)", async () => {
  const { output } = await runCheck("scopes-and-remaps.html", {
    sources: true,
    width: 60,
  });

  // At a narrow width the three react sources cannot sit on one comma-joined
  // line, so each renders on its own line. We assert the wrapping behavior, not
  // any exact indentation or column width.
  const sourceLines = output
    .split("\n")
    .filter((line) => /\((esm\.sh|jsdelivr)\)/.test(line));

  assert.ok(
    sourceLines.length >= 2,
    `expected sources to wrap onto multiple lines, got ${sourceLines.length}`,
  );
});

test("reports up-to-date packages in the Current section", async () => {
  // scopes-and-remaps pins react at 19.1.0 / 19.2.3; a matching latest keeps it
  // out of Updates. Use a dedicated registry so `latest` equals the pin.
  const currentRegistry = await startMockRegistry({
    react: packument("react", { latest: "19.2.3" }),
  });

  try {
    const { data, output } = await check(fixture("inline-importmap.html"), {
      colorEnabled: false,
      registryBaseUrl: currentRegistry.url,
    });
    const react = data.packageResults.find((r) => r.packageName === "react");

    assert.equal(react.hasUpdate, false);
    assert.match(output, /## Current/);
  } finally {
    await currentRegistry.close();
  }
});

test("strips esm.sh leading `*` (external-deps marker) when parsing packages", async () => {
  // esm.sh emits `*pkg@<version>` and `*@scope/pkg@<version>` URLs whose
  // leading `*` marks every dependency as external; the `*` is a URL-level
  // flag, not part of the package identity. Without the strip, the parser
  // would surface `*pkg` as the package name (and `*` for the scoped form)
  // and the registry lookup for `*` would 404.
  const starRegistry = await startMockRegistry({
    "preact-render-to-string": packument("preact-render-to-string", {
      latest: "5.2.0",
    }),
    "@nearform/simple-firebase-auth-frontend": packument(
      "@nearform/simple-firebase-auth-frontend",
      { latest: "0.1.1" },
    ),
    react: packument("react", { latest: "19.3.0" }),
  });

  try {
    const { data, output } = await check(fixture("esm-sh-star-prefix.html"), {
      colorEnabled: false,
      registryBaseUrl: starRegistry.url,
    });

    const preact = data.packageResults.find(
      (r) => r.packageName === "preact-render-to-string",
    );
    const nearform = data.packageResults.find(
      (r) => r.packageName === "@nearform/simple-firebase-auth-frontend",
    );
    const react = data.packageResults.find((r) => r.packageName === "react");

    assert.ok(preact, "expected preact-render-to-string in packageResults");
    assert.ok(nearform, "expected @nearform/simple-firebase-auth-frontend");
    assert.ok(react, "expected react in packageResults");
    assert.equal(preact.hasUpdate, false);
    assert.equal(nearform.hasUpdate, false);
    assert.equal(react.hasUpdate, true);

    // No `*` artifact should leak into any package name, and the registry
    // must not have been asked to resolve `*` (the original 404 trigger).
    for (const result of data.packageResults) {
      assert.ok(
        !result.packageName.includes("*"),
        `${result.packageName} unexpectedly contains '*'`,
      );
    }

    assert.doesNotMatch(output, /Could not resolve specifier "nearform"/);
    assert.doesNotMatch(output, /for package "\*"/);
    assert.doesNotMatch(output, /Could not parse package identity and version/);
  } finally {
    await starRegistry.close();
  }
});
