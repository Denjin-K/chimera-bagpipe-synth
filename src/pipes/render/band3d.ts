/**
 * The band in 3D: the pipers stand in a pipe band's circle, facing in, each set of pipes drawn
 * in glowing lines with CHIMERA's 3D beam kit (beams3d.ts): the tubes as cross-section rings
 * and long lines, the bores' rings lit by their pressure, the bag lofted from its 2D outline and
 * lit by bag pressure, the fingers on the chanter, and the air moving through it all.
 * Three's Y is up; a pipe's own coordinates are those of geometry.ts (x front, y down, z across).
 */
import * as THREE from "three";
import { Beams, Poly } from "../../ui/render/beams3d.ts";
import { V, heat } from "../../ui/colors.ts";
import { BASS, BLOWPIPE, CHANTER, DRONES, FINGERING, HOLES, TENOR1, TENOR2, axisPt, bagOutline, bagSpan, lvl, normal, radiusAt, type Tube } from "./geometry.ts";
import type { PipeView } from "./bagpipe.ts";
import type { Airflow } from "./airflow.ts";

/** the bag's centre above the floor (m): under a standing piper's arm */
const HEIGHT = 1.3;
const RING = 12;

interface Placement {
  x: number;
  z: number;
  /** cos and sin of the turn about Y that takes the pipe's front (+x) to facing the circle's centre */
  c: number;
  s: number;
}

export interface PiperDraw {
  view: PipeView;
  air: Airflow | null;
  active: boolean;
  muted: boolean;
  focus: boolean;
  finger: string;
}

export class Band3D {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
  private readonly beams = new Beams();
  private readonly poly = new Poly();
  private place: Placement[] = [];
  private radius = 0;
  private readonly outline = bagOutline(16);
  /** the bag's loft: x slices with their centre and half-height */
  private readonly loft: { x: number; yc: number; a: number }[] = [];
  private readonly v3 = new THREE.Vector3();
  private readonly tmp: [number, number, number] = [0, 0, 0];

  constructor() {
    this.scene.add(this.beams.group);
    this.scene.fog = new THREE.Fog(0x000000, 4, 14);
    for (let x = -0.4; x <= 0.262; x += 0.034) {
      const sp = bagSpan(this.outline, x);
      if (sp) this.loft.push({ x, yc: (sp[0] + sp[1]) / 2, a: (sp[1] - sp[0]) / 2 });
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.beams.setResolution(w, h);
  }

  /** where everyone stands for a band of n */
  layout(n: number): void {
    this.radius = n <= 1 ? 0 : 0.7 + 0.32 * n;
    this.place = [];
    for (let i = 0; i < 5; i++) {
      // piper 1 at the front right, three-quarters on to the camera; the rest round the circle
      const th = Math.PI / 2 - 0.75 - (2 * Math.PI * i) / Math.max(1, n);
      const x = this.radius * Math.cos(th), z = this.radius * Math.sin(th);
      const yaw = n <= 1 ? 0.6 : Math.PI - th;
      this.place.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw) });
    }
  }

  get circleRadius(): number {
    return this.radius;
  }

  /** a pipe-local point (geometry.ts frame) of piper i, into three's world */
  private w(i: number, lx: number, ly: number, lz: number): [number, number, number] {
    const p = this.place[i];
    const t = this.tmp;
    t[0] = p.x + lx * p.c + lz * p.s;
    t[1] = HEIGHT - ly;
    t[2] = p.z - lx * p.s + lz * p.c;
    return t;
  }

  /** the bag's centre of piper i, in world coordinates */
  anchor(i: number, up = 0): THREE.Vector3 {
    const [x, y, z] = this.w(i, -0.05, -up, 0);
    return new THREE.Vector3(x, y, z);
  }

  project(p: THREE.Vector3, w: number, h: number): [number, number, boolean] {
    const v = this.v3.copy(p).project(this.camera);
    return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z < 1];
  }

  private circle(i: number, cx: number, cy: number, cz: number, u: number[], v: number[], r: number, color: string, width: number, alpha: number): void {
    const p = this.poly.reset();
    for (let k = 0; k <= RING; k++) {
      const a = (k / RING) * Math.PI * 2;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      const [x, y, z] = this.w(i, cx + u[0] * ca + v[0] * sa, cy + u[1] * ca + v[1] * sa, cz + u[2] * ca + v[2] * sa);
      p.p(x, y, z);
    }
    this.beams.poly(p, color, width, { alpha });
  }

  /** the tube's axis frame at s: a point, and two unit vectors across it */
  private frame(tb: Tube, s: number): { c: number[]; u: number[]; v: number[]; d: number[] } {
    const a = axisPt(tb, s);
    // direction along the tube, with its lean across the shoulder
    const d = [Math.sin(tb.ang), -Math.cos(tb.ang), tb.zLean];
    const dl = Math.hypot(d[0], d[1], d[2]);
    d[0] /= dl;
    d[1] /= dl;
    d[2] /= dl;
    const n = normal(tb);
    const u = [n[0], n[1], 0];
    // v = d × u
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    return { c: [a[0], a[1], tb.z0 + tb.zLean * s], u, v, d };
  }

  private tube(i: number, tb: Tube, rms: ArrayLike<number> | null, gain: number, A: number): void {
    const col = V.blue;
    // rings at every section's ends and at the ferrules and mounts
    const ss = new Set<number>();
    for (const sg of tb.segs) {
      ss.add(sg.s0);
      ss.add(sg.s1);
    }
    for (const s of ss) {
      const f = this.frame(tb, s);
      this.circle(i, f.c[0], f.c[1], f.c[2], f.u, f.v, radiusAt(tb, Math.min(tb.len, s + 1e-4)), col, 1.05, A * 0.8);
    }
    for (const [s, r] of tb.rings) {
      const f = this.frame(tb, s);
      this.circle(i, f.c[0], f.c[1], f.c[2], f.u, f.v, r, col, 1.3, A);
    }
    // long lines down each section
    for (const sg of tb.segs) {
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + 0.4;
        const p = this.poly.reset();
        for (let j = 0; j <= 2; j++) {
          const s = sg.s0 + ((sg.s1 - sg.s0) * j) / 2;
          const r = sg.r0 + ((sg.r1 - sg.r0) * j) / 2;
          const f = this.frame(tb, s);
          const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
          const [x, y, z] = this.w(i, f.c[0] + f.u[0] * ca + f.v[0] * sa, f.c[1] + f.u[1] * ca + f.v[1] * sa, f.c[2] + f.u[2] * ca + f.v[2] * sa);
          p.p(x, y, z);
        }
        this.beams.poly(p, V.blueMid, 0.85, { alpha: A * 0.75 });
      }
    }
    // the bore, its rings lit by the pressure in the waveguide
    if (rms) {
      const [b0, b1] = tb.bore;
      const N = rms.length;
      for (let q = 0; q < N * 2; q++) {
        const u = q / (N * 2 - 1);
        const x = u * (N - 1), j = Math.min(N - 2, Math.floor(x));
        const L = lvl(rms[j] + (rms[j + 1] - rms[j]) * (x - j), gain);
        if (L < 0.04) continue;
        const s = b0 + (b1 - b0) * u;
        const f = this.frame(tb, s);
        this.circle(i, f.c[0], f.c[1], f.c[2], f.u, f.v, radiusAt(tb, s) * 0.72, heat(L), 1.05, A * (0.3 + 0.7 * L));
      }
    }
  }

  private bag(i: number, pressure: number, A: number, focus: boolean): void {
    const sw = 0.95 + 0.05 * Math.min(1.25, pressure);
    const bl = Math.max(0, Math.min(1, pressure / 1.2));
    const K = 16;
    // cross-section rings, lit by the pressure inside
    for (const sl of this.loft) {
      const p = this.poly.reset();
      for (let k = 0; k <= K; k++) {
        const a = (k / K) * Math.PI * 2;
        const [x, y, z] = this.w(i, sl.x * sw, (sl.yc + Math.cos(a) * sl.a) * sw, Math.sin(a) * sl.a * 0.78 * sw);
        p.p(x, y, z);
      }
      this.beams.poly(p, bl > 0.02 ? heat(0.15 + bl * 0.7) : V.blueDim, 0.85, { alpha: A * (bl > 0.02 ? 0.3 + 0.4 * bl : 0.45) });
    }
    // the skin's long lines, the profile brightest
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const p = this.poly.reset();
      for (const sl of this.loft) {
        const [x, y, z] = this.w(i, sl.x * sw, (sl.yc + Math.cos(a) * sl.a) * sw, Math.sin(a) * sl.a * 0.78 * sw);
        p.p(x, y, z);
      }
      const profile = k === 0 || k === 5;
      this.beams.poly(p, V.blue, profile ? 1.3 : 0.85, { alpha: A * (profile ? 1 : 0.55), hot: profile && focus });
    }
    // the side outline at the middle, as on the flat screen
    const p = this.poly.reset();
    for (const o of this.outline) {
      const [x, y, z] = this.w(i, o[0] * sw, o[1] * sw, 0);
      p.p(x, y, z);
    }
    this.beams.poly(p, V.blue, 1.05, { alpha: A * 0.5, close: true });
  }

  private chanterHoles(i: number, note: number, finger: string, sounding: boolean, A: number): void {
    const fing = FINGERING[Math.max(0, Math.min(8, note))];
    HOLES.forEach((s, k) => {
      const f = this.frame(CHANTER, s);
      const r = radiusAt(CHANTER, s);
      // the front holes face forward (against the normal); the thumb hole is on the back
      const side = k === 0 ? 1.05 : -1.05;
      const closed = fing[k] === 1;
      // a small circle lying on the chanter's surface: across it (v) and along it (d)
      this.circle(i, f.c[0] + f.u[0] * r * side, f.c[1] + f.u[1] * r * side, f.c[2] + f.u[2] * r * side, f.v, f.d, 0.0055, closed ? finger : sounding ? V.amber : V.blueMid, closed ? 2.1 : 1.05, A);
    });
  }

  private cords(i: number, A: number): void {
    const pts = (tb: Tube, s: number) => {
      const a = axisPt(tb, s);
      return [a[0], a[1], tb.z0 + tb.zLean * s];
    };
    const seg = (a: number[], b: number[], sag: number) => {
      const p = this.poly.reset();
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const [x, y, z] = this.w(i, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t);
        p.p(x, y, z);
      }
      this.beams.poly(p, V.pink, 0.85, { alpha: A * 0.55 });
    };
    const b = pts(BASS, 0.62), t1 = pts(TENOR1, 0.4), t2 = pts(TENOR2, 0.4);
    seg(b, t1, 0.05);
    seg(t1, t2, 0.03);
  }

  private air(i: number, af: Airflow, A: number): void {
    const bands = [0.5, 0.78, 1];
    for (const p of af.ps) {
      if (p.leg < 0 || !Number.isFinite(p.x)) continue;
      const band = bands[Math.min(2, Math.floor(p.b * 3))];
      const [x1, y1, z1] = this.w(i, p.x, p.y, p.z);
      let x0 = x1, y0 = y1 + 0.003, z0 = z1;
      if (Number.isFinite(p.px)) {
        const q = this.w(i, p.px, p.py, p.pz);
        if (Math.abs(q[0] - x1) + Math.abs(q[1] - y1) + Math.abs(q[2] - z1) < 0.08) {
          x0 = q[0];
          y0 = q[1];
          z0 = q[2];
        }
      }
      this.beams.seg(x0, y0, z0, x1, y1, z1, "#ffe2a8", 2.1, band * A);
    }
  }

  /** the ground: the band's circle and a polar grid, as on a plotting table */
  private floor(focusAt: number, n: number): void {
    const R = Math.max(1.2, this.radius);
    for (const [r, a] of [[R, 0.7], [R + 0.6, 0.45], [R + 1.4, 0.3], [0.35, 0.4]] as const) {
      const p = this.poly.reset();
      for (let k = 0; k <= 72; k++) {
        const t = (k / 72) * Math.PI * 2;
        p.p(r * Math.cos(t), 0, r * Math.sin(t));
      }
      this.beams.poly(p, V.blueDim, 0.85, { alpha: a });
    }
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2;
      const r0 = k % 6 === 0 ? 0.35 : R + 0.6;
      this.beams.seg(r0 * Math.cos(t), 0, r0 * Math.sin(t), (R + 1.4) * Math.cos(t), 0, (R + 1.4) * Math.sin(t), V.blueDim, 0.6, 0.35);
    }
    // a ring at each piper's feet; the one shown large in white
    for (let i = 0; i < n; i++) {
      const pl = this.place[i];
      const p = this.poly.reset();
      for (let k = 0; k <= 24; k++) {
        const t = (k / 24) * Math.PI * 2;
        p.p(pl.x + 0.32 * Math.cos(t), 0, pl.z + 0.32 * Math.sin(t));
      }
      this.beams.poly(p, i === focusAt ? V.white : V.blueMid, i === focusAt ? 1.3 : 0.85, { alpha: i === focusAt ? 0.9 : 0.5 });
    }
  }

  update(pipers: PiperDraw[], n: number, focus: number): void {
    const b = this.beams;
    b.begin();
    this.floor(focus, n);
    for (let i = 0; i < Math.min(n, pipers.length); i++) {
      const pd = pipers[i];
      const A = pd.muted ? 0.35 : 1;
      const v = pd.view;
      this.bag(i, v.bag, A, pd.focus);
      DRONES.forEach((tb, k) => this.tube(i, tb, v.drRms[k], 1.0, A));
      this.tube(i, BLOWPIPE, null, 1, A);
      this.tube(i, CHANTER, v.chRms, 1.6, A);
      this.chanterHoles(i, v.note, pd.finger, v.chAmp > 0.05, A);
      this.cords(i, A);
      if (pd.air) this.air(i, pd.air, A);
    }
    b.end();
    // fog follows the camera's distance to the band
    const d = this.camera.position.distanceTo(new THREE.Vector3(0, HEIGHT * 0.6, 0));
    const fog = this.scene.fog as THREE.Fog;
    fog.near = Math.max(0.5, d - this.radius - 1.5);
    fog.far = d + this.radius + 6;
  }

  /** the camera's starting place: up and back, the whole circle in view */
  home(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const R = Math.max(0.9, this.radius);
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    // the circle's width, and the pipes' height (bass drone tops to chanter soles), in view
    const fit = Math.max((R + 1.15) / (half * Math.min(1.2, this.camera.aspect)), 1.25 / half);
    const d = Math.max(2.6, Math.min(18, fit * 1.02));
    const el = 0.24;
    return { pos: new THREE.Vector3(0, 1.3 + Math.sin(el) * d, Math.cos(el) * d), target: new THREE.Vector3(0, 1.32, 0) };
  }

  dispose(): void {
    this.beams.dispose();
  }
}
