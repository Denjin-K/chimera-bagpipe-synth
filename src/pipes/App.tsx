import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Screen, Chip } from "../ui/components/Screen.tsx";
import { EncoderPages, type EncoderPage } from "../ui/components/Encoder.tsx";
import { usePhosphor } from "../ui/usePhosphor.ts";
import { V, SLOTS } from "../ui/colors.ts";
import { label, seg } from "../ui/render/vector.ts";
import { audio } from "./audio.ts";
import { useStore, watchTransport } from "./store.ts";
import { SONGS } from "./songs.ts";
import { PIPE_NAMES, PIPE_SHORT, parseAbc } from "./abc.ts";
import { drawBagpipe, drawReadouts, emptyView, flowInput, readView, WORLD } from "./render/bagpipe.ts";
import { Airflow } from "./render/airflow.ts";
import { airs, newInput, tickLive, views } from "./live.ts";

// three.js loads only when the 3D view is first opened
const Pipes3D = lazy(() => import("./components/Pipes3D.tsx"));
import { drawRoll, ROLE_COLOR } from "./render/score.ts";
import { drawSound } from "./render/sound.ts";

const REPO = "https://github.com/jamesondh/chimera-vocal-synth";

/** the bar the band is in (1-based, after any pickup), and of how many */
function barOf(bars: number[], meterBeats: number, beat: number): { bar: number; of: number } {
  const anac = bars.length > 1 && bars[1] - bars[0] < meterBeats * 0.9 ? 1 : 0;
  let i = 0;
  while (i + 1 < bars.length && bars[i + 1] <= beat + 1e-6) i++;
  return { bar: Math.max(0, i - anac + 1), of: bars.length - anac };
}

/** re-render every `ms` (for readouts that follow the engine) */
function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

function TopBar() {
  const volume = useStore((s) => s.volume);
  const set = useStore((s) => s.set);
  const stage = useStore((s) => s.stage);
  const tune = useStore((s) => s.tune);
  const started = useStore((s) => s.started);
  useTick(500);
  return (
    <header className="topbar pipes-topbar">
      <div className="brand">
        <span className="wordmark">CHIMERA</span>
        <span className="wordmark pipes-mark">PIPES</span>
        <span className="tagline">{stage ? tune.title : "a physically modelled highland pipe band"}</span>
      </div>
      <div className="topbar-right">
        <Chip on={stage} onClick={() => set("stage", !stage)} title="Hide the controls for a clean screen recording (Esc to leave)">
          Stage
        </Chip>
        {!stage && (
          <label className="volume">
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.01} value={volume} style={{ "--pos": `${volume * 100}%` } as React.CSSProperties} onChange={(e) => set("volume", Number(e.target.value))} />
          </label>
        )}
        {!stage && <span className="load">{started ? `engine ${Math.round(audio.load * 100)} %` : "engine idle"}</span>}
        {!stage && (
          <a className="repo-link" href={REPO} target="_blank" rel="noreferrer" aria-label="CHIMERA on GitHub" title="the CHIMERA voice synth this is built on">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        )}
      </div>
    </header>
  );
}

function StartPrompt() {
  const started = useStore((s) => s.started);
  const starting = useStore((s) => s.starting);
  const error = useStore((s) => s.error);
  const play = useStore((s) => s.play);
  const start = useStore((s) => s.start);
  if (started) return null;
  return (
    <div className="start-prompt">
      <p>Every sound here comes from a simulated bagpipe: a bag under pressure, beating cane reeds, a conical chanter and three cylindrical drones.</p>
      <button type="button" className="primary large" disabled={starting} onClick={() => void play()}>
        {starting ? "Filling the bag…" : "Strike in the band"}
      </button>
      <p className="hint">
        or{" "}
        <button type="button" className="linkish" onClick={() => void start()}>
          start silent
        </button>{" "}
        and play the chanter on A S D F G H J K L
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const big = emptyView();
const READ_H = 84;
/** the bar readout for the piper shown large ("" when not playing) */
function barLabel(): string {
  const s = useStore.getState();
  const beat = audio.beatNow();
  const b = s.playing && beat >= 0 ? barOf(s.tune.bars, (s.tune.meter[0] / s.tune.meter[1]) * 4, beat) : null;
  return b ? `${b.bar}` : "";
}
/** the big pipe's air (one stream: switching pipers carries it over) */
const bigAir = new Airflow(1100);
const bigIn = newInput();
function BigPipe() {
  const focus = useStore((s) => s.focus);
  const arranged = useStore((s) => s.arranged);
  const tune = useStore((s) => s.tune);
  const stage = useStore((s) => s.stage);
  const threeD = useStore((s) => s.threeD);
  const set = useStore((s) => s.set);
  const role = arranged.roles[focus] ?? "MELODY";
  return (
    <Screen
      title={threeD ? "Band in 3D" : `Piper ${focus + 1}`}
      sub={threeD ? `piper ${focus + 1} · ${role.toLowerCase()} · ${tune.title}` : `${role.toLowerCase()} · ${tune.title}`}
      className="s-big"
      focus
      tools={
        <Chip on={threeD} onClick={() => set("threeD", !threeD)} title="Walk round the band in 3D">
          3D
        </Chip>
      }
    >
      {threeD ? (
        <Suspense fallback={<p className="no-webgl-pipes">Loading 3D…</p>}>
          <Pipes3D readH={READ_H} barLabel={barLabel} />
        </Suspense>
      ) : (
        <FlatPipe />
      )}
      {!stage && <StartPrompt />}
    </Screen>
  );
}

/** the piper shown large, flat (the side view), with the parts named */
function FlatPipe() {
  const focus = useStore((s) => s.focus);
  const ref = usePhosphor(({ ctx, w, h, now }) => {
    const v = readView(useStore.getState().focus, big);
    const s = useStore.getState();
    bigAir.advance(now, flowInput(v, bigIn));
    const readH = READ_H;
    const ww = WORLD.x1 - WORLD.x0 + 0.42, wh = WORLD.y1 - WORLD.y0 + 0.06;
    const sc = Math.min((w - 24) / ww, (h - readH - 12) / wh);
    const cx = w / 2 - ((WORLD.x0 + WORLD.x1 + 0.3) / 2) * sc;
    const cy = 8 + (-WORLD.y0 + 0.03) * sc + Math.max(0, (h - readH - 12 - wh * sc) / 2);
    // the air that spills out stays above the readouts
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h - readH);
    ctx.clip();
    drawBagpipe(ctx, cx, cy, sc, v, { detail: true, alpha: 1, finger: ROLE_COLOR(s.arranged.roles[s.focus] ?? "MELODY", s.focus), t: now / 1000, air: bigAir });
    ctx.restore();
    seg(ctx, 14, h - readH, w - 14, h - readH, V.frame, 1);
    drawReadouts(ctx, 14, h - readH + 20, w - 28, v, barLabel());
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label={`Piper ${focus + 1}'s bagpipe, live`} />;
}

function Band() {
  const setFocus = useStore((s) => s.setFocus);
  const focus = useStore((s) => s.focus);
  const mutes = useStore((s) => s.mutes);
  const toggleMute = useStore((s) => s.toggleMute);
  const pipers = useStore((s) => s.pipers);
  const ref = usePhosphor(({ ctx, w, h, now }) => {
    const s = useStore.getState();
    const n = 5;
    const slot = w / n;
    const labH = 34;
    const sc = Math.min((slot - 8) / (WORLD.x1 - WORLD.x0 + 0.05), (h - labH - 6) / (WORLD.y1 - WORLD.y0));
    tickLive(now);
    for (let i = 0; i < n; i++) {
      const v = views[i];
      const active = i < s.pipers;
      const muted = s.mutes[i];
      const cx = slot * i + slot / 2 - ((WORLD.x0 + WORLD.x1) / 2) * sc;
      const cy = 4 + -WORLD.y0 * sc;
      const role = s.arranged.roles[i] ?? "";
      const col = ROLE_COLOR(role, i);
      drawBagpipe(ctx, cx, cy, sc, v, { detail: false, alpha: !active ? 0.18 : muted ? 0.35 : 1, finger: col, t: now / 1000 + i * 0.13, air: airs[i] });
      const ly = h - labH + 12;
      label(ctx, `${i + 1}`, slot * i + 12, ly + 6, { size: 16, color: i === s.focus ? V.white : V.blue, weight: "m" });
      label(ctx, active ? (muted ? "MUTED" : role) : "RESTING", slot * i + 30, ly, { size: 9, color: active && !muted ? col : V.blueMid });
      label(ctx, active && v.chAmp > 0.05 ? PIPE_NAMES[v.note] : "—", slot * i + 30, ly + 13, { size: 10, color: active ? V.white : V.blueDim, alpha: 0.85 });
      if (i === s.focus) {
        // brackets round the piper shown large
        const x0 = slot * i + 3, x1 = slot * (i + 1) - 3, y0 = 3, y1 = h - 3, k = 10;
        for (const [ax, ay, bx, by] of [[x0, y0 + k, x0, y0], [x0, y0, x0 + k, y0], [x1 - k, y0, x1, y0], [x1, y0, x1, y0 + k], [x0, y1 - k, x0, y1], [x0, y1, x0 + k, y1], [x1 - k, y1, x1, y1], [x1, y1, x1, y1 - k]]) seg(ctx, ax, ay, bx, by, V.blue, 1.2);
      }
    }
  });
  return (
    <Screen
      title="Band"
      sub={`${pipers} piper${pipers > 1 ? "s" : ""} · click one to watch it`}
      className="s-band"
      tools={
        <Chip on={mutes[focus]} onClick={() => toggleMute(focus)} title="Mute the piper shown large">
          Mute {focus + 1}
        </Chip>
      }
    >
      <canvas
        ref={ref}
        className="instrument-canvas band-canvas"
        aria-label="The five pipers"
        onPointerDown={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          setFocus(Math.floor(((e.clientX - r.left) / r.width) * 5));
        }}
      />
    </Screen>
  );
}

function ScoreScreen() {
  const tune = useStore((s) => s.tune);
  const editing = useStore((s) => s.editing);
  const set = useStore((s) => s.set);
  const stage = useStore((s) => s.stage);
  useTick(250);
  const beat = audio.beatNow();
  const playing = useStore((s) => s.playing);
  const b = barOf(tune.bars, (tune.meter[0] / tune.meter[1]) * 4, Math.max(0, beat));
  return (
    <Screen
      title="Score"
      sub={`${tune.title} · ${tune.meter[0]}/${tune.meter[1]} · ${playing ? `bar ${b.bar} of ${b.of}` : `${b.of} bars`}`}
      className="s-score"
      tools={!stage && <Chip on={editing} onClick={() => set("editing", !editing)}>Edit ABC</Chip>}
    >
      {editing && !stage ? <AbcEditor /> : <RollCanvas />}
    </Screen>
  );
}

/**
 * The scrolling score. Its own component so it mounts with its canvas: usePhosphor binds its
 * drawing loop to the canvas present when it mounts, and the editor replaces that canvas.
 */
function RollCanvas() {
  const ref = usePhosphor(({ ctx, w, h }) => {
    const s = useStore.getState();
    drawRoll(ctx, w, h, s.tune, s.arranged, s.playing ? audio.beatNow() : -2, s.graceMs, s.tempo, s.pipers);
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="The score, scrolling" />;
}

function AbcEditor() {
  const abc = useStore((s) => s.abc);
  const setAbc = useStore((s) => s.setAbc);
  const set = useStore((s) => s.set);
  const [text, setText] = useState(abc);
  const t = parseAbc(text);
  const notes = t.parts.reduce((a, p) => a + p.notes.length, 0);
  return (
    <div className="abc-editor">
      <textarea value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} aria-label="Tune in ABC notation" />
      <div className="abc-foot">
        <span className={t.warnings.length ? "abc-warn" : "abc-ok"}>
          {t.title} · {t.parts.length} part{t.parts.length === 1 ? "" : "s"} · {notes} notes{t.warnings.length ? ` · ${t.warnings.join(" · ")}` : ""}
        </span>
        <Chip toggle={false} onClick={() => setText(abc)}>Revert</Chip>
        <Chip
          toggle={false}
          className="amber-chip"
          onClick={() => {
            setAbc(text);
            set("editing", false);
          }}
        >
          Load tune
        </Chip>
      </div>
    </div>
  );
}

function SoundScreen() {
  const ref = usePhosphor(({ ctx, w, h }) => {
    const s = useStore.getState();
    const f = s.focus;
    const sounding = audio.get(f, 3) > 0.002 || audio.get(f, 6) > 0.002 || audio.get(0, 3) > 0.002;
    drawSound(ctx, w, h, audio.analyser, audio.scope, audio.ctx?.sampleRate ?? 48000, audio.get(f, 85) || s.lowA / 4, audio.get(f, 2) > 0.05 ? audio.get(f, 10) : 0, sounding);
  });
  return (
    <Screen title="Sound" sub="the drones' harmonics (blue) under the chanter's (green)" className="s-sound">
      <canvas ref={ref} className="instrument-canvas" aria-label="Waveform and spectrum" />
    </Screen>
  );
}

function TuneScreen() {
  const s = useStore();
  const set = s.set;
  const pct = (v: number) => ({ value: String(Math.round(v * 100)), unit: "%" });
  const pages: EncoderPage[] = [
    {
      name: "Band",
      encoders: [
        { label: "Tempo", value: s.tempo, min: 40, max: 160, onChange: (v) => set("tempo", Math.round(v)), format: (v) => ({ value: String(Math.round(v)), unit: "bpm" }) },
        { label: "Pipers", value: s.pipers, min: 1, max: 5, onChange: (v) => Math.round(v) !== s.pipers && set("pipers", Math.round(v)), format: (v) => ({ value: String(Math.round(v)), unit: Math.round(v) === 1 ? "solo" : "in the band" }) },
        { label: "Timing", value: s.humanize, min: 0, max: 30, onChange: (v) => set("humanize", v), format: (v) => ({ value: v.toFixed(0), unit: "ms apart" }) },
        { label: "Hall", value: s.reverb, min: 0, max: 0.8, onChange: (v) => set("reverb", v), format: pct },
      ],
    },
    {
      name: "Pipes",
      encoders: [
        { label: "Low A", value: s.lowA, min: 440, max: 500, onChange: (v) => set("lowA", Math.round(v * 2) / 2), format: (v) => ({ value: v.toFixed(v % 1 ? 1 : 0), unit: "Hz" }) },
        { label: "Drones", value: s.drones, min: 0, max: 1.6, onChange: (v) => set("drones", v), format: pct },
        { label: "Chanter", value: s.chanter, min: 0, max: 1.6, onChange: (v) => set("chanter", v), format: pct },
        { label: "Blowing", value: s.blow, min: 0.8, max: 1.2, onChange: (v) => set("blow", v), format: pct },
      ],
    },
    {
      name: "Tuning",
      encoders: [
        { label: "Spread", value: s.spread, min: 0, max: 20, onChange: (v) => set("spread", v), format: (v) => ({ value: v.toFixed(1), unit: "cents" }) },
        { label: "Gracenote", value: s.graceMs, min: 15, max: 60, onChange: (v) => set("graceMs", Math.round(v)), format: (v) => ({ value: String(Math.round(v)), unit: "ms" }) },
      ],
    },
  ];
  return (
    <Screen title="Controls" sub="drag a dial, or focus it and use the arrow keys" className="s-tune">
      <EncoderPages pages={pages} label="Band controls" />
    </Screen>
  );
}

function SongScreen() {
  const songId = useStore((s) => s.songId);
  const setSong = useStore((s) => s.setSong);
  const playing = useStore((s) => s.playing);
  const play = useStore((s) => s.play);
  const stop = useStore((s) => s.stop);
  const seconds = useStore((s) => s.seconds);
  const set = useStore((s) => s.set);
  const tune = useStore((s) => s.tune);
  const starting = useStore((s) => s.starting);
  return (
    <Screen title="Tune" sub={tune.warnings.length ? tune.warnings[0] : `${tune.title}`} className="s-song">
      <div className="song-body">
        <div className="song-list" role="group" aria-label="Tunes">
          {SONGS.map((s) => (
            <Chip key={s.id} on={songId === s.id} onClick={() => setSong(s.id)}>
              {s.title}
            </Chip>
          ))}
          <Chip on={songId === "custom"} onClick={() => set("editing", true)}>
            Your tune…
          </Chip>
        </div>
        <div className="song-row">
          <button type="button" className={`primary large play-btn${playing ? " on" : ""}`} disabled={starting} onClick={() => (playing ? stop() : void play())}>
            {playing ? "Cut off" : "Strike in"}
          </button>
          <Chip on={seconds} onClick={() => set("seconds", !seconds)} title="Some pipers play seconds (harmony) instead of the melody">
            Seconds
          </Chip>
        </div>
        <p className="song-hint">
          Space strikes in or cuts off · Enter plays the tune
        </p>
      </div>
    </Screen>
  );
}

const KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
function ChanterKeys() {
  const liveNote = useStore((s) => s.liveNote);
  const toggleBag = useStore((s) => s.toggleBag);
  const liveBag = useStore((s) => s.liveBag);
  const autoGrace = useStore((s) => s.autoGrace);
  const set = useStore((s) => s.set);
  const focus = useStore((s) => s.focus);
  const [lit, setLit] = useState(-1);
  const litRef = useRef(-1);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const f = useStore.getState().focus;
      const n = audio.get(f, 2) > 0.05 ? Math.round(audio.get(f, 1)) : -1;
      if (n !== litRef.current) {
        litRef.current = n;
        setLit(n);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <Screen
      title="Chanter"
      sub={`play piper ${focus + 1} · keys A to L`}
      className="s-keys-pipes"
      tools={
        <>
          <Chip on={liveBag} onClick={toggleBag} title="Strike in or cut off (Space)">
            Bag
          </Chip>
          <Chip on={autoGrace} onClick={() => set("autoGrace", !autoGrace)} title="A G gracenote before every note, as pipers play">
            Gracenotes
          </Chip>
        </>
      }
    >
      <div className="chanter-keys" role="group" aria-label="Chanter notes">
        {PIPE_NAMES.map((n, i) => (
          <button key={n} type="button" className={`ckey${lit === i ? " on" : ""}`} style={{ "--slot": SLOTS[i % 4] } as React.CSSProperties} onPointerDown={() => liveNote(i)} aria-label={n}>
            <span className="ckey-note">{PIPE_SHORT[i]}</span>
            <span className="ckey-name">{n}</span>
            <span className="ckey-kbd">{KEYS[i].toUpperCase()}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}

/** the computer keyboard, in every layout (Stage hides the chanter screen, not the keys) */
function useKeyboard(): void {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === "TEXTAREA" || (tg.tagName === "INPUT" && (tg as HTMLInputElement).type === "text"))) return;
      const s = useStore.getState();
      const i = KEYS.indexOf(e.key.toLowerCase());
      if (i >= 0) {
        s.liveNote(i);
        e.preventDefault();
      } else if (e.key === " ") {
        s.toggleBag();
        e.preventDefault();
      } else if (e.key === "Enter" && tg?.tagName !== "BUTTON") {
        if (s.playing) s.stop();
        else void s.play();
        e.preventDefault();
      } else if (e.key === "Escape" && s.stage) {
        s.set("stage", false);
      }
    };
    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
  }, []);
}

export function App() {
  const stage = useStore((s) => s.stage);
  useEffect(() => watchTransport(), []);
  useKeyboard();
  return (
    <div className={`pipes-app${stage ? " stage" : ""}`}>
      <TopBar />
      <main className="pipes-wall">
        <div className="pipes-left">
          <BigPipe />
        </div>
        <div className="pipes-right">
          <Band />
          <ScoreScreen />
          <SoundScreen />
          {!stage && <TuneScreen />}
          {!stage && <ChanterKeys />}
          {!stage && <SongScreen />}
        </div>
      </main>
    </div>
  );
}
