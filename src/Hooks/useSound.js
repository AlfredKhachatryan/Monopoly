// Small synthesised sounds and haptics. No audio files, so nothing to ship or
// licence: every cue is a couple of oscillators with an envelope.
//
// Two platform limits worth knowing:
//   - iOS Safari will not start an AudioContext until a user gesture, so
//     `unlock()` is called from the first tap anywhere on the screen.
//   - iOS Safari does not implement navigator.vibrate at all, so haptics are
//     Android only. Everything is guarded, nothing throws.

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "monopoly.muted";

const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

function tone(ctx, { freq, dur = 0.12, type = "sine", gain = 0.12, at = 0, to }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const t0 = ctx.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// Filtered white noise, for the dice rattle.
function noise(ctx, { dur = 0.3, gain = 0.1 } = {}) {
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // fade the rattle out rather than cutting it
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 1.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1400;
  band.Q.value = 0.8;
  const env = ctx.createGain();
  env.gain.value = gain;
  src.connect(band).connect(env).connect(ctx.destination);
  src.start();
}

const CUES = {
  turn: (ctx) => {
    tone(ctx, { freq: 660, dur: 0.1 });
    tone(ctx, { freq: 880, dur: 0.14, at: 0.1 });
  },
  roll: (ctx) => noise(ctx, { dur: 0.32 }),
  land: (ctx) => tone(ctx, { freq: 440, dur: 0.1, type: "triangle" }),
  moneyIn: (ctx) => {
    tone(ctx, { freq: 523, dur: 0.1 });
    tone(ctx, { freq: 784, dur: 0.16, at: 0.08 });
  },
  moneyOut: (ctx) => {
    tone(ctx, { freq: 392, dur: 0.1, type: "triangle" });
    tone(ctx, { freq: 262, dur: 0.2, at: 0.08, type: "triangle" });
  },
  buy: (ctx) => {
    tone(ctx, { freq: 523, dur: 0.12 });
    tone(ctx, { freq: 659, dur: 0.12, at: 0.06 });
    tone(ctx, { freq: 784, dur: 0.2, at: 0.12 });
  },
  build: (ctx) => {
    tone(ctx, { freq: 880, dur: 0.05, type: "square", gain: 0.06 });
    tone(ctx, { freq: 1180, dur: 0.06, at: 0.07, type: "square", gain: 0.06 });
  },
  card: (ctx) => tone(ctx, { freq: 700, dur: 0.18, type: "triangle", to: 950 }),
  jail: (ctx) => tone(ctx, { freq: 170, dur: 0.35, type: "square", gain: 0.09 }),
  bankrupt: (ctx) => tone(ctx, { freq: 330, dur: 0.7, type: "sawtooth", gain: 0.1, to: 90 }),
  win: (ctx) => {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone(ctx, { freq: f, dur: i === 3 ? 0.4 : 0.14, at: i * 0.11 }),
    );
  },
};

const BUZZ = {
  turn: [40, 60, 40],
  roll: 25,
  jail: [90, 50, 90],
  bankrupt: [200, 80, 200],
  win: [60, 40, 60, 40, 140],
  buy: 35,
  moneyOut: 45,
};

export function useSound() {
  const ctxRef = useRef(null);
  const [muted, setMuted] = useState(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, muted ? "1" : "0");
    } catch {
      /* private mode, not worth caring about */
    }
  }, [muted]);

  const unlock = useCallback(() => {
    try {
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        ctxRef.current = new Ctx();
      }
      if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    } catch {
      ctxRef.current = null;
    }
  }, []);

  const play = useCallback(
    (name) => {
      if (muted) return;
      try {
        unlock();
        const ctx = ctxRef.current;
        if (ctx && ctx.state === "running" && CUES[name]) CUES[name](ctx);
      } catch {
        /* audio is a nicety; never let it break a turn */
      }
      try {
        const pattern = BUZZ[name];
        if (pattern && typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(pattern);
        }
      } catch {
        /* same */
      }
    },
    [muted, unlock],
  );

  useEffect(() => {
    return () => {
      try {
        ctxRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { play, muted, setMuted, unlock };
}
