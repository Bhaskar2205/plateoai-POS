'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The sound a till makes when a guest orders from their phone.
 *
 * Synthesised rather than shipped as a file: it is two notes, a file would be
 * one more request on a restaurant's wifi, and a missing asset would fail
 * silently at exactly the moment somebody needed to hear it.
 *
 * Browsers refuse to play audio until the page has been interacted with. Staff
 * have signed in by the time this matters, which counts - but if the context is
 * still suspended the chime is simply skipped rather than throwing. A till that
 * crashes because it could not beep would be far worse than a quiet one.
 */
function chime(): void {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!Ctor) return;

    const context = new Ctor();

    if (context.state === 'suspended') void context.resume();

    // Two short notes, a fifth apart. Enough to carry across a counter without
    // being the kind of alarm somebody turns the speakers off to escape.
    const notes = [
      { frequency: 880, at: 0 },
      { frequency: 1320, at: 0.16 },
    ];

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;
      oscillator.connect(gain);
      gain.connect(context.destination);

      const start = context.currentTime + note.at;

      // Shaped rather than switched: an abrupt square edge clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

      oscillator.start(start);
      oscillator.stop(start + 0.24);
    }

    window.setTimeout(() => void context.close(), 1200);
  } catch {
    // No audio on this device. The badge still appears.
  }
}

const MUTED_KEY = 'plateo.orderAlertMuted';

const readMuted = (): boolean => {
  try {
    return window.localStorage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * Watches how many diner orders are waiting to be accepted, and says so.
 *
 * Rings only when the number *rises*. The floor is polled every few seconds, so
 * ringing whenever the count is above zero would mean a continuous alarm from
 * the moment one guest orders until somebody got to the till - which is how a
 * restaurant ends up muting the one sound that matters.
 *
 * It is deliberately silent on the first reading. Opening the POS to orders that
 * arrived an hour ago should show a badge, not announce them as new.
 */
export function useOrderAlert(pendingCount: number | undefined) {
  const [muted, setMuted] = useState(false);
  const previous = useRef<number | null>(null);

  // Read once on the client: localStorage does not exist while rendering on the
  // server, and reading it during render is what makes a page hydrate wrong.
  useEffect(() => {
    setMuted(readMuted());
  }, []);

  useEffect(() => {
    if (pendingCount === undefined) return;

    const before = previous.current;

    previous.current = pendingCount;

    if (before === null) return;
    if (pendingCount > before && !muted) chime();
  }, [pendingCount, muted]);

  const toggleMuted = () => {
    setMuted((value) => {
      const next = !value;

      try {
        window.localStorage.setItem(MUTED_KEY, String(next));
      } catch {
        // A browser with storage blocked still mutes for this session.
      }

      return next;
    });
  };

  return { muted, toggleMuted };
}
