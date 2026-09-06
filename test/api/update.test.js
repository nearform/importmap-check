import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { update } from "../../src/index.js";
import { createFixtureRegistry } from "../helpers/cli.js";
import { packument, startMockRegistry } from "../helpers/mock-registry.js";

// Layer-2 contract tests for the `update` verb: it computes the plan, writes the
// target file, and returns the post-rewrite summary plus structured data.

const { cleanup, createFixtureDir } = createFixtureRegistry();

let registry;

before(async () => {
  registry = await startMockRegistry({
    react: packument("react", { latest: "19.3.0" }),
  });
});

after(async () => {
  await cleanup();
  await registry.close();
});

const writeImportMap = async (contents) => {
  const dir = await createFixtureDir();
  const file = path.join(dir, "import-map.json");
  await writeFile(file, `${JSON.stringify(contents, null, 2)}\n`);

  return file;
};

const runUpdate = (file) =>
  update(file, { colorEnabled: false, registryBaseUrl: registry.url });

test("rewrites the target file and summarizes the change", async () => {
  const file = await writeImportMap({
    imports: { react: "https://esm.sh/react@19.2.3" },
  });

  const { data, output } = await runUpdate(file);

  assert.equal(data.plan.noChanges, false);
  assert.ok(data.plan.rewrites.some((r) => r.packageName === "react"));

  assert.match(output, /Updated /);
  assert.match(output, /react[^\n]*19\.2\.3 → 19\.3\.0/);

  // The on-disk URL is rewritten (core semantics — asserted exactly).
  const onDisk = await readFile(file, "utf8");
  assert.match(onDisk, /https:\/\/esm\.sh\/react@19\.3\.0/);
  assert.doesNotMatch(onDisk, /react@19\.2\.3/);
});

test("writes nothing and reports when there is nothing to update", async () => {
  const file = await writeImportMap({
    imports: { react: "https://esm.sh/react@19.3.0" },
  });
  const before = await readFile(file, "utf8");

  const { data, output } = await runUpdate(file);

  assert.equal(data.plan.noChanges, true);
  assert.match(output, /No changes to write/i);
  assert.equal(await readFile(file, "utf8"), before);
});

test("strips integrity entries tied to a rewritten URL", async () => {
  const file = await writeImportMap({
    imports: { react: "https://esm.sh/react@19.2.3" },
    integrity: { "https://esm.sh/react@19.2.3": "sha384-fake" },
  });

  const { data, output } = await runUpdate(file);

  assert.ok(data.plan.strippedIntegrityEntries.length >= 1);
  assert.match(output, /## Stripped integrity entries/);

  const onDisk = await readFile(file, "utf8");
  assert.match(onDisk, /https:\/\/esm\.sh\/react@19\.3\.0/);
  // The stale integrity key for the old URL is gone.
  assert.doesNotMatch(onDisk, /react@19\.2\.3/);
});

test("leaves URL-style keys untouched even when the value is rewritten", async () => {
  // Remap-style URL keys with their own pinned versions are intentional:
  // they name an exact import specifier and let the value float. The rewriter
  // must rewrite only the value side and never touch the URL key bytes.
  const file = await writeImportMap({
    imports: {
      "https://esm.sh/react@19.1.0/": "https://esm.sh/react@19.2.3",
    },
  });

  const { data } = await runUpdate(file);

  assert.equal(data.plan.noChanges, false);

  const expected = `${JSON.stringify(
    {
      imports: {
        "https://esm.sh/react@19.1.0/": "https://esm.sh/react@19.3.0",
      },
    },
    null,
    2,
  )}\n`;

  assert.strictEqual(await readFile(file, "utf8"), expected);
});
