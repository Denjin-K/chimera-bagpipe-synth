import { create } from "zustand";
import { audio, P, PP } from "./audio.ts";
import { arrange, buildEvents, parseAbc, plainGrace, type Arranged, type Tune } from "./abc.ts";
import { SONGS, SCOTLAND_THE_BRAVE } from "./songs.ts";

export interface PipesState {
  started: boolean;
  starting: boolean;
  error: string | null;
  songId: string;
  abc: string;
  tune: Tune;
  arranged: Arranged;
  pipers: number;
  seconds: boolean;
  playing: boolean;
  /** the piper shown large, and played from the keys */
  focus: number;
  mutes: boolean[];
  tempo: number;
  lowA: number;
  drones: number;
  chanter: number;
  blow: number;
  spread: number;
  humanize: number;
  graceMs: number;
  reverb: number;
  volume: number;
  autoGrace: boolean;
  /** live play: the focused piper's bag is up */
  liveBag: boolean;
  stage: boolean;
  editing: boolean;
  /** the big screen shows the band in 3D */
  threeD: boolean;
  start: () => Promise<void>;
  setSong: (id: string, abc?: string) => void;
  setAbc: (abc: string) => void;
  play: () => Promise<void>;
  stop: () => void;
  set: <K extends keyof PipesState>(k: K, v: PipesState[K]) => void;
  setFocus: (i: number) => void;
  toggleMute: (i: number) => void;
  liveNote: (note: number) => void;
  toggleBag: () => void;
}

const initialTune = parseAbc(SCOTLAND_THE_BRAVE);

/** everything the engine needs to hear again after a (re)start */
function pushAll(s: PipesState): void {
  audio.set(P.tempo, s.tempo);
  audio.set(P.lowA, s.lowA);
  audio.set(P.drones, s.drones);
  audio.set(P.chanter, s.chanter);
  audio.set(P.blow, s.blow);
  audio.set(P.spread, s.spread);
  audio.set(P.master, 0.55 / Math.sqrt(Math.max(1, s.pipers)) + 0.12);
  audio.setVolume(s.volume);
  audio.setReverb(s.reverb);
  for (let i = 0; i < 5; i++) audio.piper(i, PP.mute, s.mutes[i] || i >= s.pipers ? 1 : 0);
}

function scoreFor(s: Pick<PipesState, "tune" | "pipers" | "seconds" | "graceMs" | "humanize">): { arranged: Arranged; events: Float64Array } {
  const arranged = arrange(s.tune, s.pipers, s.seconds);
  const intro = Math.max(3, s.tune.meter[0]);
  return { arranged, events: buildEvents(s.tune, arranged, { graceMs: s.graceMs, humanize: s.humanize, intro }) };
}

export const useStore = create<PipesState>((set, get) => ({
  started: false,
  starting: false,
  error: null,
  songId: "brave",
  abc: SCOTLAND_THE_BRAVE,
  tune: initialTune,
  arranged: arrange(initialTune, 5, true),
  pipers: 5,
  seconds: true,
  playing: false,
  focus: 0,
  mutes: [false, false, false, false, false],
  tempo: initialTune.tempo,
  lowA: 480,
  drones: 1,
  chanter: 1,
  blow: 1,
  spread: 2,
  humanize: 7,
  graceMs: 32,
  reverb: 0.3,
  volume: 0.8,
  autoGrace: true,
  liveBag: false,
  stage: false,
  editing: false,
  threeD: false,

  start: async () => {
    if (get().started || get().starting) return;
    set({ starting: true, error: null });
    try {
      await audio.start();
      pushAll(get());
      set({ started: true, starting: false });
    } catch (err) {
      set({ starting: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  setSong: (id, abc) => {
    const song = SONGS.find((s) => s.id === id);
    const src = abc ?? song?.abc ?? get().abc;
    get().stop();
    const tune = parseAbc(src);
    const s = get();
    set({ songId: id, abc: src, tune, tempo: tune.tempo, arranged: arrange(tune, s.pipers, s.seconds) });
    audio.set(P.tempo, tune.tempo);
  },

  setAbc: (abc) => {
    get().setSong("custom", abc);
  },

  play: async () => {
    await get().start();
    const s = get();
    if (!s.started) return;
    const { arranged, events } = scoreFor(s);
    set({ arranged, playing: true, liveBag: false });
    audio.post({ type: "score", events });
    audio.post({ type: "play", from: -Math.max(3, s.tune.meter[0]) - 0.05 });
  },

  stop: () => {
    audio.post({ type: "stop" });
    set({ playing: false, liveBag: false });
  },

  set: (k, v) => {
    set({ [k]: v } as Partial<PipesState>);
    const s = get();
    switch (k) {
      case "tempo":
        audio.set(P.tempo, v as number);
        break;
      case "lowA":
        audio.set(P.lowA, v as number);
        break;
      case "drones":
        audio.set(P.drones, v as number);
        break;
      case "chanter":
        audio.set(P.chanter, v as number);
        break;
      case "blow":
        audio.set(P.blow, v as number);
        break;
      case "spread":
        audio.set(P.spread, v as number);
        break;
      case "reverb":
        audio.setReverb(v as number);
        break;
      case "volume":
        audio.setVolume(v as number);
        break;
      case "pipers":
      case "seconds": {
        set({ arranged: arrange(s.tune, s.pipers, s.seconds), focus: Math.min(s.focus, s.pipers - 1) });
        pushAll(get());
        if (s.playing) {
          // a new band mid-tune: re-send the parts and carry on from here
          const { events } = scoreFor(get());
          audio.post({ type: "score", events });
          audio.post({ type: "play", from: audio.header(0) });
        }
        break;
      }
      default:
        break;
    }
  },

  setFocus: (i) => set({ focus: Math.max(0, Math.min(4, i)) }),

  toggleMute: (i) => {
    const mutes = get().mutes.slice();
    mutes[i] = !mutes[i];
    set({ mutes });
    audio.piper(i, PP.mute, mutes[i] ? 1 : 0);
  },

  liveNote: (note) => {
    void get()
      .start()
      .then(() => {
        const s = get();
        if (!s.started) return;
        if (s.playing) s.stop();
        if (!get().liveBag) {
          audio.piper(s.focus, PP.bag, 1);
          audio.piper(s.focus, PP.mute, 0);
          set({ liveBag: true });
        }
        const g = s.autoGrace ? plainGrace(note)[0] : -1;
        audio.post({ type: "note", piper: s.focus, note, grace: g, graceMs: s.graceMs });
      });
  },

  toggleBag: () => {
    void get()
      .start()
      .then(() => {
        const s = get();
        if (!s.started) return;
        if (s.playing) {
          s.stop();
          return;
        }
        const on = !s.liveBag;
        audio.piper(s.focus, PP.bag, on ? 1 : 0);
        if (on) {
          audio.piper(s.focus, PP.mute, 0);
          audio.post({ type: "note", piper: s.focus, note: 5, grace: -1, graceMs: 0 });
        }
        set({ liveBag: on });
      });
  },
}));

/** Watch the engine: the tune ending on its own clears `playing`. */
export function watchTransport(): () => void {
  let raf = 0;
  let wasPlaying = false;
  const loop = () => {
    const engPlaying = audio.header(1) > 0.5;
    const s = useStore.getState();
    if (wasPlaying && !engPlaying && s.playing) useStore.setState({ playing: false });
    wasPlaying = engPlaying;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
