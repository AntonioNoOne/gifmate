import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, loadBytes } from "../src/gif.mjs";

test("refuses URLs that point at this machine or its network", async () => {
  for (const url of ["http://127.0.0.1/a.gif", "http://localhost:8080/a.gif", "http://192.168.1.10/a.gif", "http://[::1]/a.gif", "http://[::ffff:172.16.0.1]/a.gif"]) {
    await assert.rejects(loadBytes(url), /local or private/, url);
  }
});

test("private and special addresses are recognised, public ones pass", () => {
  for (const a of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "169.254.1.1", "172.31.0.1", "192.168.0.1", "224.0.0.1", "::", "::1", "fd00::1", "fe80::1", "::ffff:169.254.0.1", "::ffff:ac10:1", "::ffff:7f00:1"]) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ["151.101.1.1", "8.8.8.8", "2606:4700::1111"]) assert.equal(isPrivateAddress(a), false, a);
});
