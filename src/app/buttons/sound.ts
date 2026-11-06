// Tiny Web Audio synth for button feedback. No audio files needed.

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean) {
  muted = value;
}

function audio(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

type ToneOpts = {
  freq: number;
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
};

export function tone({ freq, to, dur = 0.12, type = "sine", gain = 0.25, delay = 0 }: ToneOpts) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function noise({
  dur = 0.05,
  filter = 2000,
  q = 1,
  gain = 0.3,
  type = "bandpass" as BiquadFilterType,
  delay = 0,
}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = filter;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
}

export function buzz(ms: number | number[]) {
  if (muted || typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(ms);
}

// Preset sounds
export const sfx = {
  click: () => {
    noise({ dur: 0.02, filter: 4000, q: 2, gain: 0.5 });
    tone({ freq: 1800, dur: 0.02, type: "square", gain: 0.05 });
    buzz(8);
  },
  clack: (pitch = 1) => {
    noise({ dur: 0.035, filter: 2500 * pitch, q: 3, gain: 0.6 });
    tone({ freq: 180 * pitch, to: 90 * pitch, dur: 0.05, type: "triangle", gain: 0.2 });
    buzz(10);
  },
  thunk: () => {
    tone({ freq: 140, to: 40, dur: 0.25, type: "sine", gain: 0.6 });
    noise({ dur: 0.08, filter: 400, q: 1, gain: 0.5, type: "lowpass" });
    buzz([30, 20, 40]);
  },
  pop: (pitch = 1) => {
    tone({ freq: 500 * pitch, to: 1400 * pitch, dur: 0.06, type: "sine", gain: 0.35 });
    noise({ dur: 0.03, filter: 3000 * pitch, q: 4, gain: 0.25 });
    buzz(12);
  },
  boing: () => {
    tone({ freq: 220, to: 660, dur: 0.15, type: "sine", gain: 0.3 });
    tone({ freq: 660, to: 330, dur: 0.25, type: "sine", gain: 0.2, delay: 0.12 });
    buzz(20);
  },
  squeak: () => {
    tone({ freq: 900, to: 1500, dur: 0.08, type: "square", gain: 0.06 });
    tone({ freq: 1500, to: 1100, dur: 0.12, type: "square", gain: 0.06, delay: 0.08 });
    buzz(15);
  },
  note: (freq: number) => {
    tone({ freq, dur: 0.25, type: "square", gain: 0.08 });
    tone({ freq: freq * 2, dur: 0.12, type: "triangle", gain: 0.05 });
    buzz(10);
  },
  sparkle: () => {
    [1046, 1318, 1568, 2093].forEach((f, i) =>
      tone({ freq: f, dur: 0.18, type: "triangle", gain: 0.12, delay: i * 0.05 })
    );
    buzz([10, 30, 10]);
  },
  whoosh: (power: number) => {
    noise({ dur: 0.3 + power * 0.4, filter: 600 + power * 2500, q: 0.7, gain: 0.4 + power * 0.3 });
    tone({ freq: 120 + power * 300, to: 60, dur: 0.3 + power * 0.3, type: "sawtooth", gain: 0.08 });
    buzz(Math.round(20 + power * 80));
  },
  switchOn: () => {
    noise({ dur: 0.015, filter: 5000, q: 5, gain: 0.6 });
    noise({ dur: 0.02, filter: 2200, q: 5, gain: 0.4, delay: 0.03 });
    buzz(10);
  },
  switchOff: () => {
    noise({ dur: 0.015, filter: 3500, q: 5, gain: 0.5 });
    noise({ dur: 0.02, filter: 1600, q: 5, gain: 0.4, delay: 0.025 });
    buzz(10);
  },
};
