/**
 * The bagpipe's shape, shared by the 2D screens, the airflow and the 3D view. World units are
 * metres, origin at the bag's centre, x toward the piper's front, y down (as on the 2D screens);
 * z is depth across the piper's shoulder (3D only: the drones splay across it).
 */
import type { Pt } from "../../ui/render/vector.ts";

export interface Seg {
  s0: number;
  s1: number;
  r0: number;
  r1: number;
}

export interface Tube {
  base: Pt;
  /** angle from straight up (rad, + leans forward) */
  ang: number;
  len: number;
  segs: Seg[];
  /** rings (ferrules, mounts, joints): s and radius */
  rings: [number, number][];
  /** the bore, for the pressure cross-sections */
  bore: [number, number];
  /** 3D: depth at the base, and how far it leans across per metre of length */
  z0: number;
  zLean: number;
}

const R = (s0: number, s1: number, r0: number, r1 = r0): Seg => ({ s0, s1, r0, r1 });

function drone(base: Pt, ang: number, len: number, bass: boolean, z0: number, zLean: number): Tube {
  const segs: Seg[] = [R(0, 0.075, 0.021)];
  const rings: [number, number][] = [[0.075, 0.027]];
  const bellS = len - 0.13;
  if (bass) {
    const j1 = len * 0.36, j2 = len * 0.68;
    segs.push(R(0.075, j1, 0.0105), R(j1 + 0.03, j2, 0.0125), R(j2 + 0.03, bellS, 0.0145));
    rings.push([j1, 0.022], [j1 + 0.03, 0.022], [j2, 0.024], [j2 + 0.03, 0.024]);
  } else {
    const j = len * 0.5;
    segs.push(R(0.075, j, 0.0105), R(j + 0.03, bellS, 0.0135));
    rings.push([j, 0.022], [j + 0.03, 0.022]);
  }
  segs.push(R(bellS, len - 0.02, 0.0145, 0.03), R(len - 0.02, len, 0.033));
  rings.push([bellS, 0.02], [len, 0.033]);
  return { base, ang, len, segs, rings, bore: [0.08, len], z0, zLean };
}

// the drones rise from the top of the bag, over the shoulder, splayed across it
export const BASS = drone([-0.21, -0.178], -0.5, 1.02, true, -0.05, -0.2);
export const TENOR1 = drone([-0.11, -0.19], -0.36, 0.56, false, 0.035, 0.07);
export const TENOR2 = drone([-0.01, -0.188], -0.22, 0.56, false, -0.005, -0.03);
/** tenor, tenor, bass (telemetry order) */
export const DRONES = [TENOR1, TENOR2, BASS];
export const CHANTER: Tube = {
  base: [0.232, 0.122],
  ang: Math.PI - 0.14,
  len: 0.44,
  segs: [R(0, 0.06, 0.023), R(0.06, 0.085, 0.017, 0.013), R(0.085, 0.4, 0.0125, 0.021), R(0.4, 0.44, 0.03, 0.03)],
  rings: [[0.06, 0.025], [0.085, 0.017], [0.4, 0.03], [0.44, 0.03]],
  bore: [0.09, 0.42],
  z0: 0.02,
  zLean: 0,
};
export const BLOWPIPE: Tube = {
  base: [0.15, -0.155],
  ang: 0.72,
  len: 0.34,
  segs: [R(0, 0.05, 0.02), R(0.05, 0.29, 0.0095, 0.0085), R(0.29, 0.34, 0.009, 0.0055)],
  rings: [[0.05, 0.024], [0.29, 0.012]],
  bore: [0.05, 0.3],
  z0: 0.03,
  zLean: 0,
};
/** where the air leaves: the drones (telemetry order), then the chanter */
export const OUTLETS = [TENOR1, TENOR2, BASS, CHANTER];

/** hole positions along the chanter (s), thumb first */
export const HOLES = [0.135, 0.15, 0.185, 0.22, 0.262, 0.297, 0.332, 0.367];

/** holes closed per note: [thumb, L1, L2, L3, R1, R2, R3, R4] (1 = covered) */
export const FINGERING: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1], // Low G
  [1, 1, 1, 1, 1, 1, 1, 0], // Low A
  [1, 1, 1, 1, 1, 1, 0, 1], // B
  [1, 1, 1, 1, 1, 0, 0, 1], // C
  [1, 1, 1, 1, 0, 1, 1, 0], // D
  [1, 1, 1, 0, 1, 1, 1, 0], // E
  [1, 1, 0, 0, 1, 1, 1, 0], // F
  [1, 0, 0, 0, 1, 1, 1, 0], // High G
  [0, 1, 0, 0, 1, 1, 1, 0], // High A
];

/**
 * The bag, as a Highland bag lies under the arm: a full, rounded heel at the back, a long fairly
 * flat top where the drone stocks sit, and a belly tapering forward to the neck the chanter
 * stock comes out of. Cubic Béziers from BAG0.
 */
export const BAG0: Pt = [-0.3, -0.135];
export const BAG: [Pt, Pt, Pt][] = [
  [[-0.2, -0.205], [0.02, -0.215], [0.13, -0.17]],
  [[0.2, -0.14], [0.235, -0.07], [0.245, 0.0]],
  [[0.253, 0.06], [0.27, 0.11], [0.258, 0.14]],
  [[0.245, 0.17], [0.2, 0.162], [0.155, 0.152]],
  [[0.04, 0.2], [-0.12, 0.25], [-0.27, 0.205]],
  [[-0.4, 0.165], [-0.425, 0.02], [-0.395, -0.06]],
  [[-0.372, -0.11], [-0.34, -0.13], [-0.3, -0.135]],
];

export const BAG_CENTRE: Pt = [-0.06, 0.02];

/** the bag's outline as points (for the 3D loft and the airflow's bounds) */
export function bagOutline(steps = 14): Pt[] {
  const out: Pt[] = [];
  let p0 = BAG0;
  for (const [c1, c2, e] of BAG) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
      ]);
    }
    p0 = e;
  }
  return out;
}

/** the bag's top and bottom at x (from the outline), for the 3D loft */
export function bagSpan(outline: Pt[], x: number): [number, number] | null {
  let top = Infinity, bot = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    const y = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    top = Math.min(top, y);
    bot = Math.max(bot, y);
  }
  return top < bot ? [top, bot] : null;
}

export const WORLD = { x0: -0.72, x1: 0.42, y0: -1.1, y1: 0.6 };

export function axisPt(tb: Tube, s: number): Pt {
  return [tb.base[0] + Math.sin(tb.ang) * s, tb.base[1] - Math.cos(tb.ang) * s];
}

/** the 2D normal (to the tube's right as it rises) */
export function normal(tb: Tube): Pt {
  return [Math.cos(tb.ang), Math.sin(tb.ang)];
}

export function radiusAt(tb: Tube, s: number): number {
  for (const sg of tb.segs) if (s >= sg.s0 && s <= sg.s1) return sg.r0 + ((sg.r1 - sg.r0) * (s - sg.s0)) / Math.max(1e-6, sg.s1 - sg.s0);
  return 0.01;
}

/** pressure rms (normalised bore units) → 0..1 display level (loud at the reed, a node at the open end) */
export const lvl = (rms: number, k = 1) => Math.max(0, Math.min(1, Math.sqrt(Math.max(0, rms * k))));
