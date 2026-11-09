//! The pipe band's contract: in tune, output independent of block size, the strike-in and
//! cut-off behave, and a score plays out and ends.

use chimera_pipes::band::{Band, EV_BAG_OFF, EV_BAG_ON, EV_NOTE, Event};
use chimera_pipes::pipe::{Pipe, RATIOS};

const FS: f64 = 48000.0;

/// zero-crossing pitch over a steady stretch (rising crossings, interpolated)
fn pitch(x: &[f32]) -> f64 {
    // low-pass hard so only the fundamental crosses zero
    let mut y = vec![0.0f64; x.len()];
    let (mut a, mut b) = (0.0f64, 0.0f64);
    for (i, &v) in x.iter().enumerate() {
        a += (v as f64 - a) * 0.04;
        b += (a - b) * 0.04;
        y[i] = b;
    }
    let mean = y.iter().sum::<f64>() / y.len() as f64;
    let mut cross = Vec::new();
    for i in 1..y.len() {
        let (p, q) = (y[i - 1] - mean, y[i] - mean);
        if p < 0.0 && q >= 0.0 {
            cross.push(i as f64 - 1.0 + p / (p - q));
        }
    }
    let n = cross.len() - 1;
    FS * n as f64 / (cross[n] - cross[0])
}

#[test]
fn every_chanter_note_and_the_drones_are_in_tune() {
    let mut p = Pipe::new(FS, 5);
    p.chanter_cents = 0.0;
    p.drone_cents = [0.0; 3];
    p.retune(480.0, FS);
    p.bag.on = true;
    for n in 0..9 {
        p.set_note(n, FS);
        let mut buf = Vec::new();
        for i in 0..(FS as usize / 2) {
            let (c, ..) = p.tick(FS);
            if i > FS as usize / 5 {
                buf.push(c);
            }
        }
        let f = pitch(&buf);
        let want = 480.0 * RATIOS[n];
        let cents = 1200.0 * (f / want).log2();
        assert!(cents.abs() < 6.0, "note {n}: {f:.2} Hz, want {want:.2} ({cents:+.1} c)");
    }
    let mut t = Vec::new();
    let mut b = Vec::new();
    for _ in 0..(FS as usize) {
        let (_, t1, _, bass) = p.tick(FS);
        t.push(t1);
        b.push(bass);
    }
    for (x, want) in [(&t[10000..], 240.0), (&b[10000..], 120.0)] {
        let f = pitch(x);
        assert!((1200.0 * (f / want).log2()).abs() < 6.0, "drone {f:.2} Hz, want {want}");
    }
}

fn scale_band() -> Band {
    let mut band = Band::new(FS);
    for p in 0..5 {
        band.push(p, Event { beat: -2.0, ms: 0.0, kind: EV_BAG_ON, val: 1.0 });
        for i in 0..12 {
            band.push(p, Event { beat: i as f64 * 0.5, ms: -30.0, kind: EV_NOTE, val: 7.0 });
            band.push(p, Event { beat: i as f64 * 0.5, ms: 0.0, kind: EV_NOTE, val: (i % 9) as f32 });
        }
        band.push(p, Event { beat: 6.5, ms: 0.0, kind: EV_BAG_OFF, val: 0.0 });
    }
    band.finish_score();
    band.play(-2.0);
    band
}

#[test]
fn output_does_not_depend_on_block_size() {
    let (mut a, mut b) = (scale_band(), scale_band());
    let mut xa = Vec::new();
    let mut xb = Vec::new();
    for _ in 0..200 {
        xa.extend_from_slice(a.render(128));
        for _ in 0..4 {
            xb.extend_from_slice(b.render(32));
        }
    }
    assert_eq!(xa.len(), xb.len());
    assert!(xa.iter().zip(&xb).all(|(p, q)| p.to_bits() == q.to_bits()), "128-frame and 32-frame blocks differ");
}

#[test]
fn the_tune_plays_out_cuts_off_and_ends() {
    let mut band = scale_band();
    let mut peak = 0.0f32;
    let mut seconds = 0.0;
    while band.playing && seconds < 30.0 {
        for x in band.render(480) {
            assert!(x.is_finite());
            peak = peak.max(x.abs());
        }
        seconds += 0.01;
    }
    assert!(!band.playing, "the score never ended");
    assert!(peak > 0.1 && peak <= 1.0, "peak {peak}");
    // after the cut-off every bag empties and the band falls silent
    for _ in 0..100 {
        band.render(480);
    }
    let tail: f32 = band.render(480).iter().map(|x| x.abs()).fold(0.0, f32::max);
    assert!(tail < 1e-3, "still sounding after the cut-off: {tail}");
    assert!(band.pipers.iter().all(|p| p.pipe.bag.p < 0.01), "bags still up");
}

#[test]
fn drones_strike_in_before_they_are_full_and_the_bass_last() {
    let mut p = Pipe::new(FS, 9);
    p.bag.on = true;
    let mut first = [f64::NAN; 3];
    for i in 0..(FS as usize) {
        p.tick(FS);
        for k in 0..3 {
            if first[k].is_nan() && p.drones[k].reed.amp > 0.5 {
                first[k] = i as f64 / FS;
            }
        }
    }
    assert!(first.iter().all(|t| t.is_finite() && *t < 0.4), "{first:?}");
    assert!(first[2] > first[0], "the bass drone should speak after the tenors: {first:?}");
}
