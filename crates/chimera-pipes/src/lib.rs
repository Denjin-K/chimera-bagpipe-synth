//! CHIMERA PIPES: a physically modelled Great Highland bagpipe band (see `pipe` for the model,
//! `band` for the sequencer and mix). The C ABI below is what the AudioWorklet calls: no imports,
//! everything crosses as numbers and pointers into this module's memory, like `chimera-wasm`.

pub mod band;
pub mod pipe;

use band::{Band, Event};

#[unsafe(no_mangle)]
pub extern "C" fn band_new(sample_rate: f64) -> *mut Band {
    Box::into_raw(Box::new(Band::new(sample_rate)))
}

/// # Safety
/// `h` must come from `band_new` and not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn band_free(h: *mut Band) {
    if !h.is_null() {
        drop(unsafe { Box::from_raw(h) });
    }
}

fn band<'a>(h: *mut Band) -> &'a mut Band {
    // SAFETY: the worklet only passes the handle band_new returned
    unsafe { &mut *h }
}

/// Render `frames` (≤ 4096) interleaved stereo frames; returns a pointer to them.
#[unsafe(no_mangle)]
pub extern "C" fn band_render(h: *mut Band, frames: u32) -> *const f32 {
    band(h).render(frames as usize).as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn band_tele(h: *mut Band) -> *const f32 {
    band(h).tele.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn band_tele_len() -> u32 {
    band::TELE_LEN as u32
}

/// Global parameters: 0 tempo (bpm), 1 Low A (Hz), 2 master, 3 tuning spread (cents),
/// 4 drone level, 5 chanter level, 6 blowing pressure.
#[unsafe(no_mangle)]
pub extern "C" fn band_set(h: *mut Band, id: u32, v: f64) {
    let b = band(h);
    match id {
        0 => b.tempo = v.clamp(30.0, 240.0),
        1 => b.set_low_a(v),
        2 => b.master = v.clamp(0.0, 2.0) as f32,
        3 => b.set_spread(v.clamp(0.0, 30.0)),
        4 => b.pipers.iter_mut().for_each(|p| p.pipe.drone_gain = v.clamp(0.0, 2.0) as f32),
        5 => b.pipers.iter_mut().for_each(|p| p.pipe.chanter_gain = v.clamp(0.0, 2.0) as f32),
        6 => b.pipers.iter_mut().for_each(|p| p.pipe.bag.level = v.clamp(0.6, 1.4) as f32),
        _ => {}
    }
}

/// Per-piper parameters: 0 mute, 1 gain, 2 pan, 3 drones on, 4 bag on (strike in / cut off).
#[unsafe(no_mangle)]
pub extern "C" fn band_piper(h: *mut Band, piper: u32, id: u32, v: f64) {
    let b = band(h);
    let Some(p) = b.pipers.get_mut(piper as usize) else { return };
    match id {
        0 => p.mute = v > 0.5,
        1 => p.gain = v.clamp(0.0, 2.0) as f32,
        2 => p.set_pan(v as f32),
        3 => p.pipe.drones_on = v > 0.5,
        4 => p.pipe.bag.on = v > 0.5,
        _ => {}
    }
}

/// Finger a note now (live play); `grace` ≥ 0 plays that gracenote for `grace_ms` first.
#[unsafe(no_mangle)]
pub extern "C" fn band_note(h: *mut Band, piper: u32, note: u32, grace: i32, grace_ms: f64) {
    band(h).live_note(piper as usize, note as usize, grace, grace_ms);
}

#[unsafe(no_mangle)]
pub extern "C" fn band_score_clear(h: *mut Band) {
    band(h).clear_score();
}

/// kind: 0 note (val = 0 Low G … 8 High A), 1 bag on, 2 bag off, 3 drones (val 0/1)
#[unsafe(no_mangle)]
pub extern "C" fn band_score_push(h: *mut Band, piper: u32, beat: f64, ms: f64, kind: u32, val: f64) {
    band(h).push(piper as usize, Event { beat, ms, kind: kind as u8, val: val as f32 });
}

#[unsafe(no_mangle)]
pub extern "C" fn band_score_done(h: *mut Band) {
    band(h).finish_score();
}

#[unsafe(no_mangle)]
pub extern "C" fn band_play(h: *mut Band, from_beat: f64) {
    band(h).play(from_beat);
}

#[unsafe(no_mangle)]
pub extern "C" fn band_stop(h: *mut Band) {
    band(h).stop();
}

/// Scratch for JS-owned data (score batches).
#[unsafe(no_mangle)]
pub extern "C" fn pipes_alloc(n: usize) -> *mut u8 {
    let v: Vec<u64> = vec![0; n.div_ceil(8).max(1)];
    Box::into_raw(v.into_boxed_slice()) as *mut u8
}

/// Push `n` events from a buffer of f64 records [piper, beat, ms, kind, val].
///
/// # Safety
/// `p` must point to `n * 5` f64s inside this module's memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn band_score_push_many(h: *mut Band, p: *const f64, n: u32) {
    let s = unsafe { core::slice::from_raw_parts(p, n as usize * 5) };
    let b = band(h);
    for r in s.chunks_exact(5) {
        b.push(r[0] as usize, Event { beat: r[1], ms: r[2], kind: r[3] as u8, val: r[4] as f32 });
    }
}
