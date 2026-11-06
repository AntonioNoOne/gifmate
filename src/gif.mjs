// Turn an animated GIF into a few still frames an agent can look at.
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { GifReader, GifWriter } from "omggif";
import { PNG } from "pngjs";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096;
const MAX_FRAMES = 2000;
const MAX_WORK = 400_000_000; // frames × pixels: about 6 s of a 640×360 GIF at 30 fps is 41 M

// A URL in a prompt may come from anyone: never let it reach this machine or its network.
export function isPrivateAddress(address) {
  let a = address.toLowerCase();
  // IPv4 written as IPv6, dotted (::ffff:10.0.0.1) or as URL parsers print it (::ffff:a00:1)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (mapped) a = mapped[1];
  else if (hex) {
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    a = [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  if (isIP(a) === 4) {
    const [p, q] = a.split(".").map(Number);
    return (
      p === 0 || p === 10 || p === 127 || p >= 224 || // this host, private, loopback, multicast and reserved
      (p === 100 && q >= 64 && q <= 127) || // carrier-grade NAT
      (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) ||
      (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) // IETF and benchmark ranges
    );
  }
  return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || /^64:ff9b:/.test(a);
}

// GIPHY serves from a few hosts: one DNS lookup a minute each, not one per preview. The check runs inside
// the connection's own lookup, so the address checked is the address used (no DNS-rebinding window).
const resolved = new Map();
function safeLookup(host, options, callback) {
  const done = (addresses) => {
    const bad = addresses.find((x) => isPrivateAddress(x.address));
    if (bad || host === "localhost") return callback(new Error(`refused: ${host} is a local or private address`));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  };
  const hit = resolved.get(host);
  if (hit && Date.now() - hit.at < 60_000) return done(hit.addresses);
  lookup(host, { all: true }).then(
    (addresses) => {
      resolved.set(host, { at: Date.now(), addresses });
      done(addresses);
    },
    (err) => callback(err),
  );
}

function get(url, signal) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isPrivateAddress(host)) return reject(new Error(`refused: ${host} is a local or private address`));
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, { headers: { "user-agent": "gifmate" }, lookup: safeLookup, signal }, resolve);
    req.on("error", reject);
  });
}

// One deadline for the whole download, redirects included.
async function download(source, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(source);
  for (let hop = 0; hop < 4; hop++) {
    const res = await get(url, signal);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url); // each redirect is checked too
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`download failed: HTTP ${res.statusCode}`);
    }
    if (Number(res.headers["content-length"]) > MAX_BYTES) {
      res.destroy();
      throw new Error("GIF larger than 20 MB");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        res.destroy();
        throw new Error("GIF larger than 20 MB");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("download failed: too many redirects");
}

export async function loadBytes(source, { timeoutMs = 15_000 } = {}) {
  if (/^https?:\/\//i.test(source)) return download(source, timeoutMs);
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
    yield { index: i, time: t, rgba: canvas }; // the live canvas: copy it only if you keep it
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

// A still GIF wrapped in an SVG: chat panels draw it at once, no decoding needed.
export function stillSvg(bytes) {
  const { width, height } = new GifReader(new Uint8Array(bytes));
  const href = `data:image/gif;base64,${Buffer.from(bytes).toString("base64")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${href}"/></svg>`;
}

// Decode once, composite in order, keep only `maxFrames` frames evenly spaced in time.
function keyFrames(bytes, maxFrames) {
  const reader = new GifReader(new Uint8Array(bytes));
  if (reader.width * reader.height > MAX_PIXELS) throw new Error("GIF too large (over 4096x4096)");
  const n = reader.numFrames();
  // decoding composites every frame: cap the total work so a crafted GIF cannot stall the server
  if (n > MAX_FRAMES || n * reader.width * reader.height > MAX_WORK) throw new Error("GIF too long to decode (too many frames)");
  const times = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    times.push(t);
    t += (reader.frameInfo(i).delay || 10) / 100;
  }
  const keep = new Set(pickIndexes(times, maxFrames));
  const frames = [];
  for (const f of composite(reader)) if (keep.has(f.index)) frames.push({ ...f, rgba: f.rgba.slice() });
  return { width: reader.width, height: reader.height, totalFrames: n, duration: t, frames };
}

export function framesOf(bytes, { maxFrames = 12, maxSide = 384, encode = toPng } = {}) {
  const gif = keyFrames(bytes, maxFrames);
  return {
    ...gif,
    frames: gif.frames.map((f) => ({ index: f.index, time: f.time, ...encode(f.rgba, gif.width, gif.height, maxSide) })),
  };
}
