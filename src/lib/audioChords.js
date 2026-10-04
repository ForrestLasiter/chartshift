// Works out which chords are being played in a recording of one instrument.
//
// How: the sound is cut into short overlapping frames; for each frame the
// strength of each of the twelve notes (C, C#, … B, regardless of octave) is
// measured from the peaks of its spectrum; that note pattern is compared with
// the pattern each major and minor chord would make; then the most likely
// chord sequence is chosen, preferring chords that last a little while over
// ones that flicker. Pure functions on sample arrays: no browser APIs.
//
// It recognises plain major and minor chords. A seventh or sus chord is
// reported as the major or minor chord it is built on.
import { keyOfChords, noteName, prefersFlats } from './chords.js';

export { keyOfChords };

const TARGET_RATE = 11025;      // plenty for chords, and fast
const FRAME = 4096;             // about 0.37 s at the target rate
const HOP = 1024;               // a reading about every 0.09 s
const LOW_HZ = 75, HIGH_HZ = 1700;
const NO_CHORD = 24;            // state number for "nothing playing"
const SWITCH_COST = 0.9;        // how much better another chord must look, in total, to switch to it
const MIN_SECONDS = 0.45;       // shorter blips are folded into their neighbours

/** Mixes down and thins the samples to roughly TARGET_RATE. */
export function prepare(samples, sampleRate) {
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  if (factor === 1) return { samples, sampleRate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

// In-place radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/**
 * The spectral peaks of every frame: for each frame a list of [pitch, strength]
 * where pitch is a (fractional) MIDI note number, plus the frame's loudness.
 */
function framePeaks(samples, sampleRate) {
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME), mag = new Float64Array(FRAME / 2);
  const lowBin = Math.max(2, Math.floor((LOW_HZ * FRAME) / sampleRate));
  const highBin = Math.min(FRAME / 2 - 2, Math.ceil((HIGH_HZ * FRAME) / sampleRate));
  const frames = [];
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[start + i];
      re[i] = s * window[i];
      im[i] = 0;
      energy += s * s;
    }
    fft(re, im);
    let top = 0, sum = 0;
    for (let k = lowBin - 1; k <= highBin + 1; k++) { mag[k] = Math.hypot(re[k], im[k]); sum += mag[k]; if (mag[k] > top) top = mag[k]; }
    // Notes stand far above the average level of the spectrum; hiss and room noise do not.
    const tonal = top / (sum / (highBin - lowBin + 3) || 1);
    const peaks = [];
    for (let k = lowBin; k <= highBin; k++) {
      const m = mag[k];
      if (m < top * 0.04 || m <= mag[k - 1] || m < mag[k + 1]) continue;
      // Refine the peak's position between bins.
      const a = mag[k - 1], c = mag[k + 1];
      const shift = (0.5 * (a - c)) / (a - 2 * m + c || 1);
      const hz = ((k + shift) * sampleRate) / FRAME;
      peaks.push([69 + 12 * Math.log2(hz / 440), m]);
    }
    frames.push({ peaks, energy: energy / FRAME, tonal });
  }
  return frames;
}

// How far the instrument is tuned from concert pitch, in semitones (-0.5 … 0.5).
function tuningOf(frames) {
  let x = 0, y = 0;
  for (const frame of frames) {
    for (const [pitch, strength] of frame.peaks) {
      const angle = 2 * Math.PI * (pitch - Math.round(pitch));
      x += strength * Math.cos(angle);
      y += strength * Math.sin(angle);
    }
  }
  return Math.atan2(y, x) / (2 * Math.PI);
}

// The note pattern a chord makes, allowing for the overtones each string adds.
const OVERTONES = [[0, 1], [0, 0.6], [7, 0.36], [0, 0.22], [4, 0.13], [7, 0.08]];
function templateFor(root, steps) {
  const t = new Float64Array(12);
  for (const step of steps) for (const [interval, weight] of OVERTONES) t[(root + step + interval) % 12] += weight;
  const size = Math.hypot(...t);
  return t.map((v) => v / size);
}
const TEMPLATES = [];
for (let i = 0; i < 24; i++) TEMPLATES.push(templateFor(i % 12, [0, i >= 12 ? 3 : 4, 7]));
// A sus4 chord (D G A for Dsus4) is heard as the major chord on its root.
const SUS4 = [];
for (let i = 0; i < 12; i++) SUS4.push(templateFor(i, [0, 5, 7]));
const MIN_TONAL = 8;

/**
 * @param {Float32Array} input mono samples
 * @param {number} inputRate samples per second
 * @returns {{ chords: {start:number,end:number,root:number,minor:boolean,name:string}[], duration:number, key:{index:number,minor:boolean}|null, tuning:number }}
 *   chords are in order with times in seconds; gaps mean nothing was playing.
 */
export function detectChords(input, inputRate) {
  const { samples, sampleRate } = prepare(input, inputRate);
  const duration = samples.length / sampleRate;
  const frames = framePeaks(samples, sampleRate);
  if (!frames.length) return { chords: [], duration, key: null, tuning: 0 };
  const tuning = tuningOf(frames);

  // Loudness below a small fraction of the loud parts counts as silence.
  const loud = frames.map((f) => f.energy).sort((a, b) => a - b)[Math.floor(frames.length * 0.9)];
  const floor = Math.max(loud * 0.015, 1e-7);

  // Score every chord for every frame.
  const scores = frames.map((frame) => {
    const row = new Float64Array(25);
    if (frame.energy < floor || frame.tonal < MIN_TONAL || !frame.peaks.length) { row[NO_CHORD] = 1; return row; }
    const chroma = new Float64Array(12);
    for (const [pitch, strength] of frame.peaks) {
      const p = pitch - tuning;
      const nearest = Math.round(p);
      chroma[((nearest % 12) + 12) % 12] += strength * (1 - 2 * Math.abs(p - nearest));
    }
    const size = Math.hypot(...chroma) || 1;
    const match = (template) => {
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += chroma[i] * template[i];
      return dot / size;
    };
    for (let c = 0; c < 24; c++) row[c] = match(TEMPLATES[c]);
    for (let root = 0; root < 12; root++) row[root] = Math.max(row[root], match(SUS4[root]) - 0.03);
    row[NO_CHORD] = 0.35;
    return row;
  });

  // Best sequence: total score, minus a cost for every change of chord.
  const best = new Float64Array(25), previous = new Float64Array(25);
  const from = scores.map(() => new Int8Array(25));
  previous.set(scores[0]);
  for (let t = 1; t < scores.length; t++) {
    let top = 0;
    for (let c = 1; c < 25; c++) if (previous[c] > previous[top]) top = c;
    for (let c = 0; c < 25; c++) {
      if (previous[c] >= previous[top] - SWITCH_COST) { best[c] = previous[c] + scores[t][c]; from[t][c] = c; }
      else { best[c] = previous[top] - SWITCH_COST + scores[t][c]; from[t][c] = top; }
    }
    previous.set(best);
  }
  const path = new Int8Array(scores.length);
  let state = 0;
  for (let c = 1; c < 25; c++) if (previous[c] > previous[state]) state = c;
  for (let t = scores.length - 1; t >= 0; t--) { path[t] = state; state = from[t][state]; }

  // Frames into stretches of one chord.
  const frameSeconds = HOP / sampleRate;
  const runs = [];
  for (let t = 0; t < path.length; t++) {
    const last = runs[runs.length - 1];
    if (last && last.state === path[t]) last.end = (t + 1) * frameSeconds;
    else runs.push({ state: path[t], start: t * frameSeconds, end: (t + 1) * frameSeconds });
  }
  // Fold blips into the stretch before them, then join neighbours that now match.
  const steady = [];
  for (const run of runs) {
    const last = steady[steady.length - 1];
    if (last && (run.end - run.start < MIN_SECONDS || last.state === run.state)) last.end = run.end;
    else steady.push({ ...run });
  }
  const sounding = steady.filter((run) => run.state !== NO_CHORD);
  const key = keyOfChords(sounding.map((run) => ({ root: run.state % 12, minor: run.state >= 12, seconds: run.end - run.start })));
  const flats = key ? prefersFlats(key) : false;
  const chords = sounding.map((run) => {
    const root = run.state % 12, minor = run.state >= 12;
    return { start: round(run.start), end: round(run.end), root, minor, name: noteName(root, flats) + (minor ? 'm' : '') };
  });
  return { chords, duration: round(duration), key, tuning: Math.round(tuning * 100) };
}

const round = (seconds) => Math.round(seconds * 100) / 100;

/**
 * The chords as song text for the Write tab: "[G] [C] [G] [D]", a few to a
 * line, with a blank line wherever the playing stopped for a while.
 */
export function chordsToText(chords, { perLine = 4, pause = 2.5 } = {}) {
  const lines = [];
  let line = [];
  const flush = () => { if (line.length) { lines.push(line.map((name) => `[${name}]`).join(' ')); line = []; } };
  chords.forEach((chord, i) => {
    if (i > 0 && chord.start - chords[i - 1].end >= pause) { flush(); lines.push(''); }
    if (line.length >= perLine) flush();
    line.push(chord.name);
  });
  flush();
  return lines.join('\n');
}

/** "1:05" */
export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
