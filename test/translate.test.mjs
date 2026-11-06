import { test } from "node:test";
import assert from "node:assert/strict";
import { toEnglish } from "../src/translate.mjs";

test("Italian reaction searches become English, unknown words pass through", () => {
  assert.equal(toEnglish("gatto che applaude"), "cat applause"); // 0 GIPHY results in Italian, 6 in English
  assert.equal(toEnglish("bravo"), "well done");
  assert.equal(toEnglish("mind blown"), "mind blown");
  assert.equal(toEnglish("finito il deploy"), "done deploy");
});
