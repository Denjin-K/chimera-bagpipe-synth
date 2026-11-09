//! One Great Highland bagpipe: a bag, a conical chanter with a double reed, and three
//! cylindrical drones (two tenors an octave below Low A, a bass two octaves below) with single
//! beating reeds.
//!
//! The sources follow CHIMERA's parametric glottis: each reed is a beating valve whose *opening*
//! follows an exact-pitch pulse, and the flow through it is solved every sample against the bag
//! pressure and the pressure the bore sends back (u = K·h·√(P_bag − p_reed), an implicit
//! quadratic, so the reed and the bore interact). The bores are digital waveguides:
//!
//! - drones: one round-trip delay line (a cylinder, closed at the reed, open at the top), so its
//!   resonances sit on the odd harmonics, the drones' hollow buzz;
//! - chanter: two delay lines meeting at the reed (the reed on the bell side, a short stub on the
//!   apex side), the classic waveguide stand-in for a cone: the resonances land on every harmonic
//!   (tan kℓ₁ + tan kℓ₂ = 0 ⇒ f = n·c / 2(ℓ₁ + ℓ₂)). The open tone holes are lumped into the bell
//!   reflection, a low-pass at the tone-hole lattice cutoff, so the radiated sound is bright.
//!
//! Units are normalised: nominal bag pressure 1, bore impedance 1. No allocation after `new`.

pub const NOTES: usize = 9;
/// just-intonation chanter scale against Low A (Low G is the harmonic seventh 7/8, High G 7/4)
pub const RATIOS: [f64; NOTES] = [7.0 / 8.0, 1.0, 9.0 / 8.0, 5.0 / 4.0, 4.0 / 3.0, 3.0 / 2.0, 5.0 / 3.0, 7.0 / 4.0, 2.0];

const DL: usize = 4096;
const MASK: usize = DL - 1;
const TAB: usize = 1024;
/// bore positions reported per pipe (telemetry)
pub const CH_POS: usize = 16;
pub const DR_POS: usize = 12;

#[inline]
fn rand(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as f32 / u32::MAX as f32) * 2.0 - 1.0
}

/// A fractional delay line (cubic Lagrange). `read(d)` is the value written d samples ago.
pub struct Delay {
    buf: Vec<f32>,
    w: usize,
}

impl Delay {
    fn new() -> Self {
        Self { buf: vec![0.0; DL], w: 0 }
    }
    #[inline]
    fn write(&mut self, x: f32) {
        self.buf[self.w] = x;
        self.w = (self.w + 1) & MASK;
    }
    #[inline]
    fn read(&self, d: f32) -> f32 {
        let d = d.clamp(2.0, (DL - 4) as f32);
        let di = d as usize;
        let t = d - di as f32;
        let at = |k: usize| self.buf[self.w.wrapping_sub(k) & MASK];
        let (xm1, x0, x1, x2) = (at(di - 1), at(di), at(di + 1), at(di + 2));
        let cm1 = -t * (t - 1.0) * (t - 2.0) * (1.0 / 6.0);
        let c0 = (t + 1.0) * (t - 1.0) * (t - 2.0) * 0.5;
        let c1 = -(t + 1.0) * t * (t - 2.0) * 0.5;
        let c2 = (t + 1.0) * t * (t - 1.0) * (1.0 / 6.0);
        cm1 * xm1 + c0 * x0 + c1 * x1 + c2 * x2
    }
    fn clear(&mut self) {
        self.buf.iter_mut().for_each(|x| *x = 0.0);
    }
}

/// One-pole low-pass, y = (1 − a)·x + a·y.
#[derive(Clone, Copy)]
struct OnePole {
    a: f32,
    y: f32,
}

impl OnePole {
    fn new(fc: f64, fs: f64) -> Self {
        Self { a: (-2.0 * core::f64::consts::PI * fc / fs).exp() as f32, y: 0.0 }
    }
    #[inline]
    fn tick(&mut self, x: f32) -> f32 {
        self.y = (1.0 - self.a) * x + self.a * self.y;
        self.y
    }
    /// phase delay (samples) at f, to keep a loop that contains this filter in tune
    fn delay_at(&self, f: f64, fs: f64) -> f64 {
        let w = 2.0 * core::f64::consts::PI * f / fs;
        let a = self.a as f64;
        (a * w.sin()).atan2(1.0 - a * w.cos()) / w
    }
}

/// Flow through a reed of conductance √q against the pressure difference c, with the bore's
/// impedance zeff in series (u² + q·zeff·u − q·c = 0, the root with the sign of c).
#[inline]
fn reed_flow(q: f32, zeff: f32, c: f32) -> f32 {
    if q <= 0.0 {
        return 0.0;
    }
    let bq = q * zeff;
    let u = 0.5 * (-bq + (bq * bq + 4.0 * q * c.abs()).sqrt());
    if c >= 0.0 { u } else { -u }
}

/// A beating reed: opening pulse at an exact pitch, sounding above a pressure threshold.
pub struct Reed {
    /// the open phase of the pulse, over t ∈ [0, 1]
    tab: Vec<f32>,
    /// a sinusoidal swing over one period (the reed short of pressure, not yet beating)
    sw: Vec<f32>,
    oq: f32,
    phase: f64,
    /// pitch at nominal pressure (Hz)
    pub f: f64,
    /// pitch this sample, after pressure, struggle and flutter (Hz)
    pub f_eff: f64,
    pub amp: f32,
    pub sounding: bool,
    p_on: f32,
    p_off: f32,
    kappa: f32,
    att: f32,
    rel: f32,
    k: f32,
    rng: u32,
    flutter: f32,
    drift: f32,
    pub h: f32,
}

impl Reed {
    fn new(fs: f64, oq: f32, tp: f32, p_on: f32, p_off: f32, kappa: f32, attack_s: f64, k: f32, seed: u32) -> Self {
        let mut tab = vec![0.0f32; TAB + 2];
        for (i, v) in tab.iter_mut().enumerate() {
            let t = (i as f32 / TAB as f32).min(1.0);
            *v = if t < tp {
                0.5 * (1.0 - (core::f32::consts::PI * t / tp).cos())
            } else {
                (0.5 * core::f32::consts::PI * (t - tp) / (1.0 - tp)).cos().max(0.0)
            };
        }
        let sw = (0..TAB + 2).map(|i| 0.5 - 0.5 * (core::f32::consts::TAU * i as f32 / TAB as f32).cos()).collect();
        Self {
            tab,
            sw,
            oq,
            phase: (seed % 997) as f64 / 997.0,
            f: 240.0,
            f_eff: 240.0,
            amp: 0.0,
            sounding: false,
            p_on,
            p_off,
            kappa,
            att: (1.0 - (-1.0 / (attack_s * fs)).exp()) as f32,
            rel: (1.0 - (-1.0 / (0.012 * fs)).exp()) as f32,
            k,
            rng: seed | 1,
            flutter: 0.0,
            drift: 0.0,
            h: 0.0,
        }
    }

    /// Advance one sample at bag pressure p; returns the opening h (0 closed … ~1 wide open).
    #[inline]
    fn tick(&mut self, p: f32, fs: f64) -> f32 {
        if !self.sounding && p > self.p_on {
            self.sounding = true;
        } else if self.sounding && p < self.p_off {
            self.sounding = false;
        }
        let target = if self.sounding { ((p - self.p_off) / (1.0 - self.p_off)).clamp(0.0, 1.4) } else { 0.0 };
        self.amp += (target - self.amp) * if target > self.amp { self.att } else { self.rel };
        // a reed short of pressure struggles: flat, unsteady, not yet beating
        let weak = (1.0 - self.amp.min(1.0)).max(0.0);
        let n = rand(&mut self.rng);
        self.flutter += (n - self.flutter) * 0.0015;
        self.drift += (n - self.drift) * 0.00002;
        let f = self.f
            * (1.0 + self.kappa as f64 * (p as f64 - 1.0))
            * (1.0 - 0.06 * (weak * weak) as f64)
            * (1.0 + (self.flutter * (0.004 + 0.05 * weak) + self.drift * 0.0025) as f64);
        self.f_eff = f.max(20.0);
        self.phase += self.f_eff / fs;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        // the harder it is blown the longer it stays shut (beats harder: brighter)
        let oq = self.oq / (0.82 + 0.18 * self.amp.max(0.2));
        let ph = self.phase as f32;
        let beat = if ph < oq {
            let x = ph / oq * TAB as f32;
            let i = x as usize;
            let fr = x - i as f32;
            self.tab[i] + (self.tab[i + 1] - self.tab[i]) * fr
        } else {
            0.0
        };
        // below full pressure the reed swings without closing (a softer, rounder tone)
        let swing = self.sw[((ph * TAB as f32) as usize).min(TAB)];
        let shape = self.amp.min(1.0);
        self.h = self.amp * (shape * beat + (1.0 - shape) * (0.35 + 0.65 * swing) * 0.6);
        self.h
    }

    fn q(&self) -> f32 {
        let kh = self.k * self.h;
        kh * kh
    }
}

/// Bell (tone-hole lattice) reflection and the radiated output.
pub struct Chanter {
    pub reed: Reed,
    bell: Delay,
    apex: Delay,
    lp: OnePole,
    rad: OnePole,
    /// bell-side share of the bore (the apex stub is the rest)
    beta: f32,
    g_bell: f32,
    g_apex: f32,
    a: f32,
    b: f32,
    /// target and current pitch (Hz) for the fingered note
    target_f: f64,
    glide: f64,
    d: f32,
    comp: f32,
    pub out: f32,
    /// mean flow through the reed (smoothed, for the airflow display)
    pub flow: f32,
}

impl Chanter {
    fn new(fs: f64, seed: u32) -> Self {
        let lp = OnePole::new(1700.0, fs);
        Self {
            reed: Reed::new(fs, 0.46, 0.8, 0.9, 0.55, 0.055, 0.012, 1.15, seed),
            bell: Delay::new(),
            apex: Delay::new(),
            lp,
            rad: OnePole::new(380.0, fs),
            beta: 0.9,
            g_bell: 0.96,
            g_apex: 0.94,
            a: 0.0,
            b: 0.0,
            target_f: 480.0,
            glide: 1.0 - (-1.0 / (0.0011 * fs)).exp(),
            d: fs as f32 / 480.0,
            comp: lp.delay_at(480.0, fs) as f32,
            out: 0.0,
            flow: 0.0,
        }
    }

    fn set_pitch(&mut self, f: f64, fs: f64, now: bool) {
        self.target_f = f;
        self.comp = self.lp.delay_at(f, fs) as f32;
        if now {
            self.reed.f = f;
        }
    }

    #[inline]
    fn tick(&mut self, p: f32, fs: f64) -> f32 {
        // fingers move fast but not instantly: the pitch and the bore length glide ~1 ms
        self.reed.f += (self.target_f - self.reed.f) * self.glide;
        let h = self.reed.tick(p, fs);
        let _ = h;
        let d = (fs / self.reed.f_eff) as f32 - self.comp - 1.0;
        self.d = d.max(6.0);
        let db = self.beta * self.d;
        let da = (1.0 - self.beta) * self.d;
        let r = self.bell.read(db);
        let refl = self.lp.tick(r);
        self.a = -refl * self.g_bell;
        self.b = -self.apex.read(da.max(2.0)) * self.g_apex;
        let zeff = 0.5;
        let u = reed_flow(self.reed.q(), zeff, p - (self.a + self.b));
        self.flow += (u - self.flow) * 0.0005;
        let half = zeff * u;
        self.bell.write(self.b + half);
        self.apex.write(self.a + half);
        // transmitted at the bell and holes (high-passed by the reflection), then radiated
        let t = r - refl;
        self.out = t - self.rad.tick(t);
        self.out
    }

    /// pressure along the bore, reed (0) to bell (1)
    fn pressure_at(&self, x: f32) -> f32 {
        let db = self.beta * self.d;
        self.bell.read((x * 0.5 * db).max(2.0)) - self.bell.read(db * (1.0 - 0.5 * x))
    }

    fn reset(&mut self) {
        self.flow = 0.0;
        self.bell.clear();
        self.apex.clear();
        self.lp.y = 0.0;
        self.rad.y = 0.0;
        self.reed.amp = 0.0;
        self.reed.sounding = false;
    }
}

pub struct Drone {
    pub reed: Reed,
    bore: Delay,
    lp: OnePole,
    rad: OnePole,
    g: f32,
    d: f32,
    comp: f32,
    pub out: f32,
    pub flow: f32,
}

impl Drone {
    fn new(fs: f64, bass: bool, seed: u32) -> Self {
        let lp = OnePole::new(if bass { 2600.0 } else { 3200.0 }, fs);
        // the bass reed needs more pressure to start and starts last (the strike-in "brrap")
        let (p_on, p_off, attack) = if bass { (0.50, 0.36, 0.055) } else { (0.44, 0.32, 0.035) };
        Self {
            reed: Reed::new(fs, 0.68, 0.8, p_on, p_off, 0.02, attack, 1.0, seed),
            bore: Delay::new(),
            lp,
            rad: OnePole::new(if bass { 90.0 } else { 160.0 }, fs),
            g: 0.86,
            d: 100.0,
            comp: 0.0,
            out: 0.0,
            flow: 0.0,
        }
    }

    fn set_pitch(&mut self, f: f64, fs: f64) {
        self.reed.f = f;
        self.comp = self.lp.delay_at(f, fs) as f32;
    }

    #[inline]
    fn tick(&mut self, p: f32, fs: f64) -> f32 {
        self.reed.tick(p, fs);
        self.d = ((0.5 * fs / self.reed.f_eff) as f32 - self.comp - 1.0).max(6.0);
        let r = self.bore.read(self.d);
        let refl = self.lp.tick(r);
        let a = -refl * self.g;
        let z = 1.0;
        let u = reed_flow(self.reed.q(), z, p - 2.0 * a);
        self.flow += (u - self.flow) * 0.0005;
        self.bore.write(a + z * u);
        let t = r - refl;
        self.out = t - self.rad.tick(t);
        self.out
    }

    fn pressure_at(&self, x: f32) -> f32 {
        self.bore.read((x * 0.5 * self.d).max(2.0)) - self.bore.read(self.d * (1.0 - 0.5 * x))
    }

    fn reset(&mut self) {
        self.flow = 0.0;
        self.bore.clear();
        self.lp.y = 0.0;
        self.rad.y = 0.0;
        self.reed.amp = 0.0;
        self.reed.sounding = false;
    }
}

/// The bag: struck in hard (an underdamped rise, the overshoot gives the strike-in squeal), held
/// by the arm with a slow breathing wobble, and let go at the cut-off (the drones groan down).
pub struct Bag {
    pub p: f32,
    v: f32,
    pub on: bool,
    /// blowing pressure (1 = nominal)
    pub level: f32,
    rng: u32,
    w1: f32,
    w2: f32,
    breath: f64,
    breath_rate: f64,
    /// how hard the piper is blowing in now (0 … 1)
    pub blow: f32,
}

impl Bag {
    fn new(seed: u32) -> Self {
        Self { p: 0.0, v: 0.0, on: false, level: 1.0, rng: seed | 1, w1: 0.0, w2: 0.0, breath: (seed % 101) as f64 / 101.0, breath_rate: 0.33 + (seed % 17) as f64 * 0.004, blow: 0.0 }
    }

    #[inline]
    fn tick(&mut self, fs: f64) -> f32 {
        let dt = (1.0 / fs) as f32;
        let n = rand(&mut self.rng);
        self.w1 += (n - self.w1) * 0.0004;
        self.w2 += (self.w1 - self.w2) * 0.0004;
        self.breath += self.breath_rate / fs;
        if self.breath >= 1.0 {
            self.breath -= 1.0;
        }
        if self.on {
            // a breath tops the bag up; the arm evens it out (a small, slow swell)
            let b = (core::f64::consts::TAU * self.breath).sin().max(0.0) as f32;
            self.blow = b;
            let swell = b * b * b * 0.012;
            let target = self.level * (1.0 + self.w2 * 0.9 + swell);
            let w = core::f32::consts::TAU * 3.2;
            let zeta = 0.5;
            let acc = w * w * (target - self.p) - 2.0 * zeta * w * self.v;
            self.v += acc * dt;
            self.p += self.v * dt;
        } else {
            self.blow = 0.0;
            self.v = 0.0;
            self.p -= self.p * dt / 0.17;
        }
        self.p = self.p.max(0.0);
        self.p
    }
}

/// One piper's instrument.
pub struct Pipe {
    pub bag: Bag,
    pub chanter: Chanter,
    pub drones: [Drone; 3],
    pub note: usize,
    /// cents for the chanter, and for each drone (tuning spread)
    pub chanter_cents: f64,
    pub drone_cents: [f64; 3],
    pub drones_on: bool,
    pub chanter_gain: f32,
    pub drone_gain: f32,
    pub ch_rms: [f32; CH_POS],
    pub ch_inst: [f32; CH_POS],
    pub dr_rms: [[f32; DR_POS]; 3],
    pub level_ch: f32,
    pub level_dr: [f32; 3],
    low_a: f64,
}

impl Pipe {
    pub fn new(fs: f64, seed: u32) -> Self {
        let mut p = Self {
            bag: Bag::new(seed.wrapping_mul(2654435761)),
            chanter: Chanter::new(fs, seed.wrapping_mul(40503) ^ 0x9e37),
            drones: [Drone::new(fs, false, seed ^ 0x1234), Drone::new(fs, false, seed ^ 0x8765), Drone::new(fs, true, seed ^ 0x4321)],
            note: 1,
            chanter_cents: 0.0,
            drone_cents: [0.0; 3],
            drones_on: true,
            chanter_gain: 1.0,
            drone_gain: 1.0,
            ch_rms: [0.0; CH_POS],
            ch_inst: [0.0; CH_POS],
            dr_rms: [[0.0; DR_POS]; 3],
            level_ch: 0.0,
            level_dr: [0.0; 3],
            low_a: 480.0,
        };
        p.retune(480.0, fs);
        p
    }

    fn cents(c: f64) -> f64 {
        (c / 1200.0 * core::f64::consts::LN_2).exp()
    }

    pub fn retune(&mut self, low_a: f64, fs: f64) {
        self.low_a = low_a;
        let f = low_a * RATIOS[self.note] * Self::cents(self.chanter_cents);
        self.chanter.set_pitch(f, fs, false);
        for (i, d) in self.drones.iter_mut().enumerate() {
            let base = if i == 2 { low_a / 4.0 } else { low_a / 2.0 };
            d.set_pitch(base * Self::cents(self.drone_cents[i]), fs);
        }
    }

    pub fn set_note(&mut self, n: usize, fs: f64) {
        self.note = n.min(NOTES - 1);
        let f = self.low_a * RATIOS[self.note] * Self::cents(self.chanter_cents);
        self.chanter.set_pitch(f, fs, false);
    }

    /// One sample: (chanter, tenor 1, tenor 2, bass) radiated outputs, already weighted.
    #[inline]
    pub fn tick(&mut self, fs: f64) -> (f32, f32, f32, f32) {
        let p = self.bag.tick(fs);
        let c = self.chanter.tick(p, fs) * self.chanter_gain;
        // stopped drones (a hand over the top): the reed stays still
        let dp = if self.drones_on { p } else { 0.0 };
        let t1 = self.drones[0].tick(dp, fs) * 1.5 * self.drone_gain;
        let t2 = self.drones[1].tick(dp, fs) * 1.5 * self.drone_gain;
        let b = self.drones[2].tick(dp, fs) * 2.0 * self.drone_gain;
        let k = 0.0015;
        self.level_ch += (c * c - self.level_ch) * k;
        self.level_dr[0] += (t1 * t1 - self.level_dr[0]) * k;
        self.level_dr[1] += (t2 * t2 - self.level_dr[1]) * k;
        self.level_dr[2] += (b * b - self.level_dr[2]) * k;
        (c, t1, t2, b)
    }

    /// Sample the bores for the display (called every few dozen samples).
    pub fn observe(&mut self) {
        for i in 0..CH_POS {
            let x = i as f32 / (CH_POS - 1) as f32;
            let v = self.chanter.pressure_at(x);
            self.ch_inst[i] = v;
            self.ch_rms[i] += (v * v - self.ch_rms[i]) * 0.06;
        }
        for (k, d) in self.drones.iter().enumerate() {
            for i in 0..DR_POS {
                let x = i as f32 / (DR_POS - 1) as f32;
                let v = d.pressure_at(x);
                self.dr_rms[k][i] += (v * v - self.dr_rms[k][i]) * 0.06;
            }
        }
    }

    pub fn reset(&mut self) {
        self.chanter.reset();
        for d in &mut self.drones {
            d.reset();
        }
        self.bag.p = 0.0;
        self.bag.on = false;
    }
}
