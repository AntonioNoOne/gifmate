// Turn an animated GIF into a few still frames an agent can look at.
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { GifReader, GifWriter } from "omggif";
import { PNG } from "pngjs";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096;

// A URL in a prompt may come from anyone: never let it reach this machine or its network.
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168)\./i];

async function assertPublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (host === "localhost" || addresses.some((a) => PRIVATE.some((re) => re.test(a)))) {
    throw new Error(`refused: ${url.hostname} is a local or private address`);
  }
}

async function download(source) {
  let url = new URL(source);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { headers: { "user-agent": "gifmate" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location"), url); // each redirect is checked too
      continue;
    }
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error("GIF larger than 20 MB");
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error("GIF larger than 20 MB");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("download failed: too many redirects");
}

export async function loadBytes(source) {
  if (/^https?:\/\//i.test(source)) return download(source);
  if ((await stat(source)).size > MAX_BYTES) throw new Error("GIF larger than 20 MB");
  return readFile(source);
}

// Every frame composited as a browser shows it (disposal methods honoured).
function* composite(reader) {
  const { width, height } = reader;
  let canvas = new Uint8ClampedArray(width * height * 4);
  let t = 0;
  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    const before = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    yield { index: i, time: t, rgba: canvas.slice() };
    t += (info.delay || 10) / 100; // delay is in hundredths of a second
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y++) {
        canvas.fill(0, (y * width + info.x) * 4, (y * width + info.x + info.width) * 4);
      }
    } else if (before) {
      canvas = before;
    }
  }
}

// Evenly spaced in time, first and last always included.
export function pickIndexes(times, count) {
  if (times.length <= count) return times.map((_, i) => i);
  const end = times[times.length - 1];
  const picked = new Set();
  for (let k = 0; k < count; k++) {
    const target = (end * k) / (count - 1);
    let best = 0;
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(times[i] - target) < Math.abs(times[best] - target)) best = i;
    }
    picked.add(best);
  }
  return [...picked].sort((a, b) => a - b);
}

// Nearest-neighbour downscale onto white (transparent pixels are not read as black).
function flatten(rgba, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const s = (sy * width + Math.min(width - 1, Math.floor(x / scale))) * 4;
      const d = (y * w + x) * 3;
      const a = rgba[s + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[d + c] = rgba[s + c] * a + 255 * (1 - a);
    }
  }
  return { w, h, rgb };
}

export function toPng(rgba, width, height, maxSide) {
  const { w, h, rgb } = flatten(rgba, width, height, maxSide);
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data.set(rgb.subarray(i * 3, i * 3 + 3), i * 4);
    png.data[i * 4 + 3] = 255;
  }
  return { mime: "image/png", base64: PNG.sync.write(png).toString("base64") };
}

// A one-frame GIF: far smaller than PNG for GIF content, which already fits 256 colours.
export function toGif(rgba, width, height, maxSide) {
  const { w, h, rgb } = flatten(rgba, width, height, maxSide);
  const key = (i) => (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
  let colours = new Map();
  for (let i = 0; i < rgb.length && colours.size <= 256; i += 3) colours.set(key(i), 0);
  // more than 256 colours: snap to a 6x7x6 cube
  const cube = colours.size > 256;
  const snap = (v, n) => Math.round((v / 255) * (n - 1)) * (255 / (n - 1));
  const palette = [];
  colours = new Map();
  const pixels = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 3;
    const c = cube ? (snap(rgb[i], 6) << 16) | (snap(rgb[i + 1], 7) << 8) | snap(rgb[i + 2], 6) : key(i);
    let idx = colours.get(c);
    if (idx === undefined) {
      idx = palette.length;
      colours.set(c, idx);
      palette.push(c);
    }
    pixels[p] = idx;
  }
  let size = 2;
  while (size < palette.length) size *= 2;
  while (palette.length < size) palette.push(0);
  const buf = new Uint8Array(w * h * 3 + 2048);
  const writer = new GifWriter(buf, w, h, { palette });
  writer.addFrame(0, 0, w, h, pixels);
  return { mime: "image/gif", base64: Buffer.from(buf.subarray(0, writer.end())).toString("base64") };
}

// An SVG that plays the GIF with SMIL, for chat panels that draw SVG as an image
// (an <img> does not animate a GIF nested inside an SVG). Fewer and smaller frames
// until it fits `budget` characters. The GIF is decoded once; the tries only re-encode.
export function animatedSvg(bytes, { budget = 120_000, maxSide = 320 } = {}) {
  const gif = keyFrames(bytes, 24);
  const dur = gif.duration || 1;
  // sharpness first: the biggest side that still fits at least 8 frames
  const tries = [];
  for (const side of [320, 280, 240, 200, 180, 160, 140, 120].filter((x) => x <= maxSide)) for (const count of [24, 16, 12, 8]) tries.push([count, side]);
  tries.push([6, 120], [4, 100], [2, 100], [4, 80], [2, 64]);
  for (const [count, side] of tries) {
    const frames = pickIndexes(gif.frames.map((f) => f.time), count).map((i) => gif.frames[i]);
    const scale = Math.min(1, side / Math.max(gif.width, gif.height));
    const w = Math.max(1, Math.round(gif.width * scale));
    const h = Math.max(1, Math.round(gif.height * scale));
    let size = 0;
    const images = [];
    for (let i = 0; i < frames.length && size <= budget; i++) {
      const { mime, base64 } = toGif(frames[i].rgba, gif.width, gif.height, side);
      const start = frames[i].time / dur;
      const end = i + 1 < frames.length ? frames[i + 1].time / dur : 1;
      const image =
        `<image width="${w}" height="${h}" visibility="hidden" href="data:${mime};base64,${base64}">` +
        `<animate attributeName="visibility" calcMode="discrete" values="hidden;visible;hidden;hidden" ` +
        `keyTimes="0;${start.toFixed(4)};${end.toFixed(4)};1" dur="${dur.toFixed(2)}s" repeatCount="indefinite"/></image>`;
      size += image.length;
      images.push(image);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${images.join("")}</svg>`;
    if (svg.length <= budget) return { svg, width: w, height: h, frames: frames.length };
  }
  throw new Error("GIF too large to animate inline");
}

// Decode once, composite in order, keep only `maxFrames` frames evenly spaced in time.
function keyFrames(bytes, maxFrames) {
  const reader = new GifReader(new Uint8Array(bytes));
  if (reader.width * reader.height > MAX_PIXELS) throw new Error("GIF too large (over 4096x4096)");
  const n = reader.numFrames();
  const times = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    times.push(t);
    t += (reader.frameInfo(i).delay || 10) / 100;
  }
  const keep = new Set(pickIndexes(times, maxFrames));
  const frames = [];
  for (const f of composite(reader)) if (keep.has(f.index)) frames.push(f);
  return { width: reader.width, height: reader.height, totalFrames: n, duration: t, frames };
}

export function framesOf(bytes, { maxFrames = 12, maxSide = 384, encode = toPng } = {}) {
  const gif = keyFrames(bytes, maxFrames);
  return {
    ...gif,
    frames: gif.frames.map((f) => ({ index: f.index, time: f.time, ...encode(f.rgba, gif.width, gif.height, maxSide) })),
  };
}
