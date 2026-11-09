/**
 * The bagpipe as a vector drawing, animated from the engine's telemetry: the bag's
 * cross-section lines lit by bag pressure, the bores' cross-sections lit by the pressure in each
 * waveguide, the chanter's fingering, and sound leaving the drone tops and the chanter sole.
 * World units are metres, origin at the bag's centre, y down.
 */
import { V, SLOTS, heat, mix } from "../../ui/colors.ts";
import { beam, beamPts, dot, label, ring, seg, type Pt } from "../../ui/render/vector.ts";
import { audio, CH_POS, DR_POS, T } from "../audio.ts";
import { PIPE_NAMES } from "../abc.ts";
import { BAG, BAG0, BASS, BLOWPIPE, CHANTER, DRONES, FINGERING, HOLES, TENOR1, TENOR2, axisPt, lvl, normal, radiusAt, type Tube } from "./geometry.ts";
import { drawAirflow, type Airflow, type FlowInput } from "./airflow.ts";

export { WORLD } from "./geometry.ts";

export interface PipeView {
  bag: number;
  bagOn: boolean;
  note: number;
  chAmp: number;
  chLevel: number;
  chF: number;
  drLevel: number[];
  drAmp: number[];
  chRms: Float32Array;
  drRms: Float32Array[];
  tenorF: number;
  bassF: number;
  mute: boolean;
  dronesOn: boolean;
  /** flow through each reed (tenor, tenor, bass, chanter) and the piper's breath */
  flows: number[];
  blow: number;
}

export function emptyView(): PipeView {
  return { bag: 0, bagOn: false, note: 1, chAmp: 0, chLevel: 0, chF: 0, drLevel: [0, 0, 0], drAmp: [0, 0, 0], chRms: new Float32Array(CH_POS), drRms: [new Float32Array(DR_POS), new Float32Array(DR_POS), new Float32Array(DR_POS)], tenorF: 0, bassF: 0, mute: false, dronesOn: true, flows: [0, 0, 0, 0], blow: 0 };
}

/** fill `v` from the latest telemetry (no allocation) */
export function readView(i: number, v: PipeView): PipeView {
  const g = (k: number) => audio.get(i, k);
  v.bag = g(T.bag);
  v.bagOn = g(T.bagOn) > 0.5;
  v.note = Math.round(g(T.note));
  v.chAmp = g(T.chAmp);
  v.chLevel = g(T.chLevel);
  v.chF = g(T.chF);
  for (let k = 0; k < 3; k++) {
    v.drLevel[k] = g(T.drLevel + k);
    v.drAmp[k] = g(T.drAmp + k);
    for (let j = 0; j < DR_POS; j++) v.drRms[k][j] = g(T.drRms + k * DR_POS + j);
  }
  for (let j = 0; j < CH_POS; j++) v.chRms[j] = g(T.chRms + j);
  v.tenorF = g(T.tenorF);
  v.bassF = g(T.bassF);
  v.mute = g(T.mute) > 0.5;
  v.dronesOn = g(T.dronesOn) > 0.5;
  v.flows[3] = g(T.flow);
  for (let k = 0; k < 3; k++) v.flows[k] = g(T.flow + 1 + k);
  v.blow = g(T.blow);
  return v;
}

// ------------------------------------------------------------------ drawing

export interface DrawOpts {
  /** labels on the parts, the big readouts */
  detail: boolean;
  /** brightness of the structure (dim for an inactive piper) */
  alpha: number;
  /** role colour of the fingers */
  finger: string;
  t: number;
  /** the air moving through it */
  air?: Airflow;
}

/** the airflow's inputs from a pipe's telemetry */
export function flowInput(v: PipeView, f: FlowInput): FlowInput {
  f.bag = v.bag;
  f.bagOn = v.bagOn;
  f.blow = v.blow;
  for (let k = 0; k < 4; k++) f.flows[k] = v.flows[k];
  f.note = v.note;
  f.chAmp = v.chAmp;
  return f;
}

type Map = (p: Pt) => Pt;

function tubeOutline(ctx: CanvasRenderingContext2D, tb: Tube, m: Map, sc: number, color: string, alpha: number) {
  const n = normal(tb);
  for (const sg of tb.segs) {
    const steps = 4;
    const left: Pt[] = [], right: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const s = sg.s0 + ((sg.s1 - sg.s0) * i) / steps;
      const r = sg.r0 + ((sg.r1 - sg.r0) * i) / steps;
      const a = axisPt(tb, s);
      left.push(m([a[0] - n[0] * r, a[1] - n[1] * r]));
      right.push(m([a[0] + n[0] * r, a[1] + n[1] * r]));
    }
    beamPts(ctx, left, color, Math.max(0.8, sc * 0.0016), { alpha });
    beamPts(ctx, right, color, Math.max(0.8, sc * 0.0016), { alpha });
  }
  for (const [s, r] of tb.rings) {
    const a = axisPt(tb, s);
    const p0 = m([a[0] - n[0] * r, a[1] - n[1] * r]), p1 = m([a[0] + n[0] * r, a[1] + n[1] * r]);
    seg(ctx, p0[0], p0[1], p1[0], p1[1], color, Math.max(0.9, sc * 0.0022), { alpha });
  }
}

/** the bore's cross-section lines, lit by pressure */
function boreLines(ctx: CanvasRenderingContext2D, tb: Tube, m: Map, sc: number, rms: ArrayLike<number>, gain: number, alpha: number) {
  const n = normal(tb);
  const [b0, b1] = tb.bore;
  const N = rms.length;
  const k = 2;
  for (let i = 0; i < N * k; i++) {
    const u = i / (N * k - 1);
    const s = b0 + (b1 - b0) * u;
    const r = radiusAt(tb, s) * 0.72;
    // interpolate the rms samples
    const x = u * (N - 1);
    const j = Math.min(N - 2, Math.floor(x));
    const v = rms[j] + (rms[j + 1] - rms[j]) * (x - j);
    const L = lvl(v, gain);
    if (L < 0.03) continue;
    const a = axisPt(tb, s);
    const p0 = m([a[0] - n[0] * r, a[1] - n[1] * r]), p1 = m([a[0] + n[0] * r, a[1] + n[1] * r]);
    seg(ctx, p0[0], p0[1], p1[0], p1[1], heat(L), Math.max(1, sc * 0.0024), { alpha: alpha * (0.35 + 0.65 * L) });
  }
}

export function drawBagpipe(ctx: CanvasRenderingContext2D, cx: number, cy: number, sc: number, v: PipeView, o: DrawOpts): void {
  const m: Map = (p) => [cx + p[0] * sc, cy + p[1] * sc];
  const A = o.alpha;
  const lw = Math.max(1, sc * 0.0019);
  const line = mix(V.blueMid, V.blue, 0.5);

  // ---- the bag: outline swells a little with pressure; cross-sections lit by it
  const swell = 0.95 + 0.05 * Math.min(1.25, v.bag);
  const bm: Map = (p) => m([p[0] * swell, p[1] * swell]);
  const path = new Path2D();
  const s0 = bm(BAG0);
  path.moveTo(s0[0], s0[1]);
  for (const [c1, c2, e] of BAG) {
    const a = bm(c1), b = bm(c2), c = bm(e);
    path.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1]);
  }
  path.closePath();
  ctx.save();
  ctx.clip(path);
  const bl = Math.max(0, Math.min(1, v.bag / 1.2));
  for (let y = -0.23; y < 0.26; y += 0.026) {
    const p0 = m([-0.45, y]), p1 = m([0.3, y + 0.03]);
    seg(ctx, p0[0], p0[1], p1[0], p1[1], bl > 0.02 ? heat(0.15 + bl * 0.7) : V.blueDim, Math.max(0.8, sc * 0.0014), { alpha: A * (bl > 0.02 ? 0.22 + 0.33 * bl : 0.3) });
  }
  ctx.restore();
  beam(ctx, path, V.blue, lw * 1.25, { alpha: A, hot: o.detail });
  // the bag cover's welt along the bottom
  const welt = new Path2D();
  const w0 = bm([-0.34, 0.135]), w1 = bm([-0.06, 0.245]), w2 = bm([0.17, 0.14]);
  welt.moveTo(w0[0], w0[1]);
  welt.quadraticCurveTo(w1[0], w1[1], w2[0], w2[1]);
  beam(ctx, welt, V.blueDim, lw, { alpha: A * 0.8, dash: [sc * 0.008, sc * 0.008] });

  // ---- drones (bores lit by their waveguides), cords, sound from the tops
  DRONES.forEach((tb, k) => {
    tubeOutline(ctx, tb, m, sc, line, A);
    boreLines(ctx, tb, m, sc, v.drRms[k], 1.0, A);
  });
  // cords and tassels between the drones
  const cord = (a: Pt, b: Pt, sag: number) => {
    const p = new Path2D();
    const pa = m(a), pb = m(b), mid = m([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag]);
    p.moveTo(pa[0], pa[1]);
    p.quadraticCurveTo(mid[0], mid[1], pb[0], pb[1]);
    beam(ctx, p, V.pink, Math.max(0.8, sc * 0.0014), { alpha: A * 0.55 });
  };
  const bc = axisPt(BASS, 0.62), t1 = axisPt(TENOR1, 0.4), t2 = axisPt(TENOR2, 0.4);
  cord(bc, t1, 0.05);
  cord(t1, t2, 0.03);
  const tas = m([(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2 + 0.045]);
  for (let i = -2; i <= 2; i++) seg(ctx, tas[0], tas[1], tas[0] + i * sc * 0.006, tas[1] + sc * 0.05, V.pink, Math.max(0.7, sc * 0.0012), { alpha: A * 0.45 });

  // ---- blowpipe
  tubeOutline(ctx, BLOWPIPE, m, sc, line, A);

  // ---- chanter: bore, holes and fingers, sound from the sole
  tubeOutline(ctx, CHANTER, m, sc, line, A);
  boreLines(ctx, CHANTER, m, sc, v.chRms, 1.6, A);
  const fing = FINGERING[Math.max(0, Math.min(8, v.note))];
  const n = normal(CHANTER);
  const sounding = v.chAmp > 0.05;
  HOLES.forEach((s, i) => {
    const a = axisPt(CHANTER, s);
    const r = radiusAt(CHANTER, s);
    // the thumb hole is on the back: drawn beside the chanter
    const p = i === 0 ? m([a[0] - n[0] * (r + 0.02), a[1] - n[1] * (r + 0.02)]) : m(a);
    const hr = Math.max(1.6, sc * (i === 0 ? 0.0055 : 0.0062));
    if (fing[i]) {
      dot(ctx, p[0], p[1], hr * 1.05, o.finger, A);
      ring(ctx, p[0], p[1], hr * 1.7, o.finger, Math.max(0.7, sc * 0.0012), { alpha: A * 0.5 });
    } else {
      ring(ctx, p[0], p[1], hr, sounding ? V.amber : V.blueMid, Math.max(0.8, sc * 0.0013), { alpha: A });
      if (sounding && o.detail) dot(ctx, p[0], p[1], hr * 0.45, V.amber, A * 0.8 * Math.min(1, v.chAmp));
    }
  });
  // ---- the air: in at the blowpipe, through the bag, out of the reeds' pipes
  if (o.air) drawAirflow(ctx, o.air, (x, y) => [cx + x * sc, cy + y * sc], Math.max(0.7, sc * (o.detail ? 0.0024 : 0.0032)), A);

  if (o.detail) drawLabels(ctx, m, sc, A, v);
}

function callout(ctx: CanvasRenderingContext2D, m: Map, at: Pt, to: Pt, text: string, sub: string, sc: number, A: number, align: CanvasTextAlign) {
  const a = m(at), b = m(to);
  seg(ctx, a[0], a[1], b[0], b[1], V.blueDim, 1, { alpha: A * 0.9 });
  dot(ctx, a[0], a[1], 2, V.blueMid, A);
  const size = Math.max(9, Math.min(12, sc * 0.016));
  const dx = align === "right" ? -4 : 4;
  label(ctx, text, b[0] + dx, b[1] - 2, { size, color: V.blue, align, alpha: A });
  if (sub) label(ctx, sub, b[0] + dx, b[1] + size + 1, { size: size * 0.85, color: V.blueMid, align, alpha: A });
}

function drawLabels(ctx: CanvasRenderingContext2D, m: Map, sc: number, A: number, v: PipeView) {
  const hz = (f: number) => (f > 1 ? `${f.toFixed(1)} HZ` : "");
  callout(ctx, m, axisPt(BASS, 0.9), [-0.4, -1.05], "BASS DRONE", hz(v.bassF), sc, A, "left");
  callout(ctx, m, axisPt(TENOR2, 0.5), [0.12, -0.72], "TENOR DRONES", hz(v.tenorF), sc, A, "left");
  callout(ctx, m, axisPt(BLOWPIPE, 0.2), [0.36, -0.16], "BLOWPIPE", "", sc, A, "left");
  callout(ctx, m, [-0.3, 0.12], [-0.42, 0.3], "BAG", v.bag > 0.01 ? `${(v.bag * 100).toFixed(0)} % PRESSURE` : "EMPTY", sc, A, "right");
  callout(ctx, m, axisPt(CHANTER, 0.3), [0.4, 0.3], "CHANTER", v.chAmp > 0.05 ? PIPE_NAMES[v.note] : "", sc, A, "left");
}

/** the four slot readouts under a large pipe */
export function drawReadouts(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, v: PipeView, beatsLabel: string): void {
  const cols = [
    { k: "NOTE", val: v.chAmp > 0.05 ? PIPE_NAMES[v.note] : "—", c: SLOTS[0] },
    { k: "PITCH", val: v.chAmp > 0.05 ? `${v.chF.toFixed(0)}` : "—", unit: "HZ", c: SLOTS[1] },
    { k: "BAG", val: `${Math.round(v.bag * 100)}`, unit: "%", c: SLOTS[2] },
    { k: beatsLabel ? "BAR" : "DRONES", val: beatsLabel || (v.drAmp[2] > 0.3 ? "A" : "—"), c: SLOTS[3] },
  ];
  const cw = w / 4;
  const big = Math.max(18, Math.min(36, cw * 0.2));
  cols.forEach((col, i) => {
    const cxx = x + cw * i + cw / 2;
    label(ctx, col.k, cxx, y, { size: 10, color: col.c, align: "center", alpha: 0.8, ls: 0.2 });
    label(ctx, col.val, cxx, y + big + 6, { size: big, color: col.c, align: "center", weight: "m", ls: 0.04 });
    if (col.unit) label(ctx, col.unit, cxx, y + big + 22, { size: 9, color: col.c, align: "center", alpha: 0.7 });
  });
}
