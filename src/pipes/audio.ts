/**
 * Main-thread side of the pipe band: AudioContext, the worklet, a hall (convolution reverb with
 * a generated impulse response), analysers for the displays, and the latest telemetry block.
 */
import workletUrl from "./worklet.ts?worker&url";
import type { FromPipes, ToPipes } from "./worklet.ts";

let module: WebAssembly.Module | null = null;

/** Compile the band engine once (main.tsx awaits this before the UI loads). */
export async function initPipes(): Promise<void> {
  if (module) return;
  const url = (await import("./chimera_pipes.wasm?url")).default;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pipes engine: ${url}: HTTP ${res.status}`);
  const mod = await WebAssembly.compile(await res.arrayBuffer());
  if (WebAssembly.Module.imports(mod).length) throw new Error("pipes engine: the wasm module must not have imports");
  module = mod;
}

// ------------------------------------------------------------------ telemetry layout (band.rs)
export const TELE_HEADER = 8;
export const TELE_STRIDE = 96;
export const T = {
  bag: 0,
  note: 1,
  chAmp: 2,
  chLevel: 3,
  drLevel: 4,
  drAmp: 7,
  chF: 10,
  chH: 11,
  drH: 12,
  bagOn: 15,
  chRms: 16,
  drRms: 32,
  chInst: 68,
  tenorF: 84,
  bassF: 85,
  mute: 86,
  dronesOn: 87,
  /** mean flow: chanter, then the three drones */
  flow: 88,
  blow: 92,
} as const;
export const CH_POS = 16;
export const DR_POS = 12;

/** global parameter ids (lib.rs band_set) */
export const P = { tempo: 0, lowA: 1, master: 2, spread: 3, drones: 4, chanter: 5, blow: 6 } as const;
/** per-piper parameter ids (lib.rs band_piper) */
export const PP = { mute: 0, gain: 1, pan: 2, dronesOn: 3, bag: 4 } as const;

/** A synthetic hall: decaying stereo noise with early reflections (a castle courtyard, roughly). */
function hallIR(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const fs = ctx.sampleRate;
  const n = Math.round(seconds * fs);
  const buf = ctx.createBuffer(2, n, fs);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      // brighter early, darker late (air absorbs the highs first)
      const a = 0.25 + 0.7 * Math.min(1, t / seconds);
      lp = lp * a + rnd() * (1 - a);
      d[i] = lp * Math.exp((-6.9 * t) / seconds) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (const [t, g] of [[0.019, 0.5], [0.031, 0.38], [0.047, 0.3], [0.063, 0.22], [0.088, 0.16]] as const) {
      const i = Math.round((t + c * 0.0037) * fs);
      if (i < n) d[i] += g * (c ? -1 : 1);
    }
  }
  return buf;
}

class PipesAudio {
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private dry: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  scope: AnalyserNode | null = null;
  tele: Float32Array | null = null;
  /** performance.now() when `tele` arrived */
  teleAt = 0;
  load = 0;
  error: string | null = null;
  private starting: Promise<void> | null = null;
  private queue: ToPipes[] = [];
  private listeners = new Set<() => void>();
  private volume = 0.8;
  private reverb = 0.28;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running" && !!this.node;
  }

  onReady(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  start(): Promise<void> {
    if (this.starting) return this.ctx ? this.ctx.resume() : this.starting;
    this.starting = (async () => {
      if (!module) throw new Error("pipes engine not loaded");
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, "chimera-pipes", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module } });
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const conv = ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = hallIR(ctx, 2.6);
      node.connect(dry).connect(master);
      node.connect(conv).connect(wet).connect(master);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;
      const scope = ctx.createAnalyser();
      scope.fftSize = 4096;
      scope.smoothingTimeConstant = 0;
      node.connect(analyser);
      node.connect(scope);
      master.connect(ctx.destination);
      this.node = node;
      this.master = master;
      this.dry = dry;
      this.wet = wet;
      this.analyser = analyser;
      this.scope = scope;
      this.setReverb(this.reverb);
      node.port.onmessage = (e: MessageEvent<FromPipes>) => {
        const m = e.data;
        if (m.type === "tele") {
          const old = this.tele;
          this.tele = m.buf;
          this.teleAt = performance.now();
          this.load = m.load;
          if (old) node.port.postMessage({ type: "tele", buf: old } satisfies ToPipes, [old.buffer]);
        } else if (m.type === "error") {
          this.error = m.message;
          console.error(m.message);
        } else if (m.type === "ready") {
          for (const q of this.queue) this.post(q);
          this.queue = [];
          for (const f of this.listeners) f();
        }
      };
      await ctx.resume();
    })();
    this.starting.catch((err) => {
      this.error = String(err);
      this.starting = null;
    });
    return this.starting;
  }

  post(m: ToPipes): void {
    if (!this.node) {
      // before the worklet exists, settings wait (the latest of each kind is what counts)
      if (m.type === "set") this.queue = this.queue.filter((q) => !(q.type === "set" && q.id === m.id));
      this.queue.push(m);
      return;
    }
    if (m.type === "score") this.node.port.postMessage(m, [m.events.buffer]);
    else this.node.port.postMessage(m);
  }

  set(id: number, v: number): void {
    this.post({ type: "set", id, v });
  }

  piper(piper: number, id: number, v: number): void {
    this.post({ type: "piper", piper, id, v });
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setReverb(v: number): void {
    this.reverb = v;
    if (this.wet && this.dry && this.ctx) {
      this.wet.gain.setTargetAtTime(v * 1.1, this.ctx.currentTime, 0.05);
      this.dry.gain.setTargetAtTime(1 - v * 0.45, this.ctx.currentTime, 0.05);
    }
  }

  /** a piper's telemetry value */
  get(piper: number, k: number): number {
    return this.tele ? this.tele[TELE_HEADER + piper * TELE_STRIDE + k] : 0;
  }

  header(k: number): number {
    return this.tele ? this.tele[k] : 0;
  }

  /** the score position now (beats), extrapolated between telemetry blocks for smooth scrolling */
  beatNow(): number {
    if (!this.tele) return -1e9;
    const b = this.tele[0];
    if (this.tele[1] < 0.5) return b;
    // what is heard now left the engine one output latency ago
    const lat = this.ctx ? this.ctx.baseLatency + (this.ctx.outputLatency || 0) : 0;
    return b + (Math.min(80, performance.now() - this.teleAt) / 1000 - lat) * (this.tele[2] / 60);
  }
}

export const audio = new PipesAudio();
