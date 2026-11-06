#!/usr/bin/env node
// gifmate: an MCP server so coding agents can watch GIFs and send them back.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animatedSvg, framesOf, loadBytes } from "./gif.mjs";
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

const server = new McpServer({ name: "gifmate", version: "0.1.0" }, { instructions: GIF_RULES });

// Keep the GIF and an SMIL SVG that plays it (chat panels animate SVG, not a GIF inside one).
async function saveGif(bytes, budget) {
  framesOf(bytes, { maxFrames: 2 }); // refuse anything that is not a GIF
  const dir = join(tmpdir(), "gifmate");
  await mkdir(dir, { recursive: true });
  const name = createHash("sha1").update(bytes).digest("hex").slice(0, 12) + (budget ? `-${budget}` : "");
  const file = join(dir, name + ".gif");
  await writeFile(file, bytes);
  try {
    const svgFile = join(dir, name + ".svg");
    await writeFile(svgFile, animatedSvg(bytes, budget ? { budget } : undefined).svg);
    return { file, svgFile };
  } catch {
    return { file }; // too big to play inline
  }
}

const fail = (err) => ({ isError: true, content: [{ type: "text", text: String(err.message || err) }] });

server.registerTool(
  "gif_view",
  {
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
    description:
      "Search GIPHY for a reaction GIF to send the user, then send it with gif_send on its `gif` URL. Follow gifmate's rules: only at a moment that earns it (a hard-won win, good news, a kickoff, a warm sign-off), never when something failed or the user is stressed, at most one per reply and not two replies in a row. Search the feeling in English, pick by title.",
    inputSchema: {
      query: z.string().describe("What the GIF should show, in English works best"),
      limit: z.number().int().min(1).max(12).default(6),
      thumbs: z.boolean().default(false).describe("Also save a small animated preview (SVG) of each result, for a picker UI"),
    },
  },
  async ({ query, limit, thumbs }) => {
    try {
      const results = await searchGiphy(query, { limit });
      if (thumbs) {
        await Promise.all(
          results.map(async (r) => {
            try {
              r.thumb = (await saveGif(await loadBytes(r.small), 40_000)).svgFile;
            } catch {
              // no preview for this one
            }
          }),
        );
      }
      const text = results.length
        ? JSON.stringify(results, null, 2) + "\n\nPowered by GIPHY"
        : `No GIF found for "${query}".`;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "gif_send",
  {
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
      const lines = [`gifmate-sent: ${file}`];
      if (svgFile) lines.push(`gifmate-svg: ${svgFile}`);
      if (caption) lines.push(caption);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
