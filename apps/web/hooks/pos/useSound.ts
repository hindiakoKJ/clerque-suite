'use client';

/**
 * useSound — Web Audio API synth tones for POS feedback.
 *
 * Why Web Audio over MP3 files:
 *   - Zero asset bytes shipped to the browser (matters on slow connections)
 *   - No 404 risk if a file path is mistyped
 *   - Deterministic across devices — no codec drift
 *   - Fast (no decode latency on the first cue)
 *
 * Browser autoplay policy: AudioContext starts in 'suspended' state until
 * the user has interacted with the page. We resume() lazily on the first
 * play call, which is always triggered by a user gesture (tap/click) on
 * the POS terminal — so this works without user-visible "click to enable
 * sound" affordances.
 *
 * The four cues map to frontliner intent:
 *   - success: order complete, payment posted (pleasant rising two-note chime)
 *   - warn:    offline save, sync deferred, attention-needed (mid tone)
 *   - error:   server rejection, void failed (low buzz)
 *   - click:   subtle confirmation for low-stakes taps (kept very quiet)
 */

import { useRef, useCallback } from 'react';

export type SoundCue = 'success' | 'warn' | 'error' | 'click';

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export function useSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctxRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, []);

  const tone = useCallback(
    (
      freq: number,
      duration: number,
      type: OscillatorType = 'sine',
      gainStart = 0.15,
      delay = 0,
    ) => {
      const ctx = ensureCtx();
      if (!ctx) return;
      const start = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(gainStart, start);
      // exponential decay sounds more natural than linear
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    },
    [ensureCtx],
  );

  return useCallback(
    (cue: SoundCue) => {
      switch (cue) {
        case 'success':
          // A5 → E6, 80ms then 160ms — rings as "yes, done"
          tone(880, 0.08, 'sine', 0.2);
          tone(1318.5, 0.16, 'sine', 0.2, 0.085);
          break;
        case 'warn':
          // single E5, soft — "saved, but check later"
          tone(659, 0.18, 'sine', 0.16);
          break;
        case 'error':
          // two low square pulses — distinctly different from success
          tone(220, 0.16, 'square', 0.13);
          tone(165, 0.2, 'square', 0.13, 0.18);
          break;
        case 'click':
          // very brief, very quiet — for non-critical taps
          tone(1100, 0.03, 'sine', 0.07);
          break;
      }
    },
    [tone],
  );
}
