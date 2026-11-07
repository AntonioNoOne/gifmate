#!/usr/bin/env node
// gifmate: an MCP server so coding agents can watch GIFs and send them back.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { framesOf, loadBytes, stillSvg } from "./gif.mjs";
import { searchGiphy } from "./giphy.mjs";
import { GIF_RULES } from "./rules.mjs";

if (process.argv[2] === "setup") {
  const { createInterface } = await import("node:readline/promises");
  const { saveGiphyKey } = await import("./config.mjs");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const key = (await rl.question("GIPHY API key (free at https://developers.giphy.com): ")).trim();
  rl.close();
  if (!key) process.exit(1);
  console.log(`Saved to ${await saveGiphyKey(key)}. Restart or reconnect gifmate in your agent.`);
  process.exit(0);
}

const server = new McpServer({ name: "gifmate", version: "0.2.0" }, { instructions: GIF_RULES });

// Sent GIFs and previews live in the temp folder for the chat to draw; a day later nobody needs them.
const DIR = join(tmpdir(), "gifmate");
void readdir(DIR)
  .then((names) =>
    Promise.all(
      names.map(async (n) => {
        const f = join(DIR, n);
        if (Date.now() - (await stat(f)).mtimeMs > 24 * 3600_000) await rm(f, { force: true });
      }),
    ),
  )
  .catch(() => {});

// Animated SVGs are CPU work: a worker thread builds them, so the server keeps answering meanwhile
// (on the main thread a search waited up to 2.6 s behind the previous search's previews).
// If the worker dies, the jobs waiting on it fail at once (instead of hanging) and the next one starts a new worker.
const waiting = new Map();
let jobs = 0;
let worker = null;
function startWorker() {
  const w = new Worker(new URL("./anim-worker.mjs", import.meta.url));
  w.on("message", ({ id, svg, error }) => {
    const job = waiting.get(id);
    waiting.delete(id);
    if (error) job?.reject(new Error(error));
    else job?.resolve(svg);
  });
  // only this worker's jobs fail: a replacement worker may already be working on newer ones
  const fail = (err) => {
    if (worker === w) worker = null;
    for (const [id, job] of waiting) {
      if (job.w !== w) continue;
      waiting.delete(id);
      job.reject(err instanceof Error ? err : new Error(`preview worker stopped (${err})`));
    }
  };
  w.on("error", fail);
  w.on("exit", (code) => fail(code));
  return w;
}
const animate = (bytes, options) =>
  new Promise((resolve, reject) => {
    worker ??= startWorker();
    const id = ++jobs;
    waiting.set(id, { resolve, reject, w: worker });
    worker.postMessage({ id, bytes: new Uint8Array(bytes), options });
  });

// Keep the GIF and an SMIL SVG that plays it (chat panels animate SVG, not a GIF inside one).
async function saveGif(bytes) {
  framesOf(bytes, { maxFrames: 2 }); // refuse anything that is not a GIF
  const dir = join(tmpdir(), "gifmate");
  await mkdir(dir, { recursive: true });
  const name = createHash("sha1").update(bytes).digest("hex").slice(0, 12);
  const file = join(dir, name + ".gif");
  await writeFile(file, bytes);
  try {
    const svgFile = join(dir, name + ".svg");
    await writeFile(svgFile, await animate(bytes));
    return { file, svgFile };
  } catch {
    return { file }; // too big to play inline
  }
}

// Write to a side name, then rename: the chat never reads a half-written preview.
async function writeWhole(file, text) {
  await writeFile(`${file}.part`, text);
  await rename(`${file}.part`, file);
}

// Previews one at a time; a new search drops the previous one's previews still waiting: nobody looks at them any more.
let queue = Promise.resolve();
let searches = 0;
const later = (job, search) => (queue = queue.then(() => (search === searches ? job() : undefined)).catch(() => {}));

// Claude Code presents itself as "claude-code", Codex as "codex-mcp-client" (checked 2026-11-07).
const isClaude = () => /claude/i.test(server.server.getClientVersion()?.name ?? "");

const fail = (err) => ({ isError: true, content: [{ type: "text", text: String(err.message || err) }] });

server.registerTool(
  "gif_view",
  {
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "Watch an animated GIF. Image readers show only its first frame; this returns frames evenly spaced in time, in order, with timestamps, so you can follow the motion. Use it whenever the user shares a .gif (local path or URL), and to preview a GIF before sending one.",
    inputSchema: {
      source: z.string().describe("Local file path or http(s) URL of the GIF"),
      max_frames: z.number().int().min(2).max(24).default(12).describe("How many frames to look at"),
    },
  },
  async ({ source, max_frames }) => {
    try {
      const gif = framesOf(await loadBytes(source), { maxFrames: max_frames });
      const header = `${gif.width}x${gif.height}, ${gif.totalFrames} frames, ${gif.duration.toFixed(2)} s. Showing ${gif.frames.length} frames in order:`;
      const content = [{ type: "text", text: header }];
      for (const f of gif.frames) {
        content.push({ type: "text", text: `frame ${f.index + 1}/${gif.totalFrames} at ${f.time.toFixed(2)} s` });
        content.push({ type: "image", data: f.base64, mimeType: f.mime });
      }
      return { content };
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "gif_search",
  {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, // previews are written to the temp folder
    description:
      "Search GIPHY for a reaction GIF to send the user, then send it with gif_send on its `gif` URL. Follow gifmate's rules: only at a moment that earns it (a hard-won win, good news, a kickoff, a warm sign-off), never when something failed or the user is stressed, at most one per reply and not two replies in a row. Search the feeling in English, pick by title.",
    inputSchema: {
      query: z.string().describe("The feeling to show, in English or Italian (Italian reaction words are translated). Empty: what is trending."),
      limit: z.number().int().min(1).max(12).default(6),
      thumbs: z.boolean().default(false).describe("Also save a small animated preview (SVG) of each result, for a picker UI"),
    },
  },
  async ({ query, limit, thumbs }) => {
    try {
      const results = await searchGiphy(query, { limit });
      if (thumbs) {
        // Answer at once, as fast pickers do: GIPHY's CDN takes 0.1-1.2 s per image (measured), the search 0.2 s.
        // The files appear when ready: GIPHY's still frame (`thumb`), then the animated preview (`anim`).
        const dir = join(tmpdir(), "gifmate");
        await mkdir(dir, { recursive: true });
        const search = ++searches;
        for (const r of results) {
          const id = createHash("sha1").update(r.small).digest("hex").slice(0, 12);
          r.thumb = join(dir, `${id}-still.svg`);
          r.anim = join(dir, `${id}-anim.svg`);
          if (r.still) void loadBytes(r.still).then((bytes) => writeWhole(r.thumb, stillSvg(bytes))).catch(() => {});
          void loadBytes(r.small)
            .then((bytes) => later(async () => writeWhole(r.anim, await animate(bytes, { budget: 40_000, maxSide: 120 })), search))
            .catch(() => {});
        }
      }
      if (!results.length) return { content: [{ type: "text", text: `No GIF found for "${query}".` }] };
      let text = JSON.stringify(results, null, 2) + "\n\nPowered by GIPHY";
      // Clients without the Claude tray (Codex, Cursor...): a numbered gallery of local copies, which their chat
      // draws (Codex blocks remote images, draws local ones), so the user can pick a GIF by its number.
      if (!isClaude()) {
        const dir = join(tmpdir(), "gifmate");
        await mkdir(dir, { recursive: true });
        const gallery = await Promise.all(
          results.map(async (r, i) => {
            try {
              const file = join(dir, `${createHash("sha1").update(r.small).digest("hex").slice(0, 12)}-small.gif`);
              await writeWhole(file, await loadBytes(r.small, { timeoutMs: 4000 }));
              return `${i + 1}. ![${r.title.replace(/[[\]]/g, "")}](${pathToFileURL(file).href})`;
            } catch {
              return `${i + 1}. ${r.title}`;
            }
          }),
        );
        text += `\n\nGallery (numbered, for the user to pick from):\n${gallery.join("\n")}`;
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "gif_send",
  {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description:
      "Send a GIF to the user in the chat. Pass the `gif` URL of a gif_search result (or any GIF URL or local path). Clients with the gifmate chat mod draw it inline; others get a local file to open.",
    inputSchema: {
      source: z.string().describe("GIF URL or local path"),
      caption: z.string().optional().describe("Short caption shown with the GIF"),
    },
  },
  async ({ source, caption }) => {
    try {
      const { file, svgFile } = await saveGif(await loadBytes(source));
      // Claude Code with the gifmate mod draws the GIF from these lines. Other clients (Codex, Cursor, ...)
      // have no mod: they get a markdown image to put in the reply, which their chat may draw or show as a link.
      if (isClaude()) {
        const lines = [`gifmate-sent: ${file}`];
        if (svgFile) lines.push(`gifmate-svg: ${svgFile}`);
        if (caption) lines.push(caption);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
      // the local copy, not the GIPHY URL: Codex's chat blocks remote images but draws local files (checked 2026-11-07)
      const url = pathToFileURL(file).href;
      const image = `![${(caption || "GIF").replace(/[[\]]/g, "")}](${url})`;
      return {
        content: [
          { type: "text", text: `GIF ready. Put this line in your reply, on its own, so the user sees it:\n${image}\nSaved locally at ${file}.` },
        ],
      };
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
