import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, gate, note, profile, readDiary } from "../src/diary.mjs";

const at = (iso, entry) => ({ t: iso, ...entry });
const sent = (iso, moment = "task_done") => at(iso, { kind: "sent", moment, gif: "x" });

test("pace: 30 minutes between GIFs, 4 a day; asked and banter have their own rules", () => {
  const now = new Date("2026-11-07T10:20:00Z");
  const p = profile([sent("2026-11-07T10:00:00Z")], now);
  assert.match(gate(p, "task_done"), /Not now/);
  assert.equal(gate(p, "banter"), null);
  assert.equal(gate(p, "asked"), null);
  const four = ["08", "09", "10", "11"].map((h) => sent(`2026-11-07T${h}:00:00Z`));
  assert.match(gate(profile(four, new Date("2026-11-07T15:00:00Z")), "bug_fixed"), /Not today/);
  assert.equal(gate(profile(four, new Date("2026-11-08T09:00:00Z")), "bug_fixed"), null);
});

test("calibrate asks on the 1st, 4th, 7th GIF; switches to quiet only with enough clear signal", () => {
  assert.equal(profile([]).calibrationDue, true);
  const rows = [
    sent("2026-11-05T10:00:00Z"), sent("2026-11-05T15:00:00Z", "bug_fixed"),
    sent("2026-11-06T10:00:00Z"), sent("2026-11-06T15:00:00Z"), sent("2026-11-07T10:00:00Z", "bug_fixed"),
  ];
  assert.equal(profile(rows).readyForQuiet, false); // no reactions yet
  const reacted = [...rows, ...[1, 2].map(() => at("2026-11-07T11:00:00Z", { kind: "reaction", outcome: "positive", strength: "strong" }))];
  assert.equal(profile(reacted).readyForQuiet, false);
  const missed = [...reacted, at("2026-11-07T12:00:00Z", { kind: "missed", moment: "bug_fixed" })];
  assert.equal(profile(missed).readyForQuiet, true);
  assert.deepEqual(profile(missed).missedByMoment, { bug_fixed: 1 });
  const annoyed = [...missed, at("2026-11-07T13:00:00Z", { kind: "reaction", outcome: "negative", strength: "strong" })];
  assert.equal(profile(annoyed).readyForQuiet, false);
  assert.equal(profile([...missed, at("2026-11-07T13:00:00Z", { kind: "mode", mode: "quiet" })]).mode, "quiet");
});

test("in tune: the user's own GIFs tell which feeling each kind of moment gives them", () => {
  const rows = ["lets go", "relief", "lets go"].map((feeling) => at("2026-11-07T10:00:00Z", { kind: "user_gif", moment: "bug_fixed", feeling }));
  assert.deepEqual(profile(rows).inTune, { bug_fixed: ["lets go (2)", "relief (1)"] });
});

test("the situation: intensity tells moments apart, each brake silences the GIF", () => {
  const rows = [
    at("2026-11-07T10:00:00Z", { kind: "user_gif", moment: "bug_fixed", intensity: "hard_won", feeling: "finally", tone: "positive" }),
    at("2026-11-07T11:00:00Z", { kind: "user_gif", moment: "task_done", intensity: "ordinary", feeling: "party", tone: "playful" }),
  ];
  assert.deepEqual(profile(rows).inTune, { "bug_fixed/hard_won": ["finally (1)"], "task_done/ordinary": ["party (1)"] });
  for (const brake of ["own_fault", "user_stressed", "sensitive"]) assert.match(gate(profile([]), "bug_fixed", { brakes: [brake] }), /No GIF/);
  assert.equal(gate(profile([]), "banter", { brakes: ["own_fault"] }), null); // they joke about it: play along
  assert.equal(gate(profile([]), "asked", { brakes: ["sensitive"] }), null);
});

test("a bitter GIF of theirs is no example: it keeps the agent's GIFs away for an hour", () => {
  const sour = at("2026-11-07T10:00:00Z", { kind: "user_gif", moment: "bug_fixed", feeling: "this is fine", tone: "bitter" });
  assert.deepEqual(profile([sour]).inTune, {});
  assert.match(gate(profile([sour], new Date("2026-11-07T10:30:00Z")), "task_done"), /under stress/);
  assert.equal(gate(profile([sour], new Date("2026-11-07T11:30:00Z")), "task_done"), null);
});

test("the diary keeps labels short and forgets on request", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "gifmate-")), "diary.jsonl");
  await note({ kind: "lesson", note: "x".repeat(500) }, file);
  assert.equal((await readDiary(file))[0].note.length, 140);
  assert.match(await readFile(file, "utf-8"), /"kind":"lesson"/);
  await forget(file);
  assert.deepEqual(await readDiary(file), []);
});
