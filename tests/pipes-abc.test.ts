import { expect, test } from "bun:test";
import { parseAbc, arrange, buildEvents, PIPE_SHORT } from "../src/pipes/abc.ts";
import { SCOTLAND_THE_BRAVE, AMAZING_GRACE, AULD_LANG_SYNE, CUSTOM_TEMPLATE } from "../src/pipes/songs.ts";

const line = (notes: { note: number; dur: number }[]) => notes.map((n) => PIPE_SHORT[n.note] + (n.dur === 0.5 ? "" : n.dur)).join(" ");

test("Scotland the Brave: 16 bars twice through, every bar four beats, ends on Low A", () => {
  const t = parseAbc(SCOTLAND_THE_BRAVE);
  expect(t.warnings).toEqual([]);
  expect(t.tempo).toBe(100);
  expect(t.parts.length).toBe(1);
  const mel = t.parts[0].notes;
  // pickup + 2 × 16 bars
  expect(t.bars.length).toBe(33);
  for (let i = 1; i < t.bars.length - 1; i++) expect(t.bars[i + 1] - t.bars[i]).toBeCloseTo(4, 6);
  expect(t.length).toBeCloseTo(0.5 + 32 * 4, 6);
  expect(mel[0].note).toBe(5); // the pickup E
  expect(mel[mel.length - 1].note).toBe(1);
  expect(mel[mel.length - 1].dur).toBeCloseTo(2, 6);
  // bar 1: A2 A>B cA ce, with a G gracenote, a GdGe, and C doublings
  const bar1 = mel.filter((n) => n.bar === 1);
  expect(line(bar1)).toBe("A1 A0.75 B0.25 C A C E");
  expect(bar1[0].graces).toEqual([7]);
  expect(bar1[1].graces).toEqual([0, 4, 0, 5]);
  expect(bar1[2].graces).toEqual([]);
  expect(bar1[3].graces).toEqual([7, 3, 4]);
  expect(t.sections.map((s) => s.name)).toEqual(["PART 1", "PART 2", "PART 1", "PART 2"]);
});

test("Amazing Grace in 3/4", () => {
  const t = parseAbc(AMAZING_GRACE);
  expect(t.meter).toEqual([3, 4]);
  for (let i = 1; i < t.bars.length - 1; i++) expect(t.bars[i + 1] - t.bars[i]).toBeCloseTo(3, 6);
  expect(t.parts[0].notes.every((n) => n.note >= 0 && n.note <= 8)).toBe(true);
});

test("Auld Lang Syne: pickup + 16 bars of 4/4 on the chanter, Low A to High A", () => {
  const t = parseAbc(AULD_LANG_SYNE);
  expect(t.warnings).toEqual([]);
  expect(t.bars.length).toBe(17);
  for (let i = 1; i < t.bars.length - 1; i++) expect(t.bars[i + 1] - t.bars[i]).toBeCloseTo(4, 6);
  const mel = t.parts[0].notes;
  expect(line(mel.filter((n) => n.bar === 1))).toBe("A1.5 A A1 C1");
  expect(Math.max(...mel.map((n) => n.note))).toBe(8);
  expect(mel[mel.length - 1].note).toBe(1);
  expect(t.sections.map((s) => s.name)).toEqual(["PART 1", "PART 2"]);
});

test("a D-major fiddle setting moves onto the chanter (D → Low A)", () => {
  const t = parseAbc("X:1\nT:t\nM:2/4\nL:1/8\nK:D\nD2 D>E|FD FA|d2 d>c|dA FD|");
  expect(t.parts[0].notes[0].note).toBe(1);
  expect(Math.max(...t.parts[0].notes.map((n) => n.note))).toBe(8);
});

test("written parts go to pipers; one part becomes melody and seconds", () => {
  const c = parseAbc(CUSTOM_TEMPLATE);
  expect(c.parts.length).toBe(2);
  expect(arrange(c, 3, true).roles).toEqual(["PART 1", "PART 2", "PART 1"]);
  const t = parseAbc(SCOTLAND_THE_BRAVE);
  const a = arrange(t, 5, true);
  expect(a.roles).toEqual(["MELODY", "MELODY", "MELODY", "SECONDS", "SECONDS"]);
  const ev = buildEvents(t, a, { graceMs: 30, humanize: 6, intro: 4 });
  expect(ev.length % 5).toBe(0);
  // gracenotes land before their beat
  const p0 = [];
  for (let i = 0; i < ev.length; i += 5) if (ev[i] === 0) p0.push([ev[i + 1], ev[i + 2], ev[i + 3], ev[i + 4]]);
  expect(p0[0][2]).toBe(1);
  expect(p0[p0.length - 1][2]).toBe(2);
  expect(p0.filter((e) => e[2] === 0 && e[0] === 0.5 && e[1] < 0).length).toBe(1);
});
