/**
 * The band's sound: a waveform held still against the bass drone's period, and the spectrum on
 * a log frequency axis with the drones' harmonic series marked under it, where the chanter's
 * partials lock in (or beat against it when the band is out of tune).
 */
import { V, SLOTS, heat } from "../../ui/colors.ts";
import { beamPts, label, seg, type Pt } from "../../ui/render/vector.ts";

let freq: Float32Array<ArrayBuffer> | null = null;
let time: Float32Array<ArrayBuffer> | null = null;
const pts: Pt[] = [];

export function drawSound(ctx: CanvasRenderingContext2D, w: number, h: number, an: AnalyserNode | null, sc: AnalyserNode | null, fs: number, bassF: number, chF: number, sounding: boolean): void {
  const left = 12, right = 12;
  const scopeH = Math.max(40, h * 0.34);
  const specTop = scopeH + 26, specBot = h - 20;
  // ---- scope
  const mid = 14 + scopeH / 2;
  seg(ctx, left, mid, w - right, mid, V.frame, 1);
  label(ctx, "WAVEFORM", left, 12, { size: 9, color: V.blueMid });
  if (sc) {
    if (!time || time.length !== sc.fftSize) time = new Float32Array(sc.fftSize);
    sc.getFloatTimeDomainData(time);
    const period = bassF > 20 ? fs / bassF : fs / 120;
    const span = Math.min(time.length * 0.45, period * 3);
    // trigger on a rising zero crossing of a smoothed copy
    let start = 0;
    let lp = 0;
    for (let i = 1; i < time.length - span - 2; i++) {
      const prev = lp;
      lp = lp * 0.9 + time[i] * 0.1;
      if (prev < 0 && lp >= 0 && i > 32) {
        start = i;
        break;
      }
    }
    let peak = 0.02;
    for (let i = 0; i < span; i++) peak = Math.max(peak, Math.abs(time[start + i]));
    const g = (scopeH * 0.46) / Math.max(0.12, peak);
    pts.length = 0;
    const n = Math.min(600, Math.floor(w - left - right));
    for (let i = 0; i < n; i++) {
      const k = start + Math.floor((i / n) * span);
      pts.push([left + i * ((w - left - right) / n), mid - time[k] * g]);
    }
    if (sounding) beamPts(ctx, pts, V.amber, 1.3, { hot: true });
  }
  // ---- spectrum
  const fmin = 80, fmax = 9000;
  const X = (f: number) => left + (Math.log(f / fmin) / Math.log(fmax / fmin)) * (w - left - right);
  label(ctx, "SPECTRUM", left, specTop - 8, { size: 9, color: V.blueMid });
  seg(ctx, left, specBot, w - right, specBot, V.frame, 1);
  for (const f of [100, 200, 500, 1000, 2000, 5000]) {
    const x = X(f);
    seg(ctx, x, specBot, x, specBot + 3, V.blueDim, 1);
    label(ctx, f >= 1000 ? `${f / 1000}K` : String(f), x, specBot + 13, { size: 8, color: V.blueMid, align: "center" });
  }
  // drone harmonic series (A): blue ticks at the floor
  if (bassF > 20) {
    for (let k = 1; k * bassF < fmax; k++) {
      const x = X(k * bassF);
      seg(ctx, x, specBot - (k % 2 ? 7 : 4), x, specBot, V.blue, 1, { alpha: k % 2 ? 0.8 : 0.45 });
    }
  }
  if (an) {
    if (!freq || freq.length !== an.frequencyBinCount) freq = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(freq);
    const bin = fs / 2 / freq.length;
    pts.length = 0;
    const cols = Math.min(700, Math.floor(w - left - right));
    const H = specBot - specTop;
    for (let i = 0; i <= cols; i++) {
      const f0 = fmin * Math.pow(fmax / fmin, i / cols), f1 = fmin * Math.pow(fmax / fmin, (i + 1) / cols);
      let m = -140;
      if (f1 - f0 < bin) {
        // narrower than a bin (the low end): interpolate between bins, not a staircase
        const x = f0 / bin, j = Math.floor(x);
        if (j + 1 < freq.length) m = freq[j] + (freq[j + 1] - freq[j]) * (x - j);
      } else for (let b = Math.floor(f0 / bin); b <= Math.ceil(f1 / bin) && b < freq.length; b++) m = Math.max(m, freq[b]);
      const u = Math.max(0, Math.min(1, (m + 100) / 85));
      pts.push([X(f0), specBot - u * H]);
    }
    if (sounding) {
      beamPts(ctx, pts, V.amber, 1.4);
      // the brightest peaks glow hotter
      for (let i = 1; i < pts.length - 1; i++) {
        const u = (specBot - pts[i][1]) / H;
        if (u > 0.6 && pts[i][1] <= pts[i - 1][1] && pts[i][1] <= pts[i + 1][1]) seg(ctx, pts[i][0], pts[i][1], pts[i][0], specBot, heat(u), 1, { alpha: 0.35 });
      }
    }
  }
  // the chanter's partials: green marks above the floor
  if (chF > 50 && sounding) {
    for (let k = 1; k * chF < fmax && k < 14; k++) {
      const x = X(k * chF);
      seg(ctx, x, specTop, x, specTop + (k === 1 ? 9 : 5), SLOTS[0], 1.2, { alpha: k === 1 ? 1 : 0.6 });
    }
  }
}
