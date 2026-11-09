//! A pipe band of up to five pipers, a score sequencer (sample-accurate, in beats so the tempo
//! can change live, with millisecond offsets for gracenotes and human timing), the stereo mix
//! and the telemetry block the display reads.

use crate::pipe::{CH_POS, DR_POS, NOTES, Pipe};

pub const MAX_PIPERS: usize = 5;
/// events one piper's part may hold (preallocated: pushing never allocates)
pub const MAX_EVENTS: usize = 32768;
pub const TELE_HEADER: usize = 8;
pub const TELE_STRIDE: usize = 96;
pub const TELE_LEN: usize = TELE_HEADER + MAX_PIPERS * TELE_STRIDE;
/// samples between bore observations for the display
const OBSERVE_EVERY: u32 = 48;

#[derive(Clone, Copy, Debug)]
pub struct Event {
    pub beat: f64,
    pub ms: f64,
    pub kind: u8,
    pub val: f32,
}

pub const EV_NOTE: u8 = 0;
pub const EV_BAG_ON: u8 = 1;
pub const EV_BAG_OFF: u8 = 2;
pub const EV_DRONES: u8 = 3;

pub struct Piper {
    pub pipe: Pipe,
    pub events: Vec<Event>,
    next: usize,
    pub pan: f32,
    /// constant-power gains for the chanter and bass (at the pan) and the tenors (either side)
    pg: [f32; 6],
    pub gain: f32,
    pub mute: bool,
    /// a live gracenote in progress: the note to land on, and samples left
    pending: Option<(usize, u32)>,
}

pub struct Band {
    pub fs: f64,
    pub pipers: Vec<Piper>,
    pub beat: f64,
    pub tempo: f64,
    pub playing: bool,
    pub low_a: f64,
    pub master: f32,
    end_beat: f64,
    observe: u32,
    dc_l: (f32, f32),
    dc_r: (f32, f32),
    pub out: Vec<f32>,
    pub tele: Vec<f32>,
}

fn pan_gains(pan: f32) -> [f32; 6] {
    let g = |x: f32| {
        let a = (x.clamp(-1.0, 1.0) + 1.0) * core::f32::consts::FRAC_PI_4;
        (a.cos(), a.sin())
    };
    let (cl, cr) = g(pan);
    let (dl, dr) = g(pan - 0.12);
    let (el, er) = g(pan + 0.12);
    [cl, cr, dl, dr, el, er]
}

impl Piper {
    pub fn set_pan(&mut self, pan: f32) {
        self.pan = pan.clamp(-1.0, 1.0);
        self.pg = pan_gains(self.pan);
    }
}

/// soft clip: transparent at band levels, rounds off peaks (no hard digital clipping)
#[inline]
fn soft(x: f32) -> f32 {
    let x = x.clamp(-3.0, 3.0);
    x * (27.0 + x * x) / (27.0 + 9.0 * x * x)
}

impl Band {
    pub fn new(fs: f64) -> Self {
        let pans = [0.0f32, -0.45, 0.45, -0.8, 0.8];
        let pipers = (0..MAX_PIPERS)
            .map(|i| {
                let mut pipe = Pipe::new(fs, 0x51ed_270b ^ ((i as u32 + 1) * 0x2c1b_3c6d));
                // no two sets of pipes are tuned alike: a few cents apart, drones beating slowly
                let spread = [0.0, 1.6, -1.2, 2.2, -2.0][i];
                pipe.chanter_cents = spread;
                pipe.drone_cents = [spread * 0.6 + 0.4, spread * 0.6 - 0.5, spread * 0.6 + 0.2];
                pipe.retune(480.0, fs);
                Piper { pipe, events: Vec::with_capacity(MAX_EVENTS), next: 0, pan: pans[i], pg: pan_gains(pans[i]), gain: 1.0, mute: false, pending: None }
            })
            .collect();
        Self {
            fs,
            pipers,
            beat: 0.0,
            tempo: 100.0,
            playing: false,
            low_a: 480.0,
            master: 0.5,
            end_beat: 0.0,
            observe: 0,
            dc_l: (0.0, 0.0),
            dc_r: (0.0, 0.0),
            out: vec![0.0; 2 * 4096],
            tele: vec![0.0; TELE_LEN],
        }
    }

    pub fn set_low_a(&mut self, hz: f64) {
        self.low_a = hz.clamp(400.0, 520.0);
        for p in &mut self.pipers {
            p.pipe.retune(self.low_a, self.fs);
        }
    }

    /// Tuning spread (cents) of chanters and drones across the band: 0 = perfectly tuned.
    pub fn set_spread(&mut self, cents: f64) {
        let shape = [0.0, 0.8, -0.6, 1.1, -1.0];
        for (i, p) in self.pipers.iter_mut().enumerate() {
            let s = shape[i] * cents;
            p.pipe.chanter_cents = s;
            p.pipe.drone_cents = [s * 0.6 + 0.2 * cents, s * 0.6 - 0.25 * cents, s * 0.6 + 0.1 * cents];
            p.pipe.retune(self.low_a, self.fs);
        }
    }

    pub fn clear_score(&mut self) {
        for p in &mut self.pipers {
            p.events.clear();
            p.next = 0;
        }
        self.end_beat = 0.0;
    }

    pub fn push(&mut self, piper: usize, ev: Event) {
        if let Some(p) = self.pipers.get_mut(piper) {
            if p.events.len() < MAX_EVENTS {
                p.events.push(ev);
                self.end_beat = self.end_beat.max(ev.beat);
            }
        }
    }

    /// Sort each part (pushes may come in any order) and rewind.
    pub fn finish_score(&mut self) {
        for p in &mut self.pipers {
            let mut ev = core::mem::take(&mut p.events);
            ev.sort_by(|a, b| (a.beat + a.ms * 1e-4).total_cmp(&(b.beat + b.ms * 1e-4)));
            p.events = ev;
            p.next = 0;
        }
    }

    fn ev_time(&self, e: &Event) -> f64 {
        e.beat + e.ms * 0.001 * self.tempo / 60.0
    }

    pub fn play(&mut self, from: f64) {
        self.beat = from;
        let fs = self.fs;
        let tempo = self.tempo;
        for p in &mut self.pipers {
            p.next = 0;
            let mut bag = false;
            let mut note = None;
            while p.next < p.events.len() {
                let e = p.events[p.next];
                if e.beat + e.ms * 0.001 * tempo / 60.0 >= from {
                    break;
                }
                match e.kind {
                    EV_NOTE => note = Some(e.val as usize),
                    EV_BAG_ON => bag = true,
                    EV_BAG_OFF => bag = false,
                    EV_DRONES => p.pipe.drones_on = e.val > 0.5,
                    _ => {}
                }
                p.next += 1;
            }
            if let Some(n) = note {
                p.pipe.set_note(n, fs);
            }
            if bag && !p.pipe.bag.on {
                // starting mid-tune: the bag is already up
                p.pipe.bag.on = true;
                p.pipe.bag.p = p.pipe.bag.level;
            }
        }
        self.playing = true;
    }

    /// Stop the tune: every piper cuts off together (the drones die away).
    pub fn stop(&mut self) {
        self.playing = false;
        for p in &mut self.pipers {
            p.pipe.bag.on = false;
            p.pending = None;
        }
    }

    pub fn live_note(&mut self, piper: usize, note: usize, grace: i32, grace_ms: f64) {
        let fs = self.fs;
        if let Some(p) = self.pipers.get_mut(piper) {
            if grace >= 0 && (grace as usize) < NOTES {
                p.pipe.set_note(grace as usize, fs);
                p.pending = Some((note, (grace_ms * 0.001 * fs).max(1.0) as u32));
            } else {
                p.pipe.set_note(note, fs);
                p.pending = None;
            }
        }
    }

    pub fn render(&mut self, frames: usize) -> &[f32] {
        let frames = frames.min(self.out.len() / 2);
        let fs = self.fs;
        let bps = self.tempo / 60.0;
        let dbeat = bps / fs;
        for n in 0..frames {
            if self.playing {
                let beat = self.beat;
                let mut any_left = false;
                for i in 0..self.pipers.len() {
                    loop {
                        let p = &self.pipers[i];
                        if p.next >= p.events.len() {
                            break;
                        }
                        let e = p.events[p.next];
                        if self.ev_time(&e) > beat {
                            any_left = true;
                            break;
                        }
                        let p = &mut self.pipers[i];
                        match e.kind {
                            EV_NOTE => {
                                p.pipe.set_note(e.val as usize, fs);
                                p.pending = None;
                            }
                            EV_BAG_ON => p.pipe.bag.on = true,
                            EV_BAG_OFF => p.pipe.bag.on = false,
                            EV_DRONES => p.pipe.drones_on = e.val > 0.5,
                            _ => {}
                        }
                        p.next += 1;
                    }
                }
                self.beat += dbeat;
                if !any_left && self.beat > self.end_beat {
                    self.playing = false;
                }
            }
            let (mut l, mut r) = (0.0f32, 0.0f32);
            for p in &mut self.pipers {
                if let Some((note, left)) = p.pending {
                    if left <= 1 {
                        p.pipe.set_note(note, fs);
                        p.pending = None;
                    } else {
                        p.pending = Some((note, left - 1));
                    }
                }
                // a piper at rest with an empty bag costs a test, not a pipe
                if !p.pipe.bag.on && p.pipe.bag.p < 1e-4 && p.pipe.level_ch < 1e-9 && p.pipe.level_dr[2] < 1e-9 {
                    continue;
                }
                let (c, t1, t2, b) = p.pipe.tick(fs);
                if p.mute {
                    continue;
                }
                // the chanter and bass at the piper's place, the tenors a little either side
                let [cl, cr, dl, dr, el, er] = p.pg;
                let g = p.gain;
                l += g * ((c + b) * cl + t1 * dl + t2 * el);
                r += g * ((c + b) * cr + t1 * dr + t2 * er);
            }
            // DC blocker, master, soft clip
            let yl = l - self.dc_l.0 + 0.9995 * self.dc_l.1;
            self.dc_l = (l, yl);
            let yr = r - self.dc_r.0 + 0.9995 * self.dc_r.1;
            self.dc_r = (r, yr);
            self.out[2 * n] = soft(yl * self.master);
            self.out[2 * n + 1] = soft(yr * self.master);
            self.observe += 1;
            if self.observe >= OBSERVE_EVERY {
                self.observe = 0;
                for p in &mut self.pipers {
                    if p.pipe.bag.p > 1e-4 || p.pipe.level_ch > 1e-9 {
                        p.pipe.observe();
                    }
                }
            }
        }
        self.write_tele();
        &self.out[..2 * frames]
    }

    fn write_tele(&mut self) {
        let t = &mut self.tele;
        t[0] = self.beat as f32;
        t[1] = if self.playing { 1.0 } else { 0.0 };
        t[2] = self.tempo as f32;
        t[3] = self.end_beat as f32;
        t[4] = self.low_a as f32;
        for (i, p) in self.pipers.iter().enumerate() {
            let b = TELE_HEADER + i * TELE_STRIDE;
            let pp = &p.pipe;
            t[b] = pp.bag.p;
            t[b + 1] = pp.note as f32;
            t[b + 2] = pp.chanter.reed.amp;
            t[b + 3] = pp.level_ch.sqrt();
            for k in 0..3 {
                t[b + 4 + k] = pp.level_dr[k].sqrt();
                t[b + 7 + k] = pp.drones[k].reed.amp;
                t[b + 12 + k] = pp.drones[k].reed.h;
            }
            t[b + 10] = pp.chanter.reed.f_eff as f32;
            t[b + 11] = pp.chanter.reed.h;
            t[b + 15] = if pp.bag.on { 1.0 } else { 0.0 };
            for k in 0..CH_POS {
                t[b + 16 + k] = pp.ch_rms[k].sqrt();
                t[b + 68 + k] = pp.ch_inst[k];
            }
            for d in 0..3 {
                for k in 0..DR_POS {
                    t[b + 32 + d * DR_POS + k] = pp.dr_rms[d][k].sqrt();
                }
            }
            t[b + 84] = pp.drones[0].reed.f_eff as f32;
            t[b + 85] = pp.drones[2].reed.f_eff as f32;
            t[b + 86] = if p.mute { 1.0 } else { 0.0 };
            t[b + 87] = if pp.drones_on { 1.0 } else { 0.0 };
            t[b + 88] = pp.chanter.flow;
            for k in 0..3 {
                t[b + 89 + k] = pp.drones[k].flow;
            }
            t[b + 92] = pp.bag.blow;
        }
    }
}
