// The reaction diary: how GIFs land with this person, so the agent gets to know them.
// One local JSON-lines file next to the GIPHY key. Labels only, never the conversation.
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configPath } from "./config.mjs";

export const MOMENTS = ["task_done", "bug_fixed", "our_mistake_fixed", "good_news", "kickoff", "signoff", "banter", "asked"];
// The same moment is not the same moment: what it cost tells them apart (Codex review of 10 cases, 2026-11-07).
// Two values only, so the diary fills up instead of scattering one example per box.
export const INTENSITIES = ["ordinary", "hard_won"];
// Each brake silences the GIF on its own: a slip of yours, a user under stress, a sensitive context.
export const BRAKES = ["own_fault", "user_stressed", "sensitive"];
export const TONES = ["positive", "playful", "bitter", "frustrated"]; // of a GIF the user sends
const situation = (r) => [r.moment ?? "?", r.intensity].filter(Boolean).join("/");
const STRESS_MIN = 60; // a bitter or frustrated GIF of theirs keeps yours away this long

export const COOLDOWN_MIN = 30; // between two GIFs of the agent
export const DAILY_CAP = 4;
const QUIET = { sent: 5, days: 3, moments: 2, reactions: 3 }; // enough to stop asking (Codex review, 2026-11-07)

export const diaryPath = () => join(dirname(configPath()), "diary.jsonl");

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
  const mode = rows.filter((r) => r.kind === "mode").at(-1)?.mode ?? "calibrate";
  const today = sent.filter((r) => day(r.t) === day(now.toISOString())).length;
  const last = sent.at(-1);
  const wait = last ? Math.max(0, COOLDOWN_MIN - (now - new Date(last.t)) / 60_000) : 0;
  const titles = new Map();
  for (const r of sent) titles.set(r.gif, (titles.get(r.gif) ?? 0) + 1);
  const byMoment = {};
  for (const r of reactions) {
    const m = (byMoment[situation(r)] ??= { positive: 0, negative: 0, neutral: 0 });
    m[r.outcome] = (m[r.outcome] ?? 0) + 1;
  }
  // their bitter or frustrated GIF is no example to copy: it says to keep quiet for a while
  const lastSour = rows.filter((r) => r.kind === "user_gif" && (r.tone === "bitter" || r.tone === "frustrated")).at(-1);
  const stressed = lastSour ? (now - new Date(lastSour.t)) / 60_000 < STRESS_MIN : false;
  const clear = [...reactions.filter((r) => r.strength !== "weak"), ...rows.filter((r) => r.kind === "missed" || r.kind === "user_gif")];
  const ready =
    sent.length >= QUIET.sent &&
    new Set(sent.map((r) => day(r.t))).size >= QUIET.days &&
    new Set(sent.map((r) => r.moment)).size >= QUIET.moments &&
    clear.length >= QUIET.reactions &&
    !reactions.slice(-3).some((r) => r.outcome === "negative");
  return {
    mode,
    readyForQuiet: mode === "calibrate" && ready,
    today: { sent: today, cap: DAILY_CAP },
    waitMinutes: Math.ceil(wait),
    lastMoment: last?.moment ?? null,
    sentTotal: sent.length,
    calibrationDue: mode === "calibrate" && sent.length % 3 === 0, // ask on the 1st, 4th, 7th... GIF
    firstEver: sent.length === 0,
    userStressed: stressed,
    reactionsByMoment: byMoment,
    // in tune: what the user felt (their own positive or playful GIF) after each kind of message of yours: send that first next time
    inTune: tune(rows),
    missedByMoment: rows.filter((r) => r.kind === "missed").reduce((m, r) => ({ ...m, [situation(r)]: (m[situation(r)] ?? 0) + 1 }), {}),
    lessons: rows.filter((r) => r.kind === "lesson").slice(-20).map((r) => r.note),
    overused: [...titles].filter(([, n]) => n >= 3).map(([t]) => t),
    recentReactions: reactions.slice(-5).map((r) => ({ situation: situation(r), outcome: r.outcome, strength: r.strength })),
  };
}

// situation -> feelings their positive or playful GIFs showed, most frequent first: { "bug_fixed/hard_won": ["lets go (2)", "relief (1)"] }
function tune(rows) {
  const by = {};
  for (const r of rows) {
    if (r.kind !== "user_gif" || !r.feeling || r.tone === "bitter" || r.tone === "frustrated") continue;
    const m = (by[situation(r)] ??= {});
    m[r.feeling] = (m[r.feeling] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(by).map(([moment, f]) => [moment, Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`)]),
  );
}

// May the agent send a GIF now? null = yes, else the reason in one line.
export function gate(p, moment, { brakes = [] } = {}) {
  if (moment === "asked") return null; // the user asked for one
  if (brakes.includes("sensitive")) return "No GIF: security, data, money, a client or production are at stake. Answer with words.";
  if (brakes.includes("user_stressed") || (p.userStressed && moment !== "banter"))
    return "No GIF: the user is under stress (rushed, frustrated, the same bug back again). Acknowledge it and act, in words.";
  // a slip of yours: words and responsibility, unless they are the one joking about it
  if (brakes.includes("own_fault") && moment !== "banter")
    return "No GIF for fixing a slip of your own: nothing to celebrate. Answer with words, a light self-ironic line at most.";
  if (p.today.sent >= p.today.cap) return `Not today: ${p.today.sent} GIFs already (cap ${p.today.cap}). Answer with words.`;
  if (p.waitMinutes > 0 && moment !== "banter") return `Not now: your last GIF was less than ${COOLDOWN_MIN} minutes ago (${p.waitMinutes} min to wait). Answer with words.`;
  return null;
}
