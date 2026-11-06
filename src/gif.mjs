// Turn an animated GIF into a few still frames an agent can look at.
import { readFile } from "node:fs/promises";
import { GifReader } from "omggif";
import { PNG } from "pngjs";

const MAX_BYTES = 20 * 1024 * 1024;

export async function loadBytes(source) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { "user-agent": "gifmate" } });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("GIF larger than 20 MB");
    return buf;
  }
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

function toPng(rgba, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const s = (sy * width + sx) * 4;
      const d = (y * w + x) * 4;
      // transparent pixels on white, so "nothing" is not read as black
      const a = rgba[s + 3] / 255;
      png.data[d] = rgba[s] * a + 255 * (1 - a);
      png.data[d + 1] = rgba[s + 1] * a + 255 * (1 - a);
      png.data[d + 2] = rgba[s + 2] * a + 255 * (1 - a);
      png.data[d + 3] = 255;
    }
  }
  return PNG.sync.write(png).toString("base64");
}

// An SVG that plays the GIF with SMIL, for chat panels that draw SVG as an image
// (an <img> does not animate a GIF nested inside an SVG). Fewer and smaller frames
// until it fits `budget` characters.
export function animatedSvg(bytes, { budget = 120_000 } = {}) {
  for (const [count, side] of [[24, 200], [16, 180], [12, 160], [10, 140], [8, 120], [6, 100], [4, 90], [2, 80]]) {
    const gif = framesOf(bytes, { maxFrames: count, maxSide: side });
    const scale = Math.min(1, side / Math.max(gif.width, gif.height));
    const w = Math.max(1, Math.round(gif.width * scale));
    const h = Math.max(1, Math.round(gif.height * scale));
    const dur = gif.duration || 1;
    const images = gif.frames.map((f, i) => {
      const start = f.time / dur;
      const end = i + 1 < gif.frames.length ? gif.frames[i + 1].time / dur : 1;
      return (
        `<image width="${w}" height="${h}" visibility="hidden" href="data:image/png;base64,${f.png}">` +
        `<animate attributeName="visibility" calcMode="discrete" values="hidden;visible;hidden;hidden" ` +
        `keyTimes="0;${start.toFixed(4)};${end.toFixed(4)};1" dur="${dur.toFixed(2)}s" repeatCount="indefinite"/></image>`
      );
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${images.join("")}</svg>`;
    if (svg.length <= budget) return { svg, width: w, height: h, frames: gif.frames.length };
  }
  throw new Error("GIF too large to animate inline");
}

export function framesOf(bytes, { maxFrames = 12, maxSide = 384 } = {}) {
  const reader = new GifReader(new Uint8Array(bytes));
  const all = [...composite(reader)];
  const last = reader.frameInfo(all.length - 1);
  const duration = all[all.length - 1].time + (last.delay || 10) / 100;
  const keep = pickIndexes(all.map((f) => f.time), maxFrames);
  return {
    width: reader.width,
    height: reader.height,
    totalFrames: all.length,
    duration,
    frames: keep.map((i) => ({
      index: all[i].index,
      time: all[i].time,
      png: toPng(all[i].rgba, reader.width, reader.height, maxSide),
    })),
  };
}
