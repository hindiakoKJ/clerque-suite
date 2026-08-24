'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Kitchen bell for the KDS screen.
 *
 * Three browser realities shape this, and the previous inline implementation
 * fell foul of all three:
 *
 *   1. AUTOPLAY POLICY. An AudioContext created without a prior user gesture
 *      starts `suspended`. An oscillator scheduled into a suspended context
 *      plays in total silence — no error, no sound. A kitchen tablet is
 *      unattended by definition, so the bell was mute exactly where it was
 *      needed. We unlock on the first touch anywhere on the page and expose
 *      `unlocked` so the UI can ask for that one tap.
 *
 *   2. CONTEXT LIMIT. Chrome allows roughly six AudioContexts per page and
 *      then throws. Creating one per chime meant the bell died a few tickets
 *      into a shift. One context is created lazily and reused forever.
 *
 *   3. BACKGROUND THROTTLING. A tablet left on the KDS tab still gets timers,
 *      but a suspended context can drift back to suspended after a screen
 *      lock, so we resume defensively before every ring.
 *
 * The preference is persisted per device — a bell is a property of the tablet
 * bolted to the pass, not of whoever is signed in.
 */

const STORAGE_KEY = 'clerque-kds-chime';

interface Prefs {
  enabled: boolean;
  /** 0..1 */
  volume: number;
  /** How many times the bell rings per new ticket. */
  repeats: number;
}

const DEFAULTS: Prefs = { enabled: true, volume: 0.5, repeats: 2 };

function readPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      volume: Math.min(Math.max(parsed.volume ?? DEFAULTS.volume, 0), 1),
      repeats: Math.min(Math.max(Math.round(parsed.repeats ?? DEFAULTS.repeats), 1), 5),
    };
  } catch {
    return DEFAULTS;
  }
}

export function useKitchenChime() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [unlocked, setUnlocked] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const prefsRef = useRef<Prefs>(DEFAULTS);

  // Hydrate after mount so server and client markup match.
  useEffect(() => {
    const p = readPrefs();
    setPrefs(p);
    prefsRef.current = p;
  }, []);

  const persist = useCallback((next: Prefs) => {
    setPrefs(next);
    prefsRef.current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode — the bell still works for this session.
    }
  }, []);

  /** Lazily create the single context, resuming it if the browser parked it. */
  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) {
      try {
        ctxRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }, []);

  /**
   * Ring the bell. `force` bypasses the enabled check so a Test button can
   * always be heard — that is also the gesture that unlocks audio.
   */
  const ring = useCallback(
    (opts: { force?: boolean } = {}) => {
      const p = prefsRef.current;
      if (!opts.force && !p.enabled) return;

      const ctx = getCtx();
      if (!ctx) return;

      // Two-tone ding, repeated. Short and bright so it carries over an
      // extractor fan without being shrill.
      const now = ctx.currentTime;
      const gap = 0.42;
      for (let r = 0; r < p.repeats; r++) {
        const base = now + r * gap;
        [988, 1319].forEach((freq, i) => {
          const start = base + i * 0.11;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, start);
          osc.connect(gain);
          gain.connect(ctx.destination);
          // Exponential ramps cannot touch zero, hence the tiny floor.
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(Math.max(p.volume, 0.0002), start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
          osc.start(start);
          osc.stop(start + 0.32);
        });
      }
    },
    [getCtx],
  );

  // Unlock on the first interaction anywhere. Passive, once, then gone.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let done = false;
    const unlock = () => {
      if (done) return;
      done = true;
      const ctx = getCtx();
      if (ctx && ctx.state !== 'suspended') setUnlocked(true);
      else if (ctx) void ctx.resume().then(() => setUnlocked(true)).catch(() => {});
      remove();
    };
    const remove = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
    return remove;
  }, [getCtx]);

  return {
    enabled: prefs.enabled,
    volume: prefs.volume,
    repeats: prefs.repeats,
    /** False until the browser has let us start audio — show a "tap to enable" hint. */
    unlocked,
    setEnabled: (enabled: boolean) => persist({ ...prefsRef.current, enabled }),
    setVolume: (volume: number) => persist({ ...prefsRef.current, volume }),
    setRepeats: (repeats: number) => persist({ ...prefsRef.current, repeats }),
    ring,
    /** Ring regardless of the toggle, and mark audio unlocked — for a Test button. */
    test: () => {
      ring({ force: true });
      setUnlocked(true);
    },
  };
}
