import { test } from "node:test";
import assert from "node:assert/strict";
import { GifWriter } from "omggif";
import { PNG } from "pngjs";
import { framesOf, pickIndexes } from "../src/gif.mjs";

// 40x20 GIF, 10 frames of 0.2 s: a 4x4 square moves right, red for 5 frames then blue.
function movingSquare() {
  const w = 40, h = 20;
  const buf = new Uint8Array(4096);
  const gw = new GifWriter(buf, w, h, { loop: 0, palette: [0xffffff, 0xff0000, 0x0000ff, 0x000000] });
  for (let f = 0; f < 10; f++) {
    const px = new Uint8Array(w * h);
    for (let y = 8; y < 12; y++) for (let x = f * 4; x < f * 4 + 4; x++) px[y * w + x] = f < 5 ? 1 : 2;
    gw.addFrame(0, 0, w, h, px, { delay: 20 });
  }
  return buf.subarray(0, gw.end());
}

const pixel = (frame, x, y) => {
  const png = PNG.sync.read(Buffer.from(frame.base64, "base64"));
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

test("returns spaced frames that show the motion and the colour change", () => {
  const gif = framesOf(movingSquare(), { maxFrames: 4 });
  assert.equal(gif.totalFrames, 10);
  assert.equal(gif.duration.toFixed(1), "2.0");
  assert.deepEqual(gif.frames.map((f) => f.index), [0, 3, 6, 9]);
  assert.deepEqual(pixel(gif.frames[0], 1, 9), [255, 0, 0]); // red, left
  assert.deepEqual(pixel(gif.frames[3], 37, 9), [0, 0, 255]); // blue, right
  assert.deepEqual(pixel(gif.frames[3], 1, 9), [255, 255, 255]); // it moved away
});

test("short GIFs come back whole", () => {
  assert.deepEqual(pickIndexes([0, 0.1, 0.2], 12), [0, 1, 2]);
});
