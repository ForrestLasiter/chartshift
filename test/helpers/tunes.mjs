// Test pieces for the music reader, described for engrave.mjs's mei().
// Tunes and words are in the public domain; the harmonies are simple ones
// written for these tests.

// "Old Hundredth" (Genevan Psalter, 1551), four parts on a piano-style staff.
export const OLD_HUNDREDTH = {
  fifths: 1, meter: '4/4',
  lyrics: 'All peo- -ple that on earth do dwell, Sing to the Lord with cheer- ful voice; Him serve with'.split(' '),
  staves: [
    { clef: 'G2', voices: [
      'G4q G4q F#4q E4q | D4h G4q A4q | B4q B4q A4q A4q | G4h C5q B4q | A4q A4q G4q F#4q | G4w',
      'D4q D4q D4q B3q | B3h D4q F#4q | G4q G#4q E4q F#4q | D4h E4q D4q | F#4q F#4q D4q D4q | D4w',
    ] },
    { clef: 'F4', voices: [
      'B3q B3q A3q G3q | G3h B3q D4q | D4q D4q C4q D4q | B3h G3q G3q | D4q D4q B3q A3q | B3w',
      'G2q G2q D3q E3q | G2h G3q D3q | G3q E3q A2q D3q | G2h C3q G2q | D3q D3q G2q D3q | G2w',
    ] },
  ],
};
// The chords those parts spell, beat by beat: G G D Em | G . G D | G E7 Am D | G . C G | D D G D | G
export const OLD_HUNDREDTH_CHORDS = [['G'], ['G'], ['G', /^(Am|D)/], ['G', /^(C|G)$/], ['D', /^(G|D)$/], ['G']];

// "This Is My Father's World" (Terra Beata, 1915) as a melody with words,
// in F, with eighth notes, dotted notes, and accidentals.
export const TERRA_BEATA = {
  fifths: -1, meter: '4/4',
  lyrics: 'This is my Fa- ther\'s world, and to my lis- ten- ing ears all na- ture sings and round me rings the mu- sic of the spheres. This is my Fa- ther\'s world'.split(' '),
  staves: [{ clef: 'G2', voices: [
    'C4q F4q A4q F4q | C5h. A4q | Bb4q A4q G4q F4q | G4w | C4q F4q A4q F4q | C5h. A4q | Bb4e A4e G4q C5q E4q | F4w | G4q G4q A4q B4q | C5h. A4q | Bb4q A4q G4q F4q | E4w | Bn4q C5e Bb4e A4q G4q | F4h. Eb4q | D4q F4q A3q Db4q | F4w',
  ] }],
};

// A short tune in 3/4 with a pick-up note, written in ABC.
export const WALTZ_ABC = `X:1
T:Test waltz
M:3/4
L:1/4
K:G
D | G2 B/G/ | B2 A | G2 E | D2 D | G2 B/G/ | B2 A/B/ | d3- | d2 |]
`;

// Guitar music: treble clef with an 8 below, so it sounds as written an
// octave down. The first bar is the six open strings, low to high.
export const GUITAR = {
  fifths: 0, meter: '6/4',
  staves: [{ clef: 'G2_8', voices: ['E2q A2q D3q G3q B3q E4q | C3q E3q G3q C4q E4h'] }],
};
