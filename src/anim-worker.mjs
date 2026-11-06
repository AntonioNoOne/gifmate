// Builds animated SVG previews off the main thread, so searches never wait behind them.
import { parentPort } from "node:worker_threads";
import { animatedSvg } from "./gif.mjs";

parentPort.on("message", ({ id, bytes, options }) => {
  try {
    parentPort.postMessage({ id, svg: animatedSvg(Buffer.from(bytes), options).svg });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err.message || err) });
  }
});
