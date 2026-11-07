// The reaction diary: how GIFs land with this person, so the agent gets to know them.
// One local JSON-lines file next to the GIPHY key. Labels only, never the conversation.
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configPath } from "./config.mjs";

export const MOMENTS = ["task_done", "bug_fixed", "our_mistake_fixed", "good_news", "kickoff", "signoff", "banter", "asked"];
export const COOLDOWN_MIN = 30; // between two GIFs of the agent
export const DAILY_CAP = 4;
const SOLO = { sent: 5, days: 3, moments: 2, reactions: 3 }; // enough to stop asking (Codex review, 2026-11-07)

export const diaryPath = () => join(dirname(configPath()), "diario.jsonl");

export async function readDiary(file = diaryPath()) {
  try {
    return (await readFile(file, "utf-8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function note(entry, file = diaryPath()) {
  const row = { t: new Date().toISOString(), ...entry };
  if (row.note) row.note = String(row.note).slice(0, 140);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(row) + "\n", { mode: 0o600 });
  return row;
}

export const forget = (file = diaryPath()) => rm(file, { force: true });

const day = (t) => t.slice(0, 10);

// Everything the agent needs before a GIF, computed from the diary (no other state).
export function profile(rows, now = new Date()) {
  const sent = rows.filter((r) => r.kind === "sent");
  const reactions = rows.filter((r) => r.kind === "reaction");
  const mode = rows.filter((r) => r.kind === "mode").at(-1)?.mode ?? "taratura";
  const today = sent.filter((r) => day(r.t) === day(now.toISOString())).length;
  const last = sent.at(-1);
  const wait = last ? Math.max(0, COOLDOWN_MIN - (now - new Date(last.t)) / 60_000) : 0;
  const titles = new Map();
  for (const r of sent) titles.set(r.gif, (titles.get(r.gif) ?? 0) + 1);
  const byMoment = {};
  for (const r of reactions) {
    const m = (byMoment[r.moment ?? "?"] ??= { positive: 0, negative: 0, neutral: 0 });
    m[r.outcome] = (m[r.outcome] ?? 0) + 1;
  }
  const clear = [...reactions.filter((r) => r.strength !== "weak"), ...rows.filter((r) => r.kind === "missed" || r.kind === "user_gif")];
  const ready =
    sent.length >= SOLO.sent &&
    new Set(sent.map((r) => day(r.t))).size >= SOLO.days &&
    new Set(sent.map((r) => r.moment)).size >= SOLO.moments &&
    clear.length >= SOLO.reactions &&
    !reactions.slice(-3).some((r) => r.outcome === "negative");
  return {
    mode,
    readyForSolo: mode === "taratura" && ready,
    today: { sent: today, cap: DAILY_CAP },
    waitMinutes: Math.ceil(wait),
    lastMoment: last?.moment ?? null,
    sentTotal: sent.length,
    calibrationDue: mode === "taratura" && sent.length % 3 === 0, // ask on the 1st, 4th, 7th... GIF
    firstEver: sent.length === 0,
    reactionsByMoment: byMoment,
    // in tune: what the user felt (their own GIF) after each kind of message of yours; send that feeling first next time
    inTune: tune(rows),
    missedByMoment: rows.filter((r) => r.kind === "missed").reduce((m, r) => ({ ...m, [r.moment ?? "?"]: (m[r.moment ?? "?"] ?? 0) + 1 }), {}),
    lessons: rows.filter((r) => r.kind === "lesson").slice(-20).map((r) => r.note),
    overused: [...titles].filter(([, n]) => n >= 3).map(([t]) => t),
    recentReactions: reactions.slice(-5).map((r) => ({ moment: r.moment, outcome: r.outcome, strength: r.strength })),
  };
}

// moment -> feelings their GIFs showed, most frequent first: { bug_fixed: ["lets go (2)", "relief (1)"] }
function tune(rows) {
  const by = {};
  for (const r of rows) {
    if (r.kind !== "user_gif" || !r.feeling) continue;
    const m = (by[r.moment ?? "?"] ??= {});
    m[r.feeling] = (m[r.feeling] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(by).map(([moment, f]) => [moment, Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`)]),
  );
}

// May the agent send a GIF now? null = yes, else the reason in one line.
export function gate(p, moment) {
  if (moment === "asked") return null; // the user asked for one
  if (p.today.sent >= p.today.cap) return `Not today: ${p.today.sent} GIFs already (cap ${p.today.cap}). Answer with words.`;
  if (p.waitMinutes > 0 && moment !== "banter") return `Not now: your last GIF was less than ${COOLDOWN_MIN} minutes ago (${p.waitMinutes} min to wait). Answer with words.`;
  return null;
}
