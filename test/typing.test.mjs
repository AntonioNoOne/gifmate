import { test } from "node:test";
import assert from "node:assert/strict";
import { searchesFor, waitAfterTyping } from "../mod/typing.ts";

// Keystrokes for a word typed at a steady pace, as [time, text so far].
const typed = (word, gap, start = 0) => [...word].map((_, i) => [start + i * gap, word.slice(0, i + 1)]);

test("one search per word, whatever the typing pace", () => {
  for (const gap of [90, 180, 300, 450, 650]) {
    assert.deepEqual(searchesFor(typed("applause", gap)), ["applause"], `a letter every ${gap} ms`);
  }
});

test("a phrase typed with a pause between words searches the words so far, not every letter", () => {
  const keys = [...typed("cat", 200), ...typed("cat applause", 200, 2000).slice(3)];
  const searched = searchesFor(keys);
  assert.ok(searched.length <= 2, searched.join(" | "));
  assert.equal(searched.at(-1), "cat applause");
});

test("the wait follows the pace, within bounds", () => {
  assert.equal(waitAfterTyping([]), 500);
  assert.equal(waitAfterTyping([100, 100, 100]), 500); // fast: the floor
  assert.equal(waitAfterTyping([400, 400, 400]), 800);
  assert.equal(waitAfterTyping([1200, 1200, 1200]), 1500); // very slow: the ceiling
});
