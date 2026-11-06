import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The mod's JSX compiles to h(...): any binding named `h` hides it and every element after it throws
// ("h is not a function"). It happened twice; this keeps it from a third.
test("the chat mod never binds a name `h`", () => {
  const src = readFileSync(new URL("../hooks/register.tsx", import.meta.url), "utf8");
  const bindings = src
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\b(const|let|var|function)\b[^=;]*\bh\b/.test(line) || /\(\s*h\s*[,)]/.test(line));
  assert.deepEqual(bindings, []);
});
