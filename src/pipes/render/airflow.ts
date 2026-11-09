/**
 * Airflow as particles, after CHIMERA's airway streaks: breath enters at the blowpipe's
 * mouthpiece (in pulses, with the piper's breathing), drifts slowly through the bag, and leaves
 * through the four reeds, up the drones and down the chanter, at speeds set by the engine's flow
 * through each reed; out of the drone tops, the chanter sole and its open holes it spills into
 * the air and fades. Positions are world metres (geometry.ts), with a depth for the 3D view.
 */
import { BAG_CENTRE, BLOWPIPE, FINGERING, HOLES, OUTLETS, axisPt, normal, radiusAt } from "./geometry.ts";

const BLOW = 0, BAG = 1, TUBE = 2, FREE = 3;
/** nominal mean flow through a reed (engine units): the drones', and the chanter's */
const NOMINAL = [0.1, 0.1, 0.1, 0.19];

export interface Particle {
  leg: number;
  out: number;
  /** progress: metres along the blowpipe or tube, 0..1 through the bag */
  s: number;
  off: number;
  dz: number;
  /** the bag leg's curve control point */
  cx: number;
  cy: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  wait: number;
  /** brightness 0..1 (speed and life) */
  b: number;
}

export interface FlowInput {
  bag: number;
  bagOn: boolean;
  blow: number;
  /** flow through each reed: tenor, tenor, bass, chanter */
  flows: number[];
  note: number;
  chAmp: number;
}

let seed = 0x2545f491;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export class Airflow {
  readonly ps: Particle[] = [];
  private norm = [0, 0, 0, 0];

  constructor(n: number) {
    for (let i = 0; i < n; i++)
      this.ps.push({ leg: -1, out: 0, s: 0, off: 0, dz: 0, cx: 0, cy: 0, x: NaN, y: NaN, z: 0, px: NaN, py: NaN, pz: 0, vx: 0, vy: 0, vz: 0, life: 0, wait: rnd() * 2, b: 0 });
  }

  private spawn(p: Particle, f: FlowInput): void {
    // which reed this breath leaves by, in proportion to the flow through it
    let tot = 0;
    for (let k = 0; k < 4; k++) tot += Math.max(0, f.flows[k]);
    let r = rnd() * tot, out = 3;
    for (let k = 0; k < 4; k++) {
      r -= Math.max(0, f.flows[k]);
      if (r <= 0) {
        out = k;
        break;
      }
    }
    p.leg = BLOW;
    p.out = out;
    p.s = 0;
    p.off = rnd() * 2 - 1;
    p.dz = rnd() * 2 - 1;
    // a wide swirl through the bag: the control point wanders round the bag's middle
    p.cx = BAG_CENTRE[0] + (rnd() - 0.5) * 0.42;
    p.cy = BAG_CENTRE[1] + (rnd() - 0.3) * 0.26;
    p.life = 1;
    p.px = NaN;
  }

  private last = 0;

  /** Advance to `now` (ms), in steps of at most 40 ms, so a slow frame rate moves the air as far. */
  advance(now: number, f: FlowInput): void {
    let left = this.last ? Math.min(0.4, (now - this.last) / 1000) : 0.016;
    this.last = now;
    while (left > 1e-4) {
      const dt = Math.min(0.04, left);
      this.update(dt, f);
      left -= dt;
    }
  }

  update(dt: number, f: FlowInput): void {
    for (let k = 0; k < 4; k++) this.norm[k] = Math.max(0, Math.min(1.6, f.flows[k] / NOMINAL[k]));
    const sounding = this.norm.some((x) => x > 0.05);
    const blowing = f.bagOn && f.bag > 0.15;
    const fing = FINGERING[Math.max(0, Math.min(8, f.note))];
    const topHole = fing.findIndex((c, i) => i > 0 && !c);
    for (const p of this.ps) {
      if (p.leg < 0) {
        p.wait -= dt * (0.4 + 1.6 * f.blow);
        if (p.wait <= 0 && blowing && sounding) this.spawn(p, f);
        else continue;
      }
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      if (p.leg === BLOW) {
        // breath comes in pulses: fast while the piper blows, a trickle between breaths
        const v = blowing ? 0.18 + 1.1 * f.blow : 0;
        p.s += v * dt;
        if (!blowing) p.life -= dt * 1.5;
        if (p.s >= BLOWPIPE.len - 0.02) {
          p.leg = BAG;
          p.s = 0;
        } else {
          const s = BLOWPIPE.len - p.s;
          const a = axisPt(BLOWPIPE, s), n = normal(BLOWPIPE), r = radiusAt(BLOWPIPE, s) * 0.6 * p.off;
          p.x = a[0] + n[0] * r;
          p.y = a[1] + n[1] * r;
          p.z = BLOWPIPE.z0 + p.dz * radiusAt(BLOWPIPE, s) * 0.6;
          p.b = 0.45 + 0.55 * f.blow;
        }
      }
      if (p.leg === BAG) {
        // slow through the bag; it empties faster the more the reeds draw
        const draw = 0.045 + 0.1 * this.norm[p.out] + 0.05 * Math.min(1, f.bag);
        p.s += (draw * dt) / 0.45;
        const o = OUTLETS[p.out];
        const t = Math.min(1, p.s), u = 1 - t;
        const a = BLOWPIPE.base, e = o.base;
        p.x = u * u * a[0] + 2 * u * t * p.cx + t * t * e[0];
        p.y = u * u * a[1] + 2 * u * t * p.cy + t * t * e[1];
        // across the bag's depth, narrowing again into the stock
        p.z = BLOWPIPE.z0 * u + o.z0 * t + p.dz * 0.09 * Math.sin(Math.PI * t);
        p.b = 0.2 + 0.25 * Math.min(1, f.bag);
        if (p.s >= 1) {
          p.leg = TUBE;
          p.s = 0;
        }
      }
      if (p.leg === TUBE) {
        const o = OUTLETS[p.out];
        const v = (p.out === 3 ? 0.5 : 0.35) + (p.out === 3 ? 1.9 : 1.3) * this.norm[p.out];
        p.s += v * dt;
        if (this.norm[p.out] < 0.03) p.life -= dt * 1.2;
        // some of the chanter's air leaves by the highest open hole
        const holeS = p.out === 3 && topHole > 0 ? HOLES[topHole] : Infinity;
        const exitHole = p.out === 3 && p.s >= holeS && p.off > 0.35;
        if (p.s >= o.len || exitHole) {
          const s = exitHole ? holeS : o.len;
          const a = axisPt(o, s);
          p.leg = FREE;
          p.life = 0.45 + rnd() * 0.4;
          const spd = v * (0.55 + rnd() * 0.3);
          if (exitHole) {
            // out of the front of the chanter (the holes face forward)
            const n = normal(o);
            p.vx = -n[0] * spd * 0.7 + (rnd() - 0.5) * 0.25;
            p.vy = -n[1] * spd * 0.7 + (rnd() - 0.2) * 0.25;
          } else {
            const d = [Math.sin(o.ang), -Math.cos(o.ang)];
            p.vx = d[0] * spd + (rnd() - 0.5) * spd * 0.7;
            p.vy = d[1] * spd + (rnd() - 0.5) * spd * 0.7;
          }
          p.vz = o.zLean * spd + (rnd() - 0.5) * spd * 0.6;
          p.x = a[0];
          p.y = a[1];
          p.z = o.z0 + o.zLean * s;
        } else {
          const a = axisPt(o, p.s), n = normal(o), r = radiusAt(o, p.s) * 0.62;
          p.x = a[0] + n[0] * r * p.off;
          p.y = a[1] + n[1] * r * p.off;
          p.z = o.z0 + o.zLean * p.s + p.dz * r;
          p.b = 0.35 + 0.65 * Math.min(1, this.norm[p.out]);
        }
      }
      if (p.leg === FREE) {
        const drag = Math.exp(-2.4 * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.vz *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.life -= dt;
        p.b = Math.max(0, Math.min(1, p.life)) * 0.9;
      }
      if (p.life <= 0) {
        p.leg = -1;
        p.wait = rnd() * 0.5;
        p.x = NaN;
        p.px = NaN;
      }
    }
  }
}

/** Draw the particles on a 2D screen: dots with a short trail, in three brightness bands. */
export function drawAirflow(ctx: CanvasRenderingContext2D, af: Airflow, m: (x: number, y: number) => [number, number], r: number, alpha: number): void {
  const dots = [new Path2D(), new Path2D(), new Path2D()];
  const trails = [new Path2D(), new Path2D(), new Path2D()];
  let any = false;
  for (const p of af.ps) {
    if (p.leg < 0 || !Number.isFinite(p.x)) continue;
    const band = Math.min(2, Math.floor(p.b * 3));
    const [x, y] = m(p.x, p.y);
    dots[band].moveTo(x + r, y);
    dots[band].arc(x, y, r, 0, Math.PI * 2);
    if (Number.isFinite(p.px)) {
      const [qx, qy] = m(p.px, p.py);
      if (Math.abs(qx - x) + Math.abs(qy - y) < 40) {
        trails[band].moveTo(qx, qy);
        trails[band].lineTo(x, y);
      }
    }
    any = true;
  }
  if (!any) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.fillStyle = "#ffe2a8";
  ctx.strokeStyle = "#ffe2a8";
  ctx.lineWidth = r * 1.1;
  for (let i = 0; i < 3; i++) {
    const a = alpha * (0.22 + 0.32 * i);
    ctx.globalAlpha = a;
    ctx.fill(dots[i]);
    ctx.globalAlpha = a * 0.6;
    ctx.stroke(trails[i]);
  }
  ctx.restore();
}
