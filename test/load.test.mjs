import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBytes } from "../src/gif.mjs";

test("refuses URLs that point at this machine or its network", async () => {
  for (const url of ["http://127.0.0.1/a.gif", "http://localhost:8080/a.gif", "http://192.168.1.10/a.gif", "http://[::1]/a.gif"]) {
    await assert.rejects(loadBytes(url), /local or private/, url);
  }
});
