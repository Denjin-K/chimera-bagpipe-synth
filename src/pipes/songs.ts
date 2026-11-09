/**
 * Built-in tunes, in ABC (pipe notation, K:HP). Both are traditional and in the public domain.
 *
 * Scotland the Brave: the 16-bar pipe setting with its gracenotes, doublings, grips and throws,
 * transcribed from the public-domain Breizh Partitions pipe score (celticscores.com, no. 2095),
 * played twice through as bands do.
 */
export interface Song {
  id: string;
  title: string;
  abc: string;
}

export const SCOTLAND_THE_BRAVE = `X:1
T:Scotland the Brave
C:Traditional
M:4/4
L:1/8
Q:1/4=100
K:HP
e|:{g}A2 {GdGe}A>B {gcd}c{e}A {gcd}ce|{ag}a2 {g}a2 {GdG}ae {gcd}c{e}A|{Gdc}d2 {g}f>d {gcd}ce {gcd}c{e}A|{gBd}B2 {gef}e2 {g}e>f {gef}e/d/{gcd}c/B/|
{g}A2 {GdGe}A>B {gcd}c{e}A {gcd}ce|{ag}a2 {g}a2 {GdG}ae {gcd}c{e}A|{Gdc}d2 {g}f>d {gcd}ce {gcd}c{e}A|{gBd}B2 {G}A>B {G}A2 {gcd}ce|
{ag}a2 {g}a2 {GdG}ae {gcd}c{e}A|{ag}a2 {g}a2 {GdG}ae {gcd}ce|{Gdc}d2 {g}f>d {gcd}ce {gcd}c{e}A|{gBd}B2 {gef}e2 {g}e>f {gef}e/d/{gcd}c/B/|
{g}A2 {GdGe}A>B {gcd}c{e}A {gcd}ce|{ag}a2 {g}a2 {GdG}ae {gcd}c{e}A|{Gdc}d2 {g}f>d {gcd}ce {gcd}c{e}A|[1 {gBd}B2 {G}A>B {G}A2 {gcd}ce:|[2 {gBd}B2 {G}A>B {G}A4|]
`;

export const AMAZING_GRACE = `X:2
T:Amazing Grace
C:Traditional
M:3/4
L:1/8
Q:1/4=66
K:HP
A2|{gde}d4 {g}f{e}d|{gfg}f4 {g}e2|{gde}d4 {g}B2|{GdG}A4 {g}A2|{gde}d4 {g}f{e}d|{gfg}f4 {g}e{g}f|{ag}a6|
{g}a4 {g}fa|{ag}a4 {g}f{e}d|{gfg}f4 {g}e2|{gde}d4 {g}B2|{GdG}A4 {g}A2|{gde}d4 {g}f{e}d|{gfg}f4 {g}e2|{gde}d6|{Gdc}d4|]
`;

/**
 * Auld Lang Syne, set for the pipes: the tonic on Low A, the low notes of "for auld lang syne"
 * folded up an octave (E and F above the tonic) and the top note on High A, as pipe settings fit
 * its eleven-note range onto the nine-note chanter. Melody traditional; this setting's
 * gracenotes are our own.
 */
export const AULD_LANG_SYNE = `X:4
T:Auld Lang Syne
C:Traditional, words by Robert Burns
M:4/4
L:1/8
Q:1/4=80
K:HP
{g}e2|{g}A3 {d}A {gAd}A2 {g}c2|{gBd}B3 {g}A {gBd}B2 {g}c2|{g}A3 {d}A {gcd}c2 {g}e2|{gfg}f6 {g}f2|
{gef}e3 {g}c {gcd}c2 {e}A2|{gBd}B3 {g}A {gBd}B2 {g}c2|{GdG}A3 {g}f {gfg}f2 {g}e2|{gAd}A6 {g}f2|
{gef}e3 {g}c {gcd}c2 {e}A2|{gBd}B3 {g}A {gBd}B2 {g}f2|{gef}e3 {g}c {gcd}c2 {g}e2|{gfg}f6 a2|
{gef}e3 {g}c {gcd}c2 {e}A2|{gBd}B3 {g}A {gBd}B2 {g}c2|{GdG}A3 {g}f {gfg}f2 {g}e2|{gAd}A6|]
`;

/** a template for your own tune: up to five written parts, one per piper */
export const CUSTOM_TEMPLATE = `X:3
T:My Tune
M:4/4
L:1/8
Q:1/4=96
K:HP
% Pipe notation: G A B c d e f g a = Low G … High A. {g} is a gracenote.
% Add V:1 … V:5 lines to write a part for each piper; one part is
% shared out as melody and seconds.
V:1
e|{g}A2 {g}A>B {g}c>A {g}c>e|{g}d2 {g}f>d {g}e2 {g}c>A|{g}B2 {g}B>c {g}d>B {g}e>c|{g}A6 {g}e2|]
V:2
c|{g}A2 {g}A>A {g}A>A {g}A>c|{g}B2 {g}d>B {g}c2 {g}A>A|{g}G2 {g}G>A {g}B>G {g}c>A|{g}A6 {g}c2|]
`;

export const SONGS: Song[] = [
  { id: "brave", title: "Scotland the Brave", abc: SCOTLAND_THE_BRAVE },
  { id: "grace", title: "Amazing Grace", abc: AMAZING_GRACE },
  { id: "auld", title: "Auld Lang Syne", abc: AULD_LANG_SYNE },
];
