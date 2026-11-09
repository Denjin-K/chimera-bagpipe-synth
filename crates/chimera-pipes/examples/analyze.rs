//! Measure the model: pitch of every chanter note and of the drones, harmonic spectra, the
//! strike-in, render cost; writes WAVs to the directory given as the first argument.
//!
//! cargo run --release -p chimera-pipes --example analyze -- <out_dir>

use chimera_pipes::band::{Band, EV_BAG_OFF, EV_BAG_ON, EV_NOTE, Event};
use chimera_pipes::pipe::{Pipe, RATIOS};
use std::time::Instant;

const FS: f64 = 48000.0;

fn wav(path: &str, l: &[f32], r: &[f32]) {
    let n = l.len();
    let mut b = Vec::with_capacity(44 + n * 4);
    let w32 = |b: &mut Vec<u8>, x: u32| b.extend_from_slice(&x.to_le_bytes());
    let w16 = |b: &mut Vec<u8>, x: u16| b.extend_from_slice(&x.to_le_bytes());
    b.extend_from_slice(b"RIFF");
    w32(&mut b, 36 + n as u32 * 4);
    b.extend_from_slice(b"WAVEfmt ");
    w32(&mut b, 16);
    w16(&mut b, 1);
    w16(&mut b, 2);
    w32(&mut b, FS as u32);
    w32(&mut b, FS as u32 * 4);
    w16(&mut b, 4);
    w16(&mut b, 16);
    b.extend_from_slice(b"data");
    w32(&mut b, n as u32 * 4);
    for i in 0..n {
        for x in [l[i], r[i]] {
            w16(&mut b, ((x.clamp(-1.0, 1.0) * 32767.0) as i16) as u16);
        }
    }
    std::fs::write(path, b).unwrap();
}

/// f0 by normalised autocorrelation with parabolic refinement, searched in [lo, hi] Hz
fn pitch(x: &[f32], lo: f64, hi: f64) -> f64 {
    let n = x.len();
    let (tmin, tmax) = ((FS / hi) as usize, (FS / lo) as usize);
    let mut best = (0usize, -1.0f64);
    let ac: Vec<f64> = (0..=tmax + 1)
        .map(|t| {
            let (mut s, mut e0, mut e1) = (0.0, 0.0, 0.0);
            for i in 0..n - tmax - 2 {
                s += x[i] as f64 * x[i + t] as f64;
                e0 += (x[i] as f64).powi(2);
                e1 += (x[i + t] as f64).powi(2);
            }
            s / (e0 * e1).sqrt().max(1e-20)
        })
        .collect();
    for t in tmin..=tmax {
        if ac[t] > best.1 && ac[t] >= ac[t - 1] && ac[t] >= ac[t + 1] {
            best = (t, ac[t]);
        }
    }
    // the first peak within 5 % of the best (avoid octave errors downward)
    let mut t = best.0;
    for c in tmin..=tmax {
        if ac[c] > best.1 * 0.95 && ac[c] >= ac[c - 1] && ac[c] >= ac[c + 1] {
            t = c;
            break;
        }
    }
    let (a, b, c) = (ac[t - 1], ac[t], ac[t + 1]);
    let off = 0.5 * (a - c) / (a - 2.0 * b + c);
    FS / (t as f64 + off)
}

/// amplitudes (dB re the strongest) of harmonics 1..=k of f, by single-bin DFT with a Hann window
fn harmonics(x: &[f32], f: f64, k: usize) -> Vec<f64> {
    let n = x.len();
    let amps: Vec<f64> = (1..=k)
        .map(|h| {
            let w = 2.0 * std::f64::consts::PI * f * h as f64 / FS;
            let (mut re, mut im) = (0.0, 0.0);
            for (i, &v) in x.iter().enumerate() {
                let win = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos();
                re += v as f64 * win * (w * i as f64).cos();
                im += v as f64 * win * (w * i as f64).sin();
            }
            (re * re + im * im).sqrt()
        })
        .collect();
    let m = amps.iter().cloned().fold(1e-30, f64::max);
    amps.iter().map(|a| 20.0 * (a / m).log10()).collect()
}

fn cents(a: f64, b: f64) -> f64 {
    1200.0 * (a / b).log2()
}

fn main() {
    let out = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    // ---- one pipe, each note held, chanter alone and drones alone
    println!("== chanter notes (Low A = 480 Hz), chanter output only");
    let mut pipe = Pipe::new(FS, 7);
    pipe.chanter_cents = 0.0;
    pipe.drone_cents = [0.0; 3];
    pipe.retune(480.0, FS);
    pipe.bag.on = true;
    let names = ["LG", "LA", "B ", "C ", "D ", "E ", "F ", "HG", "HA"];
    let mut all = Vec::new();
    for n in 0..9 {
        pipe.set_note(n, FS);
        let mut buf = Vec::new();
        for i in 0..(FS as usize * 6 / 10) {
            let (c, t1, t2, b) = pipe.tick(FS);
            all.push(c + t1 + t2 + b);
            if i > (FS as usize) / 5 {
                buf.push(c);
            }
        }
        let want = 480.0 * RATIOS[n];
        let got = pitch(&buf, want * 0.7, want * 1.4);
        let rms = (buf.iter().map(|x| (x * x) as f64).sum::<f64>() / buf.len() as f64).sqrt();
        let h = harmonics(&buf, got, 12);
        println!(
            "{} want {:7.2} got {:7.2} ({:+6.1} c) rms {:.3}  H: {}",
            names[n],
            want,
            got,
            cents(got, want),
            rms,
            h.iter().map(|d| format!("{:5.1}", d)).collect::<Vec<_>>().join(" ")
        );
    }
    wav(&format!("{out}/scale.wav"), &all, &all);

    println!("== drones (tenor 240, bass 120)");
    let mut pipe = Pipe::new(FS, 11);
    pipe.chanter_cents = 0.0;
    pipe.drone_cents = [0.0; 3];
    pipe.retune(480.0, FS);
    pipe.bag.on = true;
    let (mut ten, mut bass) = (Vec::new(), Vec::new());
    for i in 0..(FS as usize * 2) {
        let (_c, t1, _t2, b) = pipe.tick(FS);
        if i > FS as usize {
            ten.push(t1);
            bass.push(b);
        }
    }
    let ft = pitch(&ten, 150.0, 400.0);
    let fb = pitch(&bass, 80.0, 200.0);
    println!("tenor {:.2} Hz ({:+.1} c)  H: {}", ft, cents(ft, 240.0), harmonics(&ten, ft, 12).iter().map(|d| format!("{:5.1}", d)).collect::<Vec<_>>().join(" "));
    println!("bass  {:.2} Hz ({:+.1} c)  H: {}", fb, cents(fb, 120.0), harmonics(&bass, fb, 12).iter().map(|d| format!("{:5.1}", d)).collect::<Vec<_>>().join(" "));
    let rt = (ten.iter().map(|x| (x * x) as f64).sum::<f64>() / ten.len() as f64).sqrt();
    let rb = (bass.iter().map(|x| (x * x) as f64).sum::<f64>() / bass.len() as f64).sqrt();
    println!("tenor rms {:.3} bass rms {:.3}", rt, rb);
    println!("mean flows: chanter {:.4} tenor {:.4} {:.4} bass {:.4}", pipe.chanter.flow, pipe.drones[0].flow, pipe.drones[1].flow, pipe.drones[2].flow);

    // ---- strike-in: when does each reed start
    println!("== strike-in");
    let mut pipe = Pipe::new(FS, 3);
    pipe.bag.on = true;
    pipe.set_note(5, FS);
    let mut started = [None::<f64>; 4];
    let mut peak = 0.0f32;
    let mut env = Vec::new();
    for i in 0..(FS as usize * 2) {
        pipe.tick(FS);
        peak = peak.max(pipe.bag.p);
        let amps = [pipe.chanter.reed.amp, pipe.drones[0].reed.amp, pipe.drones[1].reed.amp, pipe.drones[2].reed.amp];
        for k in 0..4 {
            if started[k].is_none() && amps[k] > 0.5 {
                started[k] = Some(i as f64 / FS * 1000.0);
            }
        }
        if i % 4800 == 0 {
            env.push(format!("{:.2}", pipe.bag.p));
        }
    }
    println!("bag peak {:.3}; bag p every 100 ms: {}", peak, env.join(" "));
    println!("half-amplitude at ms: chanter {:?} tenor {:?} tenor {:?} bass {:?}", started[0], started[1], started[2], started[3]);

    // ---- a full band: strike in, a scale tune, cut off; time it
    println!("== band of 5, render cost");
    let mut band = Band::new(FS);
    let tune = [5, 1, 1, 2, 3, 1, 3, 5, 8, 8, 7, 8, 5, 3, 4, 6, 5, 3, 1, 2, 3, 1, 2, 2];
    for p in 0..5 {
        band.push(p, Event { beat: -3.0, ms: 0.0, kind: EV_BAG_ON, val: 1.0 });
        band.push(p, Event { beat: -3.0, ms: 0.0, kind: EV_NOTE, val: 5.0 });
        for (i, &n) in tune.iter().enumerate() {
            band.push(p, Event { beat: i as f64 * 0.5, ms: -30.0, kind: EV_NOTE, val: 7.0 });
            band.push(p, Event { beat: i as f64 * 0.5, ms: 0.0, kind: EV_NOTE, val: n as f32 });
        }
        band.push(p, Event { beat: tune.len() as f64 * 0.5 + 1.0, ms: 0.0, kind: EV_BAG_OFF, val: 0.0 });
    }
    band.finish_score();
    band.play(-3.0);
    let (mut l, mut r) = (Vec::new(), Vec::new());
    let secs = 14.0;
    let t0 = Instant::now();
    let blocks = (secs * FS / 128.0) as usize;
    for _ in 0..blocks {
        let o = band.render(128);
        for f in o.chunks_exact(2) {
            l.push(f[0]);
            r.push(f[1]);
        }
    }
    let el = t0.elapsed().as_secs_f64();
    let peak = l.iter().chain(r.iter()).fold(0.0f32, |m, x| m.max(x.abs()));
    println!("rendered {:.1} s in {:.3} s ({:.1}× real time, {:.2} % of one core); peak {:.3}", secs, el, secs / el, el / secs * 100.0, peak);
    wav(&format!("{out}/band.wav"), &l, &r);
}
