import { z } from "zod";
/* Synthesized interface and game sounds. No audio files: every cue is built
   from oscillators and filtered noise so it loads instantly and stays tiny.
   Sound is on by default; the preference lives in localStorage. */

const STORAGE_KEY = "llmgames-interface-sound";

const CHANGE_EVENT = "llmgames-sound-change";

const MASTER = 0.8;

export type SoundName =
  // Interface
  | "hover"
  | "tap"
  | "toggleOn"
  | "toggleOff"
  | "open"
  | "close"
  | "nav"
  | "type"
  | "success"
  | "error"
  | "copy"
  | "notify"
  | "turn"
  | "tick"
  | "tickUrgent"
  | "count"
  | "win"
  | "loss"
  | "draw"
  | "start"
  | "join"
  // Boards
  | "drop"
  | "land"
  | "flip"
  | "place"
  | "move"
  | "capture"
  | "crown"
  // Cards and chips
  | "deal"
  | "fold"
  | "chips"
  | "reveal"
  | "cardFlip"
  // Battleship
  | "shot"
  | "hit"
  | "miss"
  | "bomb"
  | "radar"
  | "torpedo"
  | "mine"
  | "sunk"
  // Word games and battles
  | "clue"
  | "assassin"
  | "guess"
  | "attack"
  | "faint"
  | "switch";

const soundNameSchema = z.enum([
  "hover",
  "tap",
  "toggleOn",
  "toggleOff",
  "open",
  "close",
  "nav",
  "type",
  "success",
  "error",
  "copy",
  "notify",
  "turn",
  "tick",
  "tickUrgent",
  "count",
  "win",
  "loss",
  "draw",
  "start",
  "join",
  "drop",
  "land",
  "flip",
  "place",
  "move",
  "capture",
  "crown",
  "deal",
  "fold",
  "chips",
  "reveal",
  "cardFlip",
  "shot",
  "hit",
  "miss",
  "bomb",
  "radar",
  "torpedo",
  "mine",
  "sunk",
  "clue",
  "assassin",
  "guess",
  "attack",
  "faint",
  "switch",
]);

export function parseSoundName(value: string | undefined): SoundName | undefined {
  return soundNameSchema.safeParse(value).data;
}

let ctx: AudioContext | undefined;

let master: GainNode | undefined;

let bus: AudioNode | undefined;

let noiseBuffer: AudioBuffer | undefined;

let muted = readMuted();

const lastPlayed = new Map<SoundName, number>();

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;

  try {
    localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
  } catch {
    /* storage optional */
  }

  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : MASTER, ctx.currentTime, 0.02);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onMutedChange(listener: (muted: boolean) => void) {
  const sync = () => {
    muted = readMuted();
    listener(muted);
  };

  window.addEventListener(CHANGE_EVENT, sync);
  window.addEventListener("storage", sync);

  return () => {
    window.removeEventListener(CHANGE_EVENT, sync);
    window.removeEventListener("storage", sync);
  };
}

function audio(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;

  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      return undefined;
    }

    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    const warmth = ctx.createBiquadFilter();
    warmth.type = "highshelf";
    warmth.frequency.value = 6500;
    warmth.gain.value = -5;
    warmth.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);
    bus = warmth;
  }

  return ctx;
}

/** Resume audio from inside a user gesture. Browsers block sound until then. */
export function unlockAudio() {
  const c = audio();

  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

function noise(c: AudioContext) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  return noiseBuffer;
}

type Tone = {
  f: number;
  to?: number;
  at?: number;
  dur: number;
  vol: number;
  type?: OscillatorType;
  attack?: number;
  detune?: number;
};

type Noise = {
  at?: number;
  dur: number;
  vol: number;
  filter?: BiquadFilterType;
  f: number;
  to?: number;
  q?: number;
};

function tone(
  c: AudioContext,
  t0: number,
  { f, to, at = 0, dur, vol, type = "sine", attack = 0.004, detune = 0 }: Tone,
) {
  const osc = c.createOscillator(),
    env = c.createGain();

  const start = t0 + at;
  osc.type = type;
  osc.frequency.setValueAtTime(f, start);
  osc.detune.value = detune;

  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 20), start + dur);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(vol, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env);
  env.connect(bus!);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function hiss(
  c: AudioContext,
  t0: number,
  { at = 0, dur, vol, filter = "bandpass", f, to, q = 1 }: Noise,
) {
  const src = c.createBufferSource(),
    flt = c.createBiquadFilter(),
    env = c.createGain();

  const start = t0 + at;
  src.buffer = noise(c);
  flt.type = filter;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, start);

  if (to) flt.frequency.exponentialRampToValueAtTime(to, start + dur);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(vol, start + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(flt);
  flt.connect(env);
  env.connect(bus!);
  src.start(start, Math.random() * 0.5);
  src.stop(start + dur + 0.02);
}

/** A soft mallet: a sine with a quiet overtone, like a marimba bar. */
function mallet(c: AudioContext, t0: number, f: number, at: number, vol = 0.18, dur = 0.5) {
  tone(c, t0, { f, at, dur, vol });
  tone(c, t0, { f: f * 4, at, dur: dur * 0.25, vol: vol * 0.18 });
}

const note = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

const THROTTLE: Partial<Record<SoundName, number>> = {
  hover: 45,
  type: 30,
  tick: 80,
  count: 28,
  tap: 25,
};

export type PlayOptions = { pitch?: number; volume?: number };

export function play(name: SoundName, { pitch = 1, volume = 1 }: PlayOptions = {}) {
  if (typeof window === "undefined") return;
  // Other surfaces (such as the broadcast operator) write the preference directly, so re-read it.
  const stored = readMuted();

  if (stored !== muted) {
    muted = stored;

    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02);
  }

  if (muted) return;

  const now = performance.now(),
    gap = THROTTLE[name];

  if (gap && now - (lastPlayed.get(name) ?? 0) < gap) return;
  lastPlayed.set(name, now);
  const c = audio();

  if (!c) return;

  if (c.state !== "running") {
    void c
      .resume()
      .then(() => {
        if (c.state === "running") render(c, name, pitch, volume);
      })
      .catch(() => {});

    return;
  }

  render(c, name, pitch, volume);
}

function render(c: AudioContext, name: SoundName, p: number, v: number) {
  const t = c.currentTime + 0.005;

  const T = (o: Tone) =>
    tone(c, t, { ...o, f: o.f * p, to: o.to ? o.to * p : undefined, vol: o.vol * v });

  const N = (o: Noise) => hiss(c, t, { ...o, vol: o.vol * v });
  const M = (f: number, at: number, vol = 0.18, dur = 0.5) => mallet(c, t, f * p, at, vol * v, dur);

  switch (name) {
    case "hover":
      T({ f: 2600, to: 2100, dur: 0.035, vol: 0.025 });
      break;
    case "tap":
      T({ f: 640, to: 420, dur: 0.07, vol: 0.12, type: "triangle" });
      N({ dur: 0.02, vol: 0.05, f: 3800, q: 0.8 });
      break;
    case "type":
      N({ dur: 0.015, vol: 0.03, f: 5200, q: 2 });
      break;
    case "toggleOn":
      T({ f: 660, dur: 0.07, vol: 0.1 });
      T({ f: 990, at: 0.06, dur: 0.1, vol: 0.1 });
      break;
    case "toggleOff":
      T({ f: 880, dur: 0.07, vol: 0.09 });
      T({ f: 587, at: 0.06, dur: 0.1, vol: 0.09 });
      break;
    case "open":
      N({ dur: 0.16, vol: 0.05, f: 900, to: 3200, q: 0.7 });
      T({ f: 440, to: 700, dur: 0.14, vol: 0.06 });
      break;
    case "close":
      N({ dur: 0.14, vol: 0.04, f: 2800, to: 700, q: 0.7 });
      T({ f: 620, to: 400, dur: 0.12, vol: 0.05 });
      break;
    case "nav":
      N({ dur: 0.22, vol: 0.035, f: 600, to: 2400, q: 0.5 });
      break;
    case "copy":
      M(note(15), 0, 0.12, 0.25);
      M(note(22), 0.05, 0.1, 0.3);
      break;
    case "success":
      M(note(15), 0, 0.14, 0.4);
      M(note(19), 0.07, 0.13, 0.45);
      M(note(22), 0.14, 0.13, 0.6);
      break;
    case "error":
      T({ f: 196, dur: 0.12, vol: 0.09, type: "square" });
      T({ f: 185, at: 0.13, dur: 0.16, vol: 0.08, type: "square" });
      break;
    case "notify":
      M(note(10), 0, 0.15, 0.35);
      M(note(15), 0.09, 0.15, 0.5);
      break;
    case "turn":
      M(note(14), 0, 0.17, 0.4);
      M(note(21), 0.08, 0.15, 0.55);
      T({ f: note(26), at: 0.16, dur: 0.6, vol: 0.03 });
      break;
    case "tick":
      T({ f: 1500, dur: 0.03, vol: 0.06, type: "triangle" });
      break;
    case "tickUrgent":
      T({ f: 1900, dur: 0.04, vol: 0.09, type: "triangle" });
      T({ f: 950, dur: 0.05, vol: 0.05 });
      break;
    case "count":
      T({ f: 900, dur: 0.03, vol: 0.05, type: "triangle" });
      break;
    case "start":
      M(note(3), 0, 0.14);
      M(note(7), 0.08, 0.14);
      M(note(10), 0.16, 0.14);
      M(note(15), 0.24, 0.16, 0.8);
      break;
    case "join":
      M(note(7), 0, 0.12, 0.3);
      M(note(14), 0.07, 0.12, 0.4);
      break;
    case "win":
      [0, 4, 7, 12, 16].forEach((s, i) => M(note(3 + s), i * 0.085, 0.16, 0.7));
      N({ at: 0.35, dur: 0.6, vol: 0.025, filter: "highpass", f: 7000 });
      break;
    case "loss":
      [7, 3, 0, -5].forEach((s, i) => M(note(s), i * 0.14, 0.13, 0.6));
      break;
    case "draw":
      M(note(7), 0, 0.13, 0.5);
      M(note(7), 0.16, 0.11, 0.6);
      break;
    case "drop":
      N({ dur: 0.12, vol: 0.05, f: 1800, to: 500, q: 0.6 });
      break;
    case "land":
      T({ f: 180, to: 70, dur: 0.18, vol: 0.28 });
      N({ dur: 0.05, vol: 0.08, f: 1200, q: 1 });
      break;
    case "flip":
      T({ f: 1300, to: 700, dur: 0.05, vol: 0.08, type: "triangle" });
      N({ dur: 0.04, vol: 0.05, f: 4000, q: 1.5 });
      break;
    case "place":
      T({ f: 300, to: 160, dur: 0.1, vol: 0.2 });
      N({ dur: 0.03, vol: 0.06, f: 2600, q: 1.2 });
      break;
    case "move":
      T({ f: 520, to: 340, dur: 0.06, vol: 0.14, type: "triangle" });
      N({ dur: 0.025, vol: 0.06, f: 2000, q: 2 });
      break;
    case "capture":
      T({ f: 420, to: 200, dur: 0.08, vol: 0.16, type: "triangle" });
      T({ f: 300, to: 140, at: 0.07, dur: 0.12, vol: 0.18, type: "triangle" });
      break;
    case "crown":
      M(note(15), 0, 0.14, 0.4);
      M(note(22), 0.06, 0.12, 0.4);
      M(note(27), 0.12, 0.12, 0.7);
      break;
    case "deal":
      N({ dur: 0.09, vol: 0.09, f: 3000, to: 1400, q: 0.9 });
      break;
    case "fold":
      N({ dur: 0.16, vol: 0.06, f: 1500, to: 500, q: 0.6 });
      break;
    case "chips":
      for (let i = 0; i < 4; i++)
        T({ f: 3200 + i * 380, at: i * 0.028, dur: 0.035, vol: 0.05, type: "triangle" });
      break;
    case "reveal":
      M(note(19), 0, 0.12, 0.6);
      T({ f: note(31), at: 0.02, dur: 0.5, vol: 0.03 });
      break;
    case "cardFlip":
      N({ dur: 0.06, vol: 0.07, f: 2400, q: 1 });
      T({ f: 900, to: 600, dur: 0.05, vol: 0.05 });
      break;
    case "shot":
      T({ f: 520, to: 110, dur: 0.14, vol: 0.12, type: "triangle" });
      N({ dur: 0.06, vol: 0.07, f: 1600, q: 0.8 });
      break;
    case "hit":
      T({ f: 140, to: 50, dur: 0.3, vol: 0.32 });
      N({ dur: 0.25, vol: 0.12, filter: "lowpass", f: 2200, to: 300 });
      break;
    case "miss":
      N({ dur: 0.3, vol: 0.06, f: 1200, to: 400, q: 0.5 });
      T({ f: 420, to: 260, dur: 0.18, vol: 0.05 });
      break;
    case "bomb":
      T({ f: 110, to: 32, dur: 0.7, vol: 0.4 });
      N({ dur: 0.7, vol: 0.18, filter: "lowpass", f: 1800, to: 120 });
      break;
    case "radar":
      T({ f: 1180, dur: 0.5, vol: 0.08 });
      T({ f: 1180, at: 0.22, dur: 0.4, vol: 0.035 });
      break;
    case "torpedo":
      N({ dur: 0.5, vol: 0.08, filter: "lowpass", f: 300, to: 1600 });
      T({ f: 160, to: 520, dur: 0.45, vol: 0.06 });
      break;
    case "mine":
      T({ f: 440, dur: 0.1, vol: 0.1, type: "square" });
      T({ f: 660, at: 0.1, dur: 0.14, vol: 0.1, type: "square" });
      break;
    case "sunk":
      T({ f: 220, to: 90, dur: 0.5, vol: 0.2 });
      T({ f: 147, to: 60, at: 0.25, dur: 0.7, vol: 0.2 });
      N({ at: 0.1, dur: 0.9, vol: 0.06, filter: "lowpass", f: 900, to: 120 });
      break;
    case "clue":
      M(note(12), 0, 0.13, 0.35);
      M(note(17), 0.07, 0.13, 0.45);
      break;
    case "assassin":
      T({ f: 82, to: 41, dur: 1.1, vol: 0.4 });
      T({ f: 87, to: 43, dur: 1.1, vol: 0.2 });
      N({ dur: 0.9, vol: 0.08, filter: "lowpass", f: 600, to: 80 });
      break;
    case "guess":
      T({ f: 700, to: 900, dur: 0.08, vol: 0.09, type: "triangle" });
      break;
    case "attack":
      N({ dur: 0.18, vol: 0.1, f: 800, to: 3200, q: 0.6 });
      T({ f: 200, to: 80, at: 0.14, dur: 0.2, vol: 0.25 });
      break;
    case "faint":
      T({ f: 660, to: 110, dur: 0.9, vol: 0.12, type: "triangle" });
      break;
    case "switch":
      N({ dur: 0.18, vol: 0.06, f: 3000, to: 900, q: 0.8 });
      M(note(10), 0.1, 0.1, 0.3);
      break;
  }
}

/** Contexto: closer ranks sound brighter and higher. */
export function playRank(rank: number) {
  const closeness = Math.max(0, 1 - Math.log10(Math.max(rank, 1)) / 4);
  play(rank === 1 ? "win" : "guess", { pitch: 0.7 + closeness * 0.9 });
}
