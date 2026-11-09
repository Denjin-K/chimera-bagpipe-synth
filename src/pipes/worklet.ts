/**
 * CHIMERA PIPES AudioWorklet: the band engine (crates/chimera-pipes, wasm) on the audio thread.
 * Messages are applied between render quanta, in order. Every render posts nothing; telemetry is
 * copied out ~60 times a second and transferred (no allocation churn on the main thread).
 */
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

type Fn = (...a: number[]) => number;
type Exports = { memory: WebAssembly.Memory } & Record<string, Fn>;

export type ToPipes =
  | { type: "set"; id: number; v: number }
  | { type: "piper"; piper: number; id: number; v: number }
  | { type: "note"; piper: number; note: number; grace: number; graceMs: number }
  | { type: "score"; events: Float64Array }
  | { type: "play"; from: number }
  | { type: "stop" }
  | { type: "tele"; buf: Float32Array };

export type FromPipes = { type: "ready"; teleLen: number } | { type: "tele"; buf: Float32Array; load: number } | { type: "error"; message: string };

const TELE_EVERY = 6; // render quanta (128 frames) between telemetry posts: ~62 Hz at 48 kHz

class PipesProcessor extends AudioWorkletProcessor {
  private readonly x: Exports;
  private readonly h: number;
  private readonly teleLen: number;
  private failed = false;
  private n = 0;
  private load = 0;
  /** telemetry buffers the main thread has handed back (transferred both ways) */
  private spare: Float32Array[] = [];

  constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
    super();
    this.x = new WebAssembly.Instance(options.processorOptions.module, {}).exports as unknown as Exports;
    this.h = this.x.band_new(sampleRate);
    this.teleLen = this.x.band_tele_len();
    for (let i = 0; i < 3; i++) this.spare.push(new Float32Array(this.teleLen));
    this.port.onmessage = (e: MessageEvent<ToPipes>) => {
      if (this.failed) return;
      try {
        this.handle(e.data);
      } catch (err) {
        this.fail(err);
      }
    };
    this.port.postMessage({ type: "ready", teleLen: this.teleLen } satisfies FromPipes);
  }

  private fail(err: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.port.postMessage({ type: "error", message: `engine stopped: ${String(err)}` } satisfies FromPipes);
  }

  private handle(m: ToPipes): void {
    const x = this.x, h = this.h;
    switch (m.type) {
      case "set":
        x.band_set(h, m.id, m.v);
        break;
      case "piper":
        x.band_piper(h, m.piper, m.id, m.v);
        break;
      case "note":
        x.band_note(h, m.piper, m.note, m.grace, m.graceMs);
        break;
      case "score": {
        x.band_score_clear(h);
        const n = m.events.length / 5;
        const CH = 4096;
        const p = x.pipes_alloc(CH * 5 * 8);
        for (let i = 0; i < n; i += CH) {
          const k = Math.min(CH, n - i);
          new Float64Array(x.memory.buffer, p, k * 5).set(m.events.subarray(i * 5, (i + k) * 5));
          x.band_score_push_many(h, p, k);
        }
        x.band_score_done(h);
        break;
      }
      case "play":
        x.band_play(h, m.from);
        break;
      case "stop":
        x.band_stop(h);
        break;
      case "tele":
        if (this.spare.length < 4) this.spare.push(m.buf);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const l = out[0], r = out[1] ?? out[0];
    if (this.failed) return true;
    const t0 = Date.now();
    try {
      const frames = l.length;
      const p = this.x.band_render(this.h, frames);
      const f = new Float32Array(this.x.memory.buffer, p, frames * 2);
      for (let i = 0; i < frames; i++) {
        l[i] = f[2 * i];
        r[i] = f[2 * i + 1];
      }
    } catch (err) {
      this.fail(err);
      return true;
    }
    // load: render time against the quantum's duration (Date has 1 ms steps: smoothed)
    const dt = Date.now() - t0;
    this.load = this.load * 0.98 + (dt / ((128 / sampleRate) * 1000)) * 0.02;
    if (++this.n >= TELE_EVERY && this.spare.length) {
      this.n = 0;
      const buf = this.spare.pop()!;
      buf.set(new Float32Array(this.x.memory.buffer, this.x.band_tele(this.h), this.teleLen));
      this.port.postMessage({ type: "tele", buf, load: this.load } satisfies FromPipes, [buf.buffer]);
    }
    return true;
  }
}

registerProcessor("chimera-pipes", PipesProcessor);
