/**
 * ABC notation → pipe parts. A practical subset for pipe tunes:
 *
 * - headers T: M: L: Q: K: (K:HP / K:Hp is pipe notation; other keys are moved diatonically onto
 *   the chanter, the way pipers set fiddle tunes), V: for up to five parts (one per piper)
 * - notes G A B c d e f g a (pipe names Low G … High A), octave marks ' and , (out-of-range
 *   notes fold onto the chanter), lengths (2, /2, 3/2, /, //), broken rhythm > <, ties -,
 *   triplets (3, chords [..] (top note), rests z x (pipes don't rest: the note before holds)
 * - gracenotes {gdc} before a note; bars | || |] [| and repeats |: :| :: with endings [1 [2 |1 |2
 * - comments %, decorations !..! +..+ and . ~ H T etc., quoted text and inline fields are skipped
 */

export const PIPE_NAMES = ["LOW G", "LOW A", "B", "C", "D", "E", "F", "HIGH G", "HIGH A"] as const;
export const PIPE_SHORT = ["G", "A", "B", "C", "D", "E", "F", "g", "a"] as const;

export interface PNote {
  /** start (quarter-note beats from the tune's first note) */
  beat: number;
  /** length (beats) */
  dur: number;
  /** 0 Low G … 8 High A */
  note: number;
  /** gracenotes before it, in order */
  graces: number[];
  /** bar index in the played-out (repeats expanded) tune */
  bar: number;
}

export interface Part {
  name: string;
  notes: PNote[];
}

export interface Tune {
  title: string;
  meter: [number, number];
  /** quarter notes per minute */
  tempo: number;
  parts: Part[];
  /** total length (beats) */
  length: number;
  /** start beat of every bar */
  bars: number[];
  /** "PART 1" … sections: start beats */
  sections: { beat: number; name: string }[];
  warnings: string[];
}

/** diatonic letter index: C D E F G A B → 0..6 plus 7 per octave; C4 = 28 */
const LETTERS = "CDEFGAB";
/** pipe note index for a diatonic step (G4 = Low G = step 32) */
const PIPE_G4 = 4 * 7 + 4;

interface RawNote {
  step: number;
  units: number;
  graces: number[];
  tie: boolean;
  rest: boolean;
}

type Tok =
  | { t: "note"; n: RawNote }
  | { t: "bar"; startRep: boolean; endRep: boolean; ending: number; final: boolean }
  | { t: "broken"; dir: ">" | "<"; n: number }
  | { t: "triplet"; p: number };

interface VoiceSrc {
  name: string;
  body: string;
}

function parseFrac(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** the step (diatonic, C4 = 28) of a letter with octave marks; lowercase is the octave above */
function stepOf(letter: string, marks: string): number {
  const up = letter === letter.toLowerCase();
  let s = LETTERS.indexOf(letter.toUpperCase()) + (up ? 5 * 7 : 4 * 7);
  for (const c of marks) s += c === "'" ? 7 : -7;
  return s;
}

function tokenize(body: string, warnings: string[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let graces: number[] = [];
  const s = body;
  const num = (): string => {
    const m = s.slice(i).match(/^(\d*)(\/*)(\d*)/);
    const t = m ? m[0] : "";
    i += t.length;
    return t;
  };
  const lenOf = (t: string): number => {
    if (!t) return 1;
    const m = t.match(/^(\d*)(\/*)(\d*)$/)!;
    const a = m[1] ? Number(m[1]) : 1;
    if (!m[2]) return a;
    const b = m[3] ? Number(m[3]) : 2 ** m[2].length;
    return a / b;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "%") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === '"') {
      i = s.indexOf('"', i + 1);
      i = i < 0 ? s.length : i + 1;
      continue;
    }
    if (c === "!" || c === "+") {
      const j = s.indexOf(c, i + 1);
      const nl = s.indexOf("\n", i + 1);
      if (j > 0 && (nl < 0 || j < nl)) {
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "{") {
      const j = s.indexOf("}", i);
      const inner = s.slice(i + 1, j < 0 ? s.length : j);
      graces = [];
      for (const m of inner.matchAll(/([A-Ga-g])([',]*)/g)) graces.push(stepOf(m[1], m[2]));
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === "[" && /^\[[A-Za-z]:/.test(s.slice(i))) {
      // inline field [K:..] [M:..]: skipped
      const j = s.indexOf("]", i);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === "[" && /^\[[12]/.test(s.slice(i))) {
      const n = Number(s[i + 1]);
      // an ending after a bar line: mark the last bar token
      const last = toks[toks.length - 1];
      if (last && last.t === "bar") last.ending = n;
      else toks.push({ t: "bar", startRep: false, endRep: false, ending: n, final: false });
      i += 2;
      continue;
    }
    if (c === "[") {
      // a chord: keep the top note
      const j = s.indexOf("]", i);
      const inner = s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j + 1;
      let top: { step: number; units: number } | null = null;
      for (const m of inner.matchAll(/([A-Ga-g])([',]*)(\d*\/*\d*)/g)) {
        const st = stepOf(m[1], m[2]);
        if (!top || st > top.step) top = { step: st, units: lenOf(m[3]) };
      }
      const after = num();
      if (top) {
        toks.push({ t: "note", n: { step: top.step, units: top.units * lenOf(after), graces, tie: false, rest: false } });
        graces = [];
      }
      continue;
    }
    if (c === "|" || c === ":" || (c === "[" && s[i + 1] === "|")) {
      const m = s.slice(i).match(/^(:*)(\[?\|+\]?|::)(:*)([12])?/);
      if (m) {
        const tok = m[0];
        const isDouble = tok.includes("::");
        toks.push({ t: "bar", startRep: m[3].length > 0 || isDouble, endRep: m[1].length > 0 || isDouble, ending: m[4] ? Number(m[4]) : 0, final: m[2].includes("]") });
        i += tok.length;
        continue;
      }
      i++;
      continue;
    }
    if (c === ">" || c === "<") {
      let n = 0;
      while (s[i] === c) {
        n++;
        i++;
      }
      toks.push({ t: "broken", dir: c, n });
      continue;
    }
    if (c === "(" && /\d/.test(s[i + 1] ?? "")) {
      toks.push({ t: "triplet", p: Number(s[i + 1]) });
      i += 2;
      while (s[i] === ":" || /\d/.test(s[i] ?? "")) i++;
      continue;
    }
    if (c === "-") {
      const last = [...toks].reverse().find((t) => t.t === "note") as { t: "note"; n: RawNote } | undefined;
      if (last) last.n.tie = true;
      i++;
      continue;
    }
    if (/[A-Ga-g]/.test(c)) {
      i++;
      let marks = "";
      while (s[i] === "'" || s[i] === ",") marks += s[i++];
      const step = stepOf(c, marks);
      toks.push({ t: "note", n: { step, units: lenOf(num()), graces, tie: false, rest: false } });
      graces = [];
      continue;
    }
    if (c === "z" || c === "x" || c === "Z") {
      i++;
      toks.push({ t: "note", n: { step: -1, units: lenOf(num()), graces: [], tie: false, rest: true } });
      continue;
    }
    if (c === "^" || c === "_" || c === "=") {
      // accidentals: the chanter has no others; ignore (warn once)
      if (!warnings.includes("accidentals ignored (the chanter has nine fixed notes)")) warnings.push("accidentals ignored (the chanter has nine fixed notes)");
      i++;
      continue;
    }
    i++;
  }
  return toks;
}

interface Bar {
  notes: RawNote[];
  startRep: boolean;
  endRep: boolean;
  ending: number;
}

function toBars(toks: Tok[]): Bar[] {
  const bars: Bar[] = [];
  let cur: Bar = { notes: [], startRep: false, endRep: false, ending: 0 };
  let triplet = 0;
  let tripletP = 3;
  let pendingBroken: { dir: ">" | "<"; n: number } | null = null;
  let lastNote: RawNote | null = null;
  for (const t of toks) {
    if (t.t === "bar") {
      if (cur.notes.length) {
        cur.endRep = cur.endRep || t.endRep;
        bars.push(cur);
        cur = { notes: [], startRep: t.startRep, endRep: false, ending: t.ending };
      } else {
        cur.startRep = cur.startRep || t.startRep;
        if (t.endRep && bars.length) bars[bars.length - 1].endRep = true;
        cur.ending = t.ending || cur.ending;
      }
      continue;
    }
    if (t.t === "broken") {
      pendingBroken = t;
      continue;
    }
    if (t.t === "triplet") {
      triplet = t.p;
      tripletP = t.p;
      continue;
    }
    const n = { ...t.n };
    if (triplet > 0) {
      // (3: three in the time of two; (2: two in the time of three
      n.units *= tripletP === 3 ? 2 / 3 : tripletP === 2 ? 3 / 2 : (tripletP - 1) / tripletP;
      triplet--;
    }
    if (pendingBroken && lastNote) {
      const k = pendingBroken.n === 1 ? 0.5 : pendingBroken.n === 2 ? 0.75 : 0.875;
      const total = lastNote.units + n.units;
      const avg = total / 2;
      if (pendingBroken.dir === ">") {
        lastNote.units = avg * (1 + k);
        n.units = avg * (1 - k);
      } else {
        lastNote.units = avg * (1 - k);
        n.units = avg * (1 + k);
      }
      pendingBroken = null;
    }
    cur.notes.push(n);
    lastNote = n;
  }
  if (cur.notes.length) bars.push(cur);
  return bars;
}

/** play out repeats and first/second endings */
function expand(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let repStart = 0;
  let pass = 1;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.startRep && pass === 1) repStart = i;
    if (b.ending && b.ending !== pass) {
      // skip an ending that isn't this pass's; the second pass resets at its end
      continue;
    }
    out.push(b);
    if (b.endRep) {
      if (pass === 1) {
        pass = 2;
        i = repStart - 1;
        continue;
      }
      pass = 1;
      repStart = i + 1;
    } else if (b.ending === 2) {
      pass = 1;
      repStart = i + 1;
    }
    if (out.length > 4000) break;
  }
  return out;
}

/** Move a whole part diatonically so it fits the chanter (Low G…High A), folding what's left over. */
function fitSteps(steps: number[], pipeKey: boolean, warnings: string[]): number {
  if (!steps.length) return 0;
  if (pipeKey) return 0;
  // most notes inside G4..A5; prefer the shift that also puts the most notes on A (the drones)
  let best = 0, bestScore = -Infinity;
  for (let k = -14; k <= 14; k++) {
    let inside = 0, onA = 0;
    for (const s of steps) {
      const p = s + k - PIPE_G4;
      if (p >= 0 && p <= 8) inside++;
      if (p === 1 || p === 8) onA++;
    }
    const score = inside * 10 + onA - Math.abs(k) * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (best) warnings.push(`moved ${best > 0 ? "up" : "down"} ${Math.abs(best)} diatonic step${Math.abs(best) > 1 ? "s" : ""} onto the chanter`);
  return best;
}

function toPipe(step: number, shift: number, folded: { n: number }): number {
  let p = step + shift - PIPE_G4;
  while (p < 0) {
    p += 7;
    folded.n++;
  }
  while (p > 8) {
    p -= 7;
    folded.n++;
  }
  return p;
}

export function parseAbc(src: string): Tune {
  const warnings: string[] = [];
  const lines = src.replace(/\r/g, "").split("\n");
  let title = "", meter: [number, number] = [4, 4], unit = 1 / 8, tempo = 0, key = "HP";
  let unitSet = false;
  const voices: VoiceSrc[] = [];
  let cur: VoiceSrc | null = null;
  const voice = (id: string): VoiceSrc => {
    let v = voices.find((x) => x.name === id);
    if (!v) {
      v = { name: id, body: "" };
      voices.push(v);
    }
    return v;
  };
  let inBody = false;
  for (const raw of lines) {
    const line = raw.replace(/%.*$/, "").trimEnd();
    const h = line.match(/^([A-Za-z]):\s*(.*)$/);
    if (h && !/^[|[]/.test(line)) {
      const [, f, v] = h;
      switch (f) {
        case "T":
          if (!title) title = v.trim();
          break;
        case "M": {
          if (v.trim() === "C") meter = [4, 4];
          else if (v.trim() === "C|") meter = [2, 2];
          else {
            const m = v.match(/(\d+)\s*\/\s*(\d+)/);
            if (m) meter = [Number(m[1]), Number(m[2])];
          }
          break;
        }
        case "L": {
          const x = parseFrac(v);
          if (x) {
            unit = x;
            unitSet = true;
          }
          break;
        }
        case "Q": {
          const m = v.match(/(\d+\s*\/\s*\d+)\s*=\s*(\d+)/);
          if (m) tempo = Number(m[2]) * (parseFrac(m[1])! / 0.25);
          else if (/^\s*\d+\s*$/.test(v)) tempo = Number(v);
          break;
        }
        case "K":
          key = v.trim().split(/\s+/)[0] || "HP";
          inBody = true;
          if (!cur) cur = voice("1");
          break;
        case "V":
          cur = voice(v.trim().split(/\s+/)[0] || String(voices.length + 1));
          inBody = true;
          break;
        default:
          break;
      }
      continue;
    }
    if (!line.trim()) continue;
    if (!cur) cur = voice("1");
    // inline [V:x] switches
    let rest = line;
    for (;;) {
      const m = rest.match(/\[V:\s*([^\]\s]+)[^\]]*\]/);
      if (!m) break;
      cur.body += " " + rest.slice(0, m.index);
      cur = voice(m[1]);
      rest = rest.slice(m.index! + m[0].length);
    }
    cur.body += " " + rest + "\n";
    inBody = true;
  }
  void inBody;
  if (!unitSet) {
    // the ABC default: 1/16 for meters under 3/4, else 1/8
    unit = meter[0] / meter[1] < 0.75 ? 1 / 16 : 1 / 8;
  }
  if (!tempo) tempo = 90;
  const pipeKey = /^h[pP]$/i.test(key) || key === "none" || key === "";
  const beatsPerUnit = unit * 4;

  const parsed = voices
    .filter((v) => v.body.trim())
    .slice(0, 5)
    .map((v) => ({ name: v.name, bars: expand(toBars(tokenize(v.body, warnings))) }));
  if (voices.filter((v) => v.body.trim()).length > 5) warnings.push("more than five parts: the first five are played");
  // one shift for all parts (keeps harmonies intact), from the first part
  const steps = parsed.flatMap((p) => p.bars.flatMap((b) => b.notes.filter((n) => !n.rest).map((n) => n.step)));
  const shift = fitSteps(steps, pipeKey, warnings);
  const folded = { n: 0 };

  let length = 0;
  let barStarts: number[] = [];
  const parts: Part[] = parsed.map((pv, pi) => {
    const notes: (PNote & { tieNext: boolean })[] = [];
    let beat = 0;
    const starts: number[] = [];
    pv.bars.forEach((b, bi) => {
      starts.push(beat);
      for (const rn of b.notes) {
        const dur = rn.units * beatsPerUnit;
        const prev = notes[notes.length - 1];
        if (rn.rest) {
          // pipes can't rest: the last note holds through (a rest at the very start shifts it)
          if (prev) prev.dur += dur;
          beat += dur;
          continue;
        }
        const note = toPipe(rn.step, shift, folded);
        const graces = rn.graces.map((g) => toPipe(g, shift, folded)).filter((g) => g !== note || rn.graces.length > 1);
        if (prev && prev.tieNext && prev.note === note) {
          prev.dur += dur;
          prev.tieNext = rn.tie;
        } else {
          notes.push({ beat, dur, note, graces, bar: bi, tieNext: rn.tie });
        }
        beat += dur;
      }
    });
    if (pi === 0) barStarts = starts;
    length = Math.max(length, beat);
    return { name: pv.name, notes: notes.map(({ beat, dur, note, graces, bar }) => ({ beat, dur, note, graces, bar })) };
  });
  if (folded.n) warnings.push(`${folded.n} note${folded.n > 1 ? "s" : ""} outside the chanter's range folded by an octave`);
  if (!parts.length) warnings.push("no notes found");

  // sections: strains of 8 bars after any pickup; a strain heard before keeps its name (compared
  // on its first six bars, so a different ending doesn't make it new)
  const barLen = (meter[0] / meter[1]) * 4;
  const sections: { beat: number; name: string }[] = [];
  const perPart = 8;
  const anac = barStarts.length > 1 && barStarts[1] - barStarts[0] < barLen * 0.9 ? 1 : 0;
  const mel = parts[0]?.notes ?? [];
  const seen: string[] = [];
  for (let i = anac; i < barStarts.length; i += perPart) {
    const a = barStarts[i], b = barStarts[i + perPart - 2] ?? Infinity;
    const sig = mel.filter((n) => n.beat >= a - 1e-6 && n.beat < b - 1e-6).map((n) => `${(n.beat - a).toFixed(2)}:${n.note}`).join(",");
    let k = seen.indexOf(sig);
    if (k < 0) k = seen.push(sig) - 1;
    sections.push({ beat: a, name: `PART ${k + 1}` });
  }
  return { title: title || "Untitled", meter, tempo, parts, length, bars: barStarts, sections, warnings };
}

// ------------------------------------------------------------------ arranging for the band

export type Role = "melody" | "seconds";

/** a "seconds" note under the tune: the third below where the chanter allows, else a third above */
function secondsNote(m: number): number {
  switch (m) {
    case 0:
      return 2; // Low G → B
    case 1:
      return 3; // Low A → C
    case 2:
      return 4; // B → D
    default:
      return m - 2; // C → Low A, D → B, E → C, F → D, High G → E, High A → F
  }
}

/** the usual single gracenote for a note: G gracenote, except on the high notes */
export function plainGrace(n: number): number[] {
  if (n >= 8) return [7];
  if (n === 7) return [8];
  return [7];
}

/** Harmony from a melody part: pipe-band seconds, one gracenote per note. */
export function makeSeconds(melody: Part): Part {
  const notes: PNote[] = [];
  for (const n of melody.notes) {
    // a run of short notes keeps the harmony still (seconds move slower than the tune)
    const h = secondsNote(n.note);
    const prev = notes[notes.length - 1];
    if (prev && n.dur < 0.5 && prev.beat + prev.dur >= n.beat - 1e-6 && Math.abs(prev.note - h) <= 1 && prev.dur < 1) {
      prev.dur += n.dur;
      continue;
    }
    notes.push({ beat: n.beat, dur: n.dur, note: h, graces: n.graces.length ? plainGrace(h) : [], bar: n.bar });
  }
  return { name: "seconds", notes };
}

export function rolesFor(count: number, seconds: boolean): Role[] {
  const table: Role[][] = [[], ["melody"], ["melody", "seconds"], ["melody", "melody", "seconds"], ["melody", "melody", "melody", "seconds"], ["melody", "melody", "melody", "seconds", "seconds"]];
  return seconds ? table[count] : Array.from({ length: count }, () => "melody");
}

export interface Arranged {
  /** one part per piper (the band's size) */
  parts: Part[];
  roles: string[];
}

/** Give each piper a part: written parts first (V:1..V:5), then melody or seconds. */
export function arrange(t: Tune, count: number, seconds: boolean): Arranged {
  const parts: Part[] = [];
  const roles: string[] = [];
  if (t.parts.length > 1) {
    for (let i = 0; i < count; i++) {
      const p = t.parts[i % t.parts.length];
      parts.push(p);
      roles.push(i < t.parts.length ? `PART ${p.name}` : `PART ${p.name}`);
    }
    return { parts, roles };
  }
  const mel = t.parts[0] ?? { name: "1", notes: [] };
  const sec = makeSeconds(mel);
  rolesFor(count, seconds).forEach((r) => {
    parts.push(r === "melody" ? mel : sec);
    roles.push(r === "melody" ? "MELODY" : "SECONDS");
  });
  return { parts, roles };
}

// ------------------------------------------------------------------ the engine's event list

export interface ScoreOpts {
  /** one gracenote (ms) */
  graceMs: number;
  /** timing spread between pipers (ms, standard deviation) */
  humanize: number;
  /** beats of strike-in before the tune (drones, then the chanter on E) */
  intro: number;
}

/** deterministic normal-ish noise per piper */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Events for the engine: records of [piper, beat, ms, kind, val] (kind 0 note, 1 bag on,
 * 2 bag off). Gracenotes sit just before the beat, taking their time from the note before.
 */
export function buildEvents(t: Tune, arr: Arranged, o: ScoreOpts): Float64Array {
  const rec: number[] = [];
  arr.parts.forEach((part, pi) => {
    const r = rng(0x9e3779b9 ^ (pi * 7919 + 17));
    const gauss = () => (r() + r() + r() - 1.5) * 1.41;
    // the pipe major (piper 1) is the reference; the others follow a few ms either side
    const lag = pi === 0 ? 0 : gauss() * o.humanize * 0.6;
    const g = o.graceMs * (pi === 0 ? 1 : 1 + gauss() * 0.06);
    // strike in: the bag first, the chanter on E (as bands do), drones speak before it
    rec.push(pi, -o.intro, pi * 4 + lag, 1, 1);
    rec.push(pi, -o.intro, pi * 4 + lag - 1, 0, 5);
    for (const n of part.notes) {
      const jit = pi === 0 ? 0 : lag + gauss() * o.humanize * 0.5;
      const k = n.graces.length;
      n.graces.forEach((gr, gi) => rec.push(pi, n.beat, jit - (k - gi) * g, 0, gr));
      rec.push(pi, n.beat, jit, 0, n.note);
    }
    // cut off together on the beat after the last note
    rec.push(pi, t.length, (pi === 0 ? 0 : lag * 0.5), 2, 0);
  });
  return new Float64Array(rec);
}
