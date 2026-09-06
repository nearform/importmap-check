import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";

import { createFixtureRegistry, runCli } from "../helpers/cli.js";

const { cleanup, copyFixture, createFixtureDir } = createFixtureRegistry();

after(cleanup);

test("--update rewrites pinned entries and prints the post-rewrite summary", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  const original = await readFile(targetPath, "utf8");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(`^Updated ${targetPath}:`));
  assert.match(result.stdout, /react\s+19\.2\.3 → 19\.3\.0/);
  assert.match(result.stdout, /react-dom\s+19\.2\.3 → 19\.3\.0/);

  const rewritten = await readFile(targetPath, "utf8");
  assert.notEqual(rewritten, original);
  assert.match(rewritten, /"react": "https:\/\/esm\.sh\/react@19\.3\.0"/);
  assert.match(
    rewritten,
    /"react-dom\/client": "https:\/\/esm\.sh\/react-dom@19\.3\.0\/client"/,
  );
});

test("-u short form matches --update long form", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  const result = await runCli(["-u", targetPath], { env: { NO_COLOR: "1" } });

  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(`^Updated ${targetPath}:`));
  const rewritten = await readFile(targetPath, "utf8");
  assert.match(rewritten, /"react": "https:\/\/esm\.sh\/react@19\.3\.0"/);
});

test("--update on ranges lifts caret/tilde floors per the design matrix", async () => {
  const targetPath = await copyFixture("update-ranges.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "20.0.0",
        "react-dom": "19.3.0",
        swr: "3.0.0",
      },
      specifiers: {
        "react@^19.2.3": "19.2.9",
        "react-dom@~19.2.3": "19.2.9",
        "swr@^2.0.0": "2.9.9",
      },
    },
  });

  assert.equal(result.code, 0);
  // Cross-major caret: ^19.2.3 with latest 20.0.0 → ^20.0.0
  assert.match(result.stdout, /react\s+\^19\.2\.3\s+\^19\.2\.3 → \^20\.0\.0/);
  // Cross-minor tilde within same major: ~19.2.3 with latest 19.3.0 → ~19.3.0
  assert.match(result.stdout, /react-dom\s+~19\.2\.3\s+~19\.2\.3 → ~19\.3\.0/);
  // Cross-major caret for swr
  assert.match(result.stdout, /swr\s+\^2\.0\.0\s+\^2\.0\.0 → \^3\.0\.0/);

  const rewritten = await readFile(targetPath, "utf8");
  assert.match(rewritten, /esm\.sh\/react@\^20\.0\.0/);
  assert.match(rewritten, /esm\.sh\/react-dom@~19\.3\.0/);
  assert.match(rewritten, /esm\.sh\/react-dom@~19\.3\.0\/client/);
  assert.match(rewritten, /esm\.sh\/swr@\^3\.0\.0/);
});

test("--update on 0.0.x ranges follows the patch-locked semantics", async () => {
  const targetPath = await copyFixture("update-ranges-0.0.x.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        "lib-a": "0.3.0",
        "lib-b": "0.3.0",
        "lib-c": "0.0.5",
        "lib-d": "0.0.5",
      },
      specifiers: {
        "lib-a@^0.2.3": "0.2.9",
        "lib-b@~0.2.3": "0.2.9",
        "lib-c@^0.0.3": "0.0.3",
        "lib-d@~0.0.3": "0.0.3",
      },
    },
  });

  assert.equal(result.code, 0);
  // ^0.2.3 with latest 0.3.0 → ^0.3.0 (cross-minor within 0.x)
  assert.match(result.stdout, /lib-a\s+\^0\.2\.3\s+\^0\.2\.3 → \^0\.3\.0/);
  // ~0.2.3 with latest 0.3.0 → ~0.3.0
  assert.match(result.stdout, /lib-b\s+~0\.2\.3\s+~0\.2\.3 → ~0\.3\.0/);
  // ^0.0.3 with latest 0.0.5 → ^0.0.5 (within-0.0.x lift)
  assert.match(result.stdout, /lib-c\s+\^0\.0\.3\s+\^0\.0\.3 → \^0\.0\.5/);
  // ~0.0.3 with latest 0.0.5 → ~0.0.5 (npm quirk)
  assert.match(result.stdout, /lib-d\s+~0\.0\.3\s+~0\.0\.3 → ~0\.0\.5/);

  const rewritten = await readFile(targetPath, "utf8");
  assert.match(rewritten, /lib-a@\^0\.3\.0/);
  assert.match(rewritten, /lib-b@~0\.3\.0/);
  assert.match(rewritten, /lib-c@\^0\.0\.5/);
  assert.match(rewritten, /lib-d@~0\.0\.5/);
});

test("--update on 0.0.x promotes to minor-locked when latest crosses to 0.1.x", async () => {
  const targetPath = await copyFixture("update-ranges-0.0.x.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        "lib-a": "0.3.0",
        "lib-b": "0.3.0",
        "lib-c": "0.1.0",
        "lib-d": "0.1.0",
      },
      specifiers: {
        "lib-a@^0.2.3": "0.2.9",
        "lib-b@~0.2.3": "0.2.9",
        "lib-c@^0.0.3": "0.0.3",
        "lib-d@~0.0.3": "0.0.3",
      },
    },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /lib-c\s+\^0\.0\.3\s+\^0\.0\.3 → \^0\.1\.0/);
  assert.match(result.stdout, /lib-d\s+~0\.0\.3\s+~0\.0\.3 → ~0\.1\.0/);
});

test("--update on 0.0.x falls through to major-locked when latest crosses to 1.0.0", async () => {
  const targetPath = await copyFixture("update-ranges-0.0.x.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        "lib-a": "1.0.0",
        "lib-b": "1.0.0",
        "lib-c": "1.0.0",
        "lib-d": "1.0.0",
      },
      specifiers: {
        "lib-a@^0.2.3": "0.2.9",
        "lib-b@~0.2.3": "0.2.9",
        "lib-c@^0.0.3": "0.0.3",
        "lib-d@~0.0.3": "0.0.3",
      },
    },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /lib-a\s+\^0\.2\.3\s+\^0\.2\.3 → \^1\.0\.0/);
  assert.match(result.stdout, /lib-b\s+~0\.2\.3\s+~0\.2\.3 → ~1\.0\.0/);
  assert.match(result.stdout, /lib-c\s+\^0\.0\.3\s+\^0\.0\.3 → \^1\.0\.0/);
  assert.match(result.stdout, /lib-d\s+~0\.0\.3\s+~0\.0\.3 → ~1\.0\.0/);
});

test("--update rewrites major-only and minor-only selectors", async () => {
  const targetPath = await copyFixture("update-selectors.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "19.3.0",
        "react-dom": "19.3.0",
      },
      specifiers: {
        "react@18": "18.3.1",
        "react-dom@18.3": "18.3.1",
      },
    },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /react\s+18\s+18 → 19/);
  assert.match(result.stdout, /react-dom\s+18\.3\s+18\.3 → 19\.3/);

  const rewritten = await readFile(targetPath, "utf8");
  assert.match(rewritten, /"react": "https:\/\/esm\.sh\/react@19"/);
  assert.match(
    rewritten,
    /"react-dom\/client": "https:\/\/esm\.sh\/react-dom@19\.3\/client"/,
  );
});

test("--update does not rewrite dist-tag entries and leaves the file unchanged", async () => {
  const targetPath = await copyFixture("update-dist-tags.html");
  const original = await readFile(targetPath, "utf8");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "19.3.0",
        "react-dom": "19.3.0",
      },
      specifiers: {
        "react@beta": "19.4.0-beta.1",
        "react-dom@latest": "19.3.0",
      },
    },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /No changes to write\./);
  const after = await readFile(targetPath, "utf8");
  assert.equal(after, original);
});

test("--update strips integrity entries for rewritten URLs and preserves unrewritten ones", async () => {
  const targetPath = await copyFixture("update-integrity.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "19.3.0",
        "react-dom": "19.3.0",
        untouched: "1.0.0",
      },
    },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /## Stripped integrity entries/);
  assert.match(
    result.stdout,
    /- https:\/\/esm\.sh\/react@19\.2\.3 \(triggered by react\)/,
  );
  assert.match(
    result.stdout,
    /- https:\/\/esm\.sh\/react-dom@19\.2\.3\/client \(triggered by react-dom\)/,
  );

  const rewritten = await readFile(targetPath, "utf8");
  // Stripped keys are gone.
  assert.doesNotMatch(rewritten, /https:\/\/esm\.sh\/react@19\.2\.3": "sha384/);
  assert.doesNotMatch(
    rewritten,
    /https:\/\/esm\.sh\/react-dom@19\.2\.3\/client": "sha384/,
  );
  // Untouched key remains.
  assert.match(
    rewritten,
    /"https:\/\/esm\.sh\/untouched@1\.0\.0": "sha384-keep"/,
  );
});

test("--update with no integrity section produces no stripped-integrity subsection", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /Stripped integrity entries/);
});

test("--update rewrites destination-skewed occurrences independently and preserves skew warning", async () => {
  const targetPath = await copyFixture("update-destination-skew.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "19.3.0",
        "react-dom": "19.3.0",
      },
    },
  });

  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /react resolves through different CDN providers or pinned versions/,
  );
  const rewritten = await readFile(targetPath, "utf8");
  // Both CDN occurrences of react are rewritten.
  assert.match(rewritten, /esm\.sh\/react@19\.3\.0/);
  assert.match(rewritten, /cdn\.jsdelivr\.net\/npm\/react@19\.3\.0\/\+esm/);
});

test("--update preserves URL-style keys pinned to specific versions and only rewrites values", async () => {
  // URL keys with their own pinned versions are an intentional remap shape —
  // they pin one specific version as the entry name and let the value float
  // to whatever the CDN resolves. --update must keep the URL key byte-for-byte
  // and only rewrite the value side, even when multiple keys skew the same
  // package (react@19.0.0 and react@19.1.0 here both pointing at react@19.2.3).
  const targetPath = await copyFixture("update-url-key-skew.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "19.3.0",
        "react-dom": "19.3.0",
      },
    },
  });

  assert.equal(result.code, 0);

  const expected = `<!doctype html>
<html>
  <body>
    <script type="importmap">
      {
        "imports": {
          "https://cdn.jsdelivr.net/npm/react@19.0.0/": "https://cdn.jsdelivr.net/npm/react@19.3.0/",
          "https://cdn.jsdelivr.net/npm/react@19.1.0/": "https://cdn.jsdelivr.net/npm/react@19.3.0/",
          "https://cdn.jsdelivr.net/npm/react-dom@19.1.0/": "https://cdn.jsdelivr.net/npm/react-dom@19.3.0/"
        }
      }
    </script>
  </body>
</html>
`;

  assert.strictEqual(await readFile(targetPath, "utf8"), expected);
});

test("--update preserves URL-style keys even when they share bytes with the rewritten value", async () => {
  // Edge case: the key and value are byte-identical. The rewriter must still
  // leave the key side alone and only lift the value to the new latest.
  const dir = await createFixtureDir();
  const targetPath = path.join(dir, "url-key-same.html");
  const original = `<!doctype html>
<html>
  <body>
    <script type="importmap">
      {
        "imports": {
          "https://esm.sh/react@19.2.3": "https://esm.sh/react@19.2.3"
        }
      }
    </script>
  </body>
</html>
`;

  await writeFile(targetPath, original);

  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);

  const expected = `<!doctype html>
<html>
  <body>
    <script type="importmap">
      {
        "imports": {
          "https://esm.sh/react@19.2.3": "https://esm.sh/react@19.3.0"
        }
      }
    </script>
  </body>
</html>
`;

  // Key stays at 19.2.3; only the value side is rewritten.
  assert.strictEqual(await readFile(targetPath, "utf8"), expected);
});

test("--update on a no-op fixture prints No changes to write and leaves the file unchanged", async () => {
  const targetPath = await copyFixture("update-noop.html");
  const original = await readFile(targetPath, "utf8");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^No changes to write\.\s*$/);
  const after = await readFile(targetPath, "utf8");
  assert.equal(after, original);
});

test("--update is idempotent — second invocation is a no-op", async () => {
  const targetPath = await copyFixture("update-ranges.html");
  const firstOptions = {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "20.0.0",
        "react-dom": "19.3.0",
        swr: "3.0.0",
      },
      specifiers: {
        "react@^19.2.3": "19.2.9",
        "react-dom@~19.2.3": "19.2.9",
        "swr@^2.0.0": "2.9.9",
      },
    },
  };

  const first = await runCli(["--update", targetPath], firstOptions);
  assert.equal(first.code, 0);
  assert.match(first.stdout, /→/);

  // Second invocation with matching overrides: the newly written ranges must
  // resolve to the same latest, so no further rewrite occurs. Cross-minor
  // tilde case: ~19.3.0 must stabilize.
  const secondOptions = {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        react: "20.0.0",
        "react-dom": "19.3.0",
        swr: "3.0.0",
      },
      specifiers: {
        "react@^20.0.0": "20.0.0",
        "react-dom@~19.3.0": "19.3.0",
        "swr@^3.0.0": "3.0.0",
      },
    },
  };
  const second = await runCli(["--update", targetPath], secondOptions);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /^No changes to write\./);
});

test("--update --sources combines the update path with the sources rendering", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  const result = await runCli(["--update", "--sources", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Updated /);
  assert.match(result.stdout, /react\s+19\.2\.3 → 19\.3\.0/);
});

test("--update rewrites a standalone JSON import map preserving formatting", async () => {
  const targetPath = await copyFixture("update-pinned.json");
  const original = await readFile(targetPath, "utf8");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(`^Updated ${targetPath}:`));

  const rewritten = await readFile(targetPath, "utf8");
  assert.notEqual(rewritten, original);
  assert.match(rewritten, /"react": "https:\/\/esm\.sh\/react@19\.3\.0"/);
  assert.match(
    rewritten,
    /"react-dom\/client": "https:\/\/esm\.sh\/react-dom@19\.3\.0\/client"/,
  );
  // Preserve original indentation (two spaces).
  const originalIndent = original.match(/\n( +)"react"/)[1];
  const rewrittenIndent = rewritten.match(/\n( +)"react"/)[1];
  assert.equal(rewrittenIndent, originalIndent);
});

test("--update does not rewrite URL substrings outside their import map value", async () => {
  const fixtureDir = await createFixtureDir();
  const targetPath = path.join(fixtureDir, "index.html");
  // The comment carries the same URL string as the import map value. Only the
  // import map value should be rewritten; the comment must be left untouched.
  await writeFile(
    targetPath,
    [
      "<!doctype html>",
      "<html><body>",
      "<!-- Reference: https://esm.sh/react@19.2.3 (do not edit here) -->",
      '<script type="importmap">',
      JSON.stringify(
        {
          imports: {
            react: "https://esm.sh/react@19.2.3",
          },
        },
        null,
        2,
      ),
      "</script>",
      "</body></html>",
    ].join("\n"),
  );

  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");
  // The value inside quotes IS rewritten (whole-value boundary).
  assert.match(rewritten, /"react": "https:\/\/esm\.sh\/react@19\.3\.0"/);
  // The bare comment URL is also rewritten because the current implementation
  // performs quoted-value substitution; document actual behavior — the
  // rewriter targets only quoted substrings.
  assert.match(
    rewritten,
    /<!-- Reference: https:\/\/esm\.sh\/react@19\.2\.3 \(do not edit here\) -->/,
  );
});

test("--update does not collide across substring URLs of different length", async () => {
  const fixtureDir = await createFixtureDir();
  const targetPath = path.join(fixtureDir, "index.html");
  // Two entries where one URL is a proper substring of the other's version
  // token. The rewriter must not accidentally rewrite the longer URL when
  // targeting the shorter one.
  await writeFile(
    targetPath,
    [
      '<!doctype html><html><body><script type="importmap">',
      JSON.stringify(
        {
          imports: {
            "react-selector": "https://esm.sh/react@18",
            "react-pinned": "https://esm.sh/react@18.3.1",
          },
        },
        null,
        2,
      ),
      "</script></body></html>",
    ].join("\n"),
  );

  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: { react: "19.3.0" },
      specifiers: { "react@18": "18.3.1" },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");
  // The selector entry rewrites to react@19 (major-only).
  assert.match(rewritten, /"react-selector": "https:\/\/esm\.sh\/react@19"/);
  // The pinned entry rewrites to react@19.3.0.
  assert.match(
    rewritten,
    /"react-pinned": "https:\/\/esm\.sh\/react@19\.3\.0"/,
  );
});

test("--update preserves the target file's mode bits", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  // Set a distinctive mode: 0o640 (owner read/write, group read, other none).
  await chmod(targetPath, 0o640);

  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
  });
  assert.equal(result.code, 0);

  const stats = await stat(targetPath);
  assert.equal(stats.mode & 0o777, 0o640);
});

test("--update against a read-only target file returns non-zero and leaves the file unchanged", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  const original = await readFile(targetPath, "utf8");
  // Make the containing directory read-only so rename fails with EACCES.
  const dir = path.dirname(targetPath);
  const dirStats = await stat(dir);

  await chmod(dir, 0o555);
  try {
    const result = await runCli(["--update", targetPath], {
      env: { NO_COLOR: "1" },
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Failed to write update/);
    const afterContent = await readFile(targetPath, "utf8");
    assert.equal(afterContent, original);
  } finally {
    await chmod(dir, dirStats.mode);
  }
});

test("--update does not leave temp files behind on write failure", async () => {
  const targetPath = await copyFixture("update-pinned.html");
  const dir = path.dirname(targetPath);
  const dirStats = await stat(dir);

  await chmod(dir, 0o555);
  try {
    await runCli(["--update", targetPath], { env: { NO_COLOR: "1" } });
    const { readdir } = await import("node:fs/promises");
    const remaining = await readdir(dir);
    const tempFiles = remaining.filter((name) =>
      name.includes(".importmap-check-"),
    );
    assert.equal(tempFiles.length, 0, `unexpected temp files: ${tempFiles}`);
  } finally {
    await chmod(dir, dirStats.mode);
  }
});

test("--update rewrites both the outer package and its `?deps=` pin on the same URL", async () => {
  // The outer `@` search stays scoped to the path portion (before `?`), so the
  // outer version and the `?deps=<pkg>@<ver>` pin are rewritten independently
  // and coalesced into a single edit per URL — neither overwrites the other.
  const targetPath = await copyFixture("update-deps-query.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        "broadcast-channel": "7.0.0",
        history: "6.0.0",
        react: "19.2.7",
      },
      specifiers: {
        "broadcast-channel@^4.17.0": "4.17.0",
        "history@^5.3.0": "5.3.0",
      },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");

  // Outer package version and its dep pin both rewrite in-place on one URL.
  assert.match(
    rewritten,
    /"broadcast-channel": "https:\/\/esm\.sh\/broadcast-channel@\^7\.0\.0\?deps=react@19\.2\.7"/,
  );
  assert.match(
    rewritten,
    /"history": "https:\/\/esm\.sh\/history@\^6\.0\.0\?deps=react@19\.2\.7"/,
  );
  // The standalone outer react entry rewrites normally.
  assert.match(rewritten, /"react": "https:\/\/esm\.sh\/react@19\.2\.7"/);

  // No stale `react@18.2.0` dep pin remains anywhere.
  assert.doesNotMatch(rewritten, /react@18\.2\.0/);
  // The outer `@` slot is never corrupted by the dep pin's value.
  assert.doesNotMatch(rewritten, /\?deps=react@\^7\.0\.0/);
});

test("--update coalesces an outer bump with multiple `?deps=` pins on one URL", async () => {
  const targetPath = await copyFixture("update-deps-multi.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        app: "2.0.0",
        react: "19.3.0",
        scheduler: "0.24.1",
      },
      specifiers: {
        "scheduler@^0.23.0": "0.23.0",
      },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");

  // Outer pinned bump, pinned dep bump, and caret-range dep lift all land in a
  // single rewritten URL, preserving dep order and separators.
  assert.match(
    rewritten,
    /"app": "https:\/\/esm\.sh\/app@2\.0\.0\?deps=react@19\.3\.0,scheduler@\^0\.24\.0"/,
  );
});

test("--update applies only the changed edits when a shared URL has partial updates", async () => {
  const targetPath = await copyFixture("update-deps-multi.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        app: "1.0.0",
        react: "19.3.0",
        scheduler: "0.23.0",
      },
      specifiers: {
        "scheduler@^0.23.0": "0.23.0",
      },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");

  // Outer `app` (no update) and `scheduler` (no update) are preserved; only the
  // `react` dep pin changes within the shared URL.
  assert.match(
    rewritten,
    /"app": "https:\/\/esm\.sh\/app@1\.0\.0\?deps=react@19\.3\.0,scheduler@\^0\.23\.0"/,
  );
});

test("--update rewrites a scoped `?deps=` pin end-to-end, preserving the scope", async () => {
  const targetPath = await copyFixture("update-deps-scoped.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        app: "1.0.0",
        "@scope/pkg": "2.0.0",
      },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");

  assert.match(
    rewritten,
    /"app": "https:\/\/esm\.sh\/app@1\.0\.0\?deps=@scope\/pkg@2\.0\.0"/,
  );
});

test("--update does not rewrite a dist-tag `?deps=` pin while bumping the outer package", async () => {
  const targetPath = await copyFixture("update-deps-dist-tag.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: { app: "2.0.0", react: "19.3.0" },
      specifiers: {
        "react@beta": "19.4.0-beta.1",
      },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");

  // Outer `app` rewrites; the floating `react@beta` dep pin is left untouched.
  assert.match(
    rewritten,
    /"app": "https:\/\/esm\.sh\/app@2\.0\.0\?deps=react@beta"/,
  );
});

test("--update strips integrity when only a `?deps=` pin changes the URL", async () => {
  const targetPath = await copyFixture("update-deps-integrity.html");
  const result = await runCli(["--update", targetPath], {
    env: { NO_COLOR: "1" },
    registry: {
      latest: { lib: "1.0.0", react: "19.3.0" },
    },
  });

  assert.equal(result.code, 0);
  const rewritten = await readFile(targetPath, "utf8");

  // The dep pin changes the URL bytes, so its integrity hash is stripped.
  assert.match(rewritten, /\?deps=react@19\.3\.0/);
  assert.doesNotMatch(rewritten, /sha384-deps/);
  assert.match(result.stdout, /## Stripped integrity entries/);
  assert.match(result.stdout, /triggered by react/);
});

test("--update on `?deps=` pins is idempotent", async () => {
  const targetPath = await copyFixture("update-deps-multi.html");
  const options = {
    env: { NO_COLOR: "1" },
    registry: {
      latest: {
        app: "2.0.0",
        react: "19.3.0",
        scheduler: "0.24.1",
      },
      specifiers: {
        "scheduler@^0.23.0": "0.23.0",
        "scheduler@^0.24.0": "0.24.1",
      },
    },
  };

  const first = await runCli(["--update", targetPath], options);
  assert.equal(first.code, 0);

  const second = await runCli(["--update", targetPath], options);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /No changes to write\./);
});
