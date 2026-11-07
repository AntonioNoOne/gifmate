import { test } from "node:test";
import assert from "node:assert/strict";
import { GifReader, GifWriter } from "omggif";
import { withCover } from "../src/gif.mjs";

// a 3-frame 2x1 GIF: black, red, blue
function sample() {
  const buf = new Uint8Array(4096);
  const w = new GifWriter(buf, 2, 1, { palette: [0x000000, 0xff0000, 0x0000ff, 0xffffff], loop: 0 });
  for (const c of [0, 1, 2]) w.addFrame(0, 0, 2, 1, new Uint8Array([c, c]), { delay: 10 });
  return buf.slice(0, w.end());
}

const pixel = (reader, i) => {
  const rgba = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(i, rgba);
  return [...rgba.subarray(0, 3)];
};

test("the middle frame comes first, the animation after it is unchanged", () => {
  const out = new GifReader(new Uint8Array(withCover(sample())));
  assert.equal(out.numFrames(), 4);
  assert.deepEqual(pixel(out, 0), [255, 0, 0]); // red, the middle frame
  assert.equal(out.frameInfo(0).delay, 2);
  assert.deepEqual([1, 2, 3].map((i) => pixel(out, i)), [[0, 0, 0], [255, 0, 0], [0, 0, 255]]);
  assert.equal(out.loopCount(), 0);
});
