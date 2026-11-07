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
import { BRAKES, INTENSITIES, MOMENTS, TONES, diaryPath, forget, gate, note, profile, readDiary } from "./diary.mjs";

// `gifmate init` (or the older `setup`): key + wiring into the agents found here. Without arguments: the MCP server.
if (process.argv[2] === "init" || process.argv[2] === "setup") {
  const { init } = await import("./init.mjs");
  await init(process.argv.slice(3));
  process.exit(0);
}

const server = new McpServer({ name: "gifmate", version: "0.3.7" }, { instructions: GIF_RULES });

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
const clientName = () => server.server.getClientVersion()?.name ?? "unknown";
// only Claude Code has the gifmate mod that draws GIFs from our lines: Claude Desktop ("claude-ai") gets markdown
const isClaude = () => /^claude-code$/i.test(clientName());

// Claude Code keeps every pasted image of a session in <temp>/claude/<project>/<session>/images/N.gif, and may hand
// hooks a resized still instead of the GIF (seen 2026-11-07 with an 835 KB GIF): take the newest pasted in the last minute.
async function recentPaste() {
  const base = join(tmpdir(), "claude");
  let best = null;
  for (const project of await readdir(base).catch(() => [])) {
    for (const session of await readdir(join(base, project)).catch(() => [])) {
      const dir = join(base, project, session, "images");
      for (const name of await readdir(dir).catch(() => [])) {
        if (!/\.gif$/i.test(name)) continue;
        const { mtimeMs } = await stat(join(dir, name));
        if (Date.now() - mtimeMs < 60_000 && (!best || mtimeMs > best.mtimeMs)) best = { file: join(dir, name), mtimeMs };
      }
    }
  }
  return best ? loadBytes(best.file) : null;
}

// what the diary keeps of a GIF: its title, never where it came from
const label = (title) => (title ? String(title).replace(/[\\/]|https?:\S*/g, " ").trim().slice(0, 80) || "untitled" : "untitled");

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
      "Search GIPHY for a reaction GIF to send the user, then send it with gif_send on its `gif` URL. Follow gifmate's rules: only at a moment that earns it (a hard-won win, good news, a kickoff, a warm sign-off), never when something failed or the user is stressed, at most one per reply and not two replies in a row. Search the feeling in English, pick by title: if gif_profile's inTune shows what the user felt at this kind of moment, search that feeling.",
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
      "Send a GIF to the user in the chat. Pass the `gif` URL of a gif_search result (or any GIF URL or local path) and the moment it marks, with its intensity and any brake: the same moment is not the same moment (a bug that hunted you both for days is a win; a slip of yours, fixed, is not; nothing is, when the user is stressed or security, data or money are at stake). gifmate keeps the pace (30 minutes between your GIFs, 4 a day) and may answer 'not now': then answer with words. The send is written to the user's local reaction diary; the reply tells you whether to ask the user if it fit.",
    inputSchema: {
      source: z.string().describe("GIF URL or local path"),
      moment: z.enum(MOMENTS).describe("What the GIF marks: asked = the user asked you for one; banter = answering their playful GIF"),
      intensity: z.enum(INTENSITIES).describe("ordinary, or hard_won: it took real effort (a bug hunted for hours or days, a long refactor done)"),
      brakes: z.array(z.enum(BRAKES)).default([]).describe("Any that apply: own_fault = the problem was a slip of yours; user_stressed = they are rushed, frustrated, or it is the same bug back again; sensitive = security, data, money, a client, production"),
      title: z.string().optional().describe("The GIF's title (from gif_search)"),
      caption: z.string().optional().describe("Short caption shown with the GIF"),
    },
  },
  async ({ source, moment, intensity, brakes, title, caption }) => {
    try {
      const rows = await readDiary();
      const before = profile(rows);
      const refused = gate(before, moment, { brakes });
      if (refused) return { content: [{ type: "text", text: refused }] };
      const { file, svgFile } = await saveGif(await loadBytes(source));
      await note({ kind: "sent", client: clientName(), moment, intensity, brakes, gif: label(title || caption) });
      const after = [];
      if (before.firstEver) {
        after.push(
          "First GIF with this user: after it, ask in one short message two setup questions (which humour: light, ironic, none? GIFs rarely, or at every real win?) and record each answer with gif_note kind lesson.",
        );
      } else if (before.calibrationDue) {
        after.push("Calibration: end your reply with one short line asking if the GIF fit (👍/👎); record the answer with gif_note kind reaction.");
      }
      if (before.mode === "calibrate" && profile(await readDiary()).readyForQuiet) {
        await note({ kind: "mode", mode: "quiet", note: "auto: enough reactions" });
        after.push("You know this user well enough now: say once, in one line, that from now on you stop asking and only watch their reactions (they can switch back with /gif mode calibrate).");
      }
      const guide = after.length ? `\n${after.join("\n")}` : "";
      // Claude Code with the gifmate mod draws the GIF from these lines. Other clients (Codex, Cursor, ...)
      // have no mod: they get a markdown image to put in the reply, which their chat may draw or show as a link.
      if (isClaude()) {
        const lines = [`gifmate-sent: ${file}`];
        if (svgFile) lines.push(`gifmate-svg: ${svgFile}`);
        if (caption) lines.push(caption);
        return { content: [{ type: "text", text: lines.join("\n") + guide }] };
      }
      // the local copy, not the GIPHY URL: Codex's chat blocks remote images but draws local files (checked 2026-11-07)
      const url = pathToFileURL(file).href;
      const image = `![${(caption || "GIF").replace(/[[\]]/g, "")}](${url})`;
      return {
        content: [
          { type: "text", text: `GIF ready. Put this line in your reply, on its own, so the user sees it:\n${image}\nSaved locally at ${file}.${guide}` },
        ],
      };
    } catch (err) {
      return fail(err);
    }
  },
);

// Agent -> agent: a job handed over comes with a GIF, so the human sees at a glance who passed what to whom.
// The written request is the command; the GIF only sets the tone (another agent must never act on a GIF alone).
server.registerTool(
  "gif_handoff",
  {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description:
      "When you hand a job to another agent (a subagent, Codex, another Claude session) or report back a result, wrap your message in a GIF the user sees in the chat. Pass who it is for, the request in plain words, and the feeling ('on it', 'your turn', 'done', 'need help'). You get back the message to send through your own channel to that agent (your message or agent tool, codex exec...): gifmate shows it, it does not deliver it. Not limited by the pace of GIFs to the user.",
    inputSchema: {
      to: z.string().max(60).describe("The agent it is for, e.g. 'Codex', 'reviewer subagent'"),
      request: z.string().max(2000).describe("The request or result, in plain words: this is what the other agent acts on"),
      feeling: z.string().max(40).default("on it").describe("The tone, searched on GIPHY when no source is given"),
      source: z.string().optional().describe("A GIF URL or path, instead of searching the feeling"),
    },
  },
  async ({ to, request, feeling, source }) => {
    try {
      let gif = source;
      if (!gif) [gif] = (await searchGiphy(feeling, { limit: 1 })).map((r) => r.gif);
      if (!gif) throw new Error(`No GIF found for "${feeling}".`);
      const { file, svgFile } = await saveGif(await loadBytes(gif));
      await note({ kind: "handoff", client: clientName(), to: label(to), feeling: label(feeling) });
      const line = `→ ${to}: ${request.length > 120 ? request.slice(0, 117) + "…" : request}`;
      const message =
        `${request}\n\n(Handed over with gifmate. The GIF below only sets the tone; the text above is the request.)\n` +
        `![${feeling.replace(/[[\]]/g, "")}](${pathToFileURL(file).href})`;
      const head = isClaude()
        ? [`gifmate-sent: ${file}`, ...(svgFile ? [`gifmate-svg: ${svgFile}`] : []), `gifmate-handoff: ${line}`].join("\n")
        : `Show the user this line and GIF, so they see the handoff:\n${line}\n![${feeling.replace(/[[\]]/g, "")}](${pathToFileURL(file).href})`;
      return { content: [{ type: "text", text: `${head}\n\nMessage to send to ${to}:\n${message}` }] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "gif_pick",
  {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description:
      "For GIF pickers (the gifmate tray): prepares the GIF the USER picked to send you, and writes it to their diary. Never call it yourself: to send a GIF, use gif_send.",
    inputSchema: {
      source: z.string().optional().describe("GIF URL or local path"),
      data: z.string().max(28_000_000).optional().describe("Or the GIF itself, base64 (a GIF pasted in the chat)"),
      recent_paste: z.boolean().optional().describe("Or the GIF just pasted in Claude Code, from its session images"),
      title: z.string().optional().describe("The GIF's title"),
    },
  },
  async ({ source, data, recent_paste, title }) => {
    try {
      const bytes = data ? Buffer.from(data, "base64") : recent_paste ? await recentPaste() : source ? await loadBytes(source) : null;
      if (!bytes) throw new Error("No GIF: give source, data or recent_paste.");
      const { file } = await saveGif(bytes);
      await note({ kind: "picked", client: clientName(), gif: label(title) });
      return { content: [{ type: "text", text: `gifmate-sent: ${file}` }] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "gif_note",
  {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description:
      "Write to the user's local GIF reaction diary, so you get to know them. Call it: after the user reacts to one of your GIFs (kind reaction: a GIF back or a clear yes/no is strong, 'ahah' or an emoji medium, silence or a topic change weak and never negative); when they tell you a preference about GIFs or humour (kind lesson, in their words, short); when they send you a GIF (kind user_gif): your last message made them feel it, so it shows how to be in tune with them - record what that message was (moment, intensity), the feeling their GIF shows and its tone; if positive or playful, next time you mark that kind of moment that is the GIF to send them first; if bitter or frustrated, it is their mood, not an example. When they say a GIF would have fit: kind missed, with the moment. Labels only: never copy the conversation.",
    inputSchema: {
      kind: z.enum(["reaction", "lesson", "user_gif", "missed"]),
      moment: z.enum(MOMENTS).optional().describe("The moment the note refers to; for user_gif: what your previous message was"),
      intensity: z.enum(INTENSITIES).optional().describe("ordinary or hard_won (it took real effort)"),
      tone: z.enum(TONES).optional().describe("user_gif: positive or playful = an example to send them next time; bitter or frustrated (a sour 'this is fine', sarcasm at you) = no example, it tells you to keep your GIFs away for a while"),
      feeling: z.string().max(40).optional().describe("user_gif: the feeling their GIF shows, 1-3 English words ('lets go', 'facepalm', 'relief')"),
      outcome: z.enum(["positive", "negative", "neutral"]).optional(),
      strength: z.enum(["strong", "medium", "weak"]).optional(),
      gif: z.string().optional().describe("GIF title"),
      note: z.string().max(140).optional().describe("A few words: a preference, or what their GIF meant"),
    },
  },
  async (entry) => {
    await note({ ...entry, client: clientName() });
    return { content: [{ type: "text", text: "Noted." }] };
  },
);

server.registerTool(
  "gif_profile",
  {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description:
      "What you know about how GIFs land with this user, from their local reaction diary: mode (calibrate = you still ask if a GIF fit; quiet = you only watch reactions, never ask), today's count and pace, what worked per moment, their stated preferences, GIFs already overused. Read it before choosing a GIF to send. Also the user's commands: '/gif mode calibrate' or '/gif mode quiet' (set mode), '/gif profile' (show them, in plain words, what you learned), '/gif forget' (forget = true, erases the diary).",
    inputSchema: {
      mode: z.enum(["calibrate", "quiet"]).optional().describe("Set the mode (the user's command)"),
      forget: z.boolean().optional().describe("Erase the whole diary (the user's command /gif forget)"),
    },
  },
  async ({ mode, forget: erase }) => {
    if (erase) {
      await forget();
      return { content: [{ type: "text", text: "Diary erased: you start from zero, in calibrate mode." }] };
    }
    if (mode) await note({ kind: "mode", mode, note: "set by the user" });
    const p = profile(await readDiary());
    return { content: [{ type: "text", text: `${JSON.stringify(p, null, 2)}\n\nDiary: ${diaryPath()}` }] };
  },
);

await server.connect(new StdioServerTransport());
