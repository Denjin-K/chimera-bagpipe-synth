/**
 * The score as a pipe roll: nine rows (Low G … High A) scrolling past a fixed playhead. Each
 * distinct part is drawn once in its role's colour; gracenotes are the short flicks before a
 * note, as fast as the band plays them.
 */
import { V, SLOTS, mix } from "../../ui/colors.ts";
import { beam, dot, label, seg } from "../../ui/render/vector.ts";
import type { Arranged, Part, Tune } from "../abc.ts";
import { PIPE_SHORT } from "../abc.ts";

export const ROLE_COLOR = (role: string, i: number): string => (role === "SECONDS" ? SLOTS[2] : role === "MELODY" ? SLOTS[0] : [SLOTS[0], SLOTS[2], SLOTS[1], SLOTS[3], V.amber][i % 5]);

export function drawRoll(ctx: CanvasRenderingContext2D, w: number, h: number, tune: Tune, arr: Arranged, beat: number, graceMs: number, tempo: number, pipers: number): void {
  const left = 34, right = 10, top = 22, bottom = 12;
  const rows = 9;
  const rowH = (h - top - bottom) / rows;
  const span = Math.max(6, Math.min(14, (w - left) / 64));
  const ahead = span * 0.72, behind = span * 0.28;
  const px = (w - left - right) / span;
  const x0 = left + behind * px;
  const X = (b: number) => x0 + (b - beat) * px;
  const Y = (n: number) => top + (8 - n + 0.5) * rowH;

  // rows and their names
  for (let n = 0; n < rows; n++) {
    const y = Y(n);
    seg(ctx, left, y, w - right, y, V.frame, 1, { alpha: n === 1 || n === 8 ? 1 : 0.7 });
    label(ctx, PIPE_SHORT[n], left - 12, y + 4, { size: 11, color: n === 1 || n === 8 ? V.blue : V.blueMid, align: "center" });
  }
  // bar lines, bar numbers, sections
  const b0 = beat - behind - 1, b1 = beat + ahead + 1;
  const anac = tune.bars.length > 1 && tune.bars[1] - tune.bars[0] < (tune.meter[0] / tune.meter[1]) * 4 * 0.9 ? 1 : 0;
  tune.bars.forEach((bb, i) => {
    if (bb < b0 || bb > b1) return;
    const x = X(bb);
    seg(ctx, x, top, x, h - bottom, V.blueDim, 1, { alpha: 0.6 });
    if (i >= anac) label(ctx, String(i - anac + 1), x + 4, top - 7, { size: 9, color: V.blueMid });
  });
  for (const s of tune.sections) {
    if (s.beat < b0 - 40 || s.beat > b1) continue;
    const x = Math.max(left + 2, X(s.beat));
    label(ctx, s.name, x + 26, top - 7, { size: 9, color: V.white, alpha: 0.75 });
  }
  // the parts: draw each distinct part once (unison pipers share a line)
  const seen = new Map<Part, number>();
  arr.parts.slice(0, pipers).forEach((p, i) => {
    if (!seen.has(p)) seen.set(p, i);
  });
  const graceBeats = (graceMs / 1000) * (tempo / 60);
  for (const [part, i] of seen) {
    const col = ROLE_COLOR(arr.roles[i], i);
    const off = seen.size > 1 ? (i === 0 ? -1.6 : 1.6) : 0;
    for (const n of part.notes) {
      if (n.beat + n.dur < b0 || n.beat > b1) continue;
      const xa = X(n.beat), xb = X(n.beat + n.dur);
      const y = Y(n.note) + off;
      const now = beat >= n.beat - 1e-6 && beat < n.beat + n.dur;
      const past = beat >= n.beat + n.dur;
      const p = new Path2D();
      p.moveTo(xa + 1, y);
      p.lineTo(xb - 2, y);
      beam(ctx, p, now ? mix(col, "#ffffff", 0.35) : col, now ? 3.2 : 2.2, { alpha: past ? 0.35 : 1, hot: now });
      // gracenotes: flicks leading into the note
      const k = n.graces.length;
      let prevX = xa, prevY = y;
      for (let gi = k - 1; gi >= 0; gi--) {
        const gx = xa - (k - gi) * graceBeats * px;
        const gy = Y(n.graces[gi]) + off;
        seg(ctx, gx, gy, prevX, prevY, col, 0.8, { alpha: past ? 0.15 : 0.4 });
        dot(ctx, gx, gy, 1.6, col, past ? 0.3 : 0.9);
        prevX = gx;
        prevY = gy;
      }
    }
  }
  // the playhead
  seg(ctx, x0, top - 2, x0, h - bottom + 2, V.white, 1.4, { alpha: 0.85 });
  dot(ctx, x0, top - 2, 2.5, V.white, 0.9);
}
