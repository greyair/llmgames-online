import type { ReplaySoundEvent, ReplaySoundKind } from "./replayTimeline";

const SAMPLE_RATE = 48_000;

function seededNoise(length: number, seed: number): Float32Array {
  const data = new Float32Array(length);
  let value = seed >>> 0;

  for (let index = 0; index < length; index += 1) {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    data[index] = ((value / 0xffff_ffff) * 2 - 1) * (1 - index / length);
  }

  return data;
}

function addTone(
  context: OfflineAudioContext,
  destination: AudioNode,
  at: number,
  frequency: number,
  duration: number,
  gainValue: number,
  type: OscillatorType = "sine",
  slideTo?: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);

  if (slideTo !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, slideTo), at + duration);
  }

  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

function addNoise(
  context: OfflineAudioContext,
  destination: AudioNode,
  at: number,
  duration: number,
  gainValue: number,
  seed: number,
  frequency = 1_600,
) {
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  buffer.getChannelData(0).set(seededNoise(length, seed));
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 0.72;
  gain.gain.value = gainValue;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(at);
}

function scheduleCue(
  context: OfflineAudioContext,
  destination: AudioNode,
  event: ReplaySoundEvent,
  index: number,
) {
  const at = Math.max(0, event.at);
  const seed = 0x5f37_59df ^ (index * 2_654_435_761);

  const tone = (
    offset: number,
    frequency: number,
    duration: number,
    gain: number,
    type?: OscillatorType,
    slideTo?: number,
  ) => addTone(context, destination, at + offset, frequency, duration, gain, type, slideTo);

  const noise = (offset: number, duration: number, gain: number, frequency?: number) =>
    addNoise(context, destination, at + offset, duration, gain, seed + offset * 10_000, frequency);

  const recipes: Record<ReplaySoundKind, () => void> = {
    start: () => {
      tone(0, 330, 0.16, 0.09, "triangle", 440);
      tone(0.11, 494, 0.18, 0.08, "triangle", 660);
      tone(0.23, 660, 0.28, 0.09, "sine", 880);
    },
    deal: () => {
      noise(0, 0.06, 0.07, 1_900);
      tone(0, 230, 0.09, 0.055, "triangle", 150);
      noise(0.11, 0.055, 0.065, 2_050);
      tone(0.11, 250, 0.08, 0.05, "triangle", 165);
      noise(0.22, 0.05, 0.06, 2_200);
    },
    card: () => {
      noise(0, 0.055, 0.065, 1_950);
      tone(0, 235, 0.09, 0.055, "triangle", 145);
    },
    drop: () => {
      tone(0, 620, 0.2, 0.09, "sine", 145);
      noise(0.14, 0.06, 0.07, 520);
    },
    flip: () => {
      noise(0, 0.08, 0.06, 1_700);
      tone(0, 300, 0.16, 0.07, "sine", 650);
      tone(0.11, 760, 0.1, 0.045, "triangle", 520);
    },
    chip: () => {
      noise(0, 0.035, 0.055, 2_600);
      tone(0, 920, 0.065, 0.065, "triangle", 700);
      tone(0.06, 1_080, 0.055, 0.045, "triangle", 820);
    },
    click: () => tone(0, 620, 0.055, 0.035, "triangle", 500),
    cancel: () => tone(0, 420, 0.13, 0.055, "triangle", 190),
    clue: () => {
      tone(0, 440, 0.14, 0.065, "sine", 550);
      tone(0.12, 660, 0.2, 0.075, "sine", 820);
    },
    reveal: () => {
      noise(0, 0.05, 0.04, 1_800);
      tone(0, 560, 0.15, 0.07, "triangle", 760);
    },
    cannon: () => {
      noise(0, 0.13, 0.13, 390);
      tone(0, 135, 0.22, 0.13, "sawtooth", 58);
    },
    bomb: () => {
      noise(0, 0.3, 0.17, 250);
      tone(0, 92, 0.42, 0.16, "sawtooth", 38);
      tone(0.08, 48, 0.38, 0.12, "sine", 30);
    },
    radar: () => {
      tone(0, 780, 0.3, 0.08, "sine", 1_020);
      tone(0.31, 880, 0.24, 0.06, "sine", 1_120);
    },
    torpedo: () => {
      noise(0, 0.16, 0.08, 460);
      tone(0, 210, 0.45, 0.1, "sawtooth", 64);
    },
    hit: () => {
      noise(0, 0.09, 0.1, 700);
      tone(0, 190, 0.14, 0.085, "square", 115);
    },
    miss: () => {
      noise(0, 0.16, 0.065, 1_050);
      tone(0.04, 310, 0.13, 0.04, "sine", 220);
    },
    sink: () => {
      noise(0, 0.16, 0.11, 560);
      tone(0, 250, 0.34, 0.1, "sawtooth", 62);
      tone(0.18, 145, 0.32, 0.08, "triangle", 48);
    },
    timeout: () => {
      tone(0, 520, 0.11, 0.06, "square", 400);
      tone(0.15, 390, 0.14, 0.06, "square", 280);
    },
    win: () => {
      tone(0, 523.25, 0.18, 0.1, "sine");
      tone(0.13, 659.25, 0.18, 0.1, "sine");
      tone(0.26, 783.99, 0.2, 0.11, "sine");
      tone(0.4, 1_046.5, 0.42, 0.12, "sine");
    },
    draw: () => {
      tone(0, 440, 0.18, 0.065, "sine");
      tone(0.16, 440, 0.25, 0.055, "triangle", 392);
    },
  };

  recipes[event.kind]();
}

export async function renderReplayAudio(
  sounds: ReplaySoundEvent[],
  duration: number,
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    2,
    Math.ceil(Math.max(0.1, duration) * SAMPLE_RATE),
    SAMPLE_RATE,
  );

  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  compressor.threshold.value = -12;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;
  master.gain.value = 0.9;
  compressor.connect(master);
  master.connect(context.destination);

  const bass = context.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 260;
  bass.gain.value = 6;
  bass.connect(compressor);
  sounds.forEach((event, index) => scheduleCue(context, bass, event, index));

  return context.startRendering();
}
