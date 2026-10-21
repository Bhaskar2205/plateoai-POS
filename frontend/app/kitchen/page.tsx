'use client';

import { ChefHat, CircleAlert, Loader2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { kitchenSession, signInWithCode } from '@/lib/kitchen-session';

/**
 * The kitchen sign-in.
 *
 * A cook signs in once on a tablet that then sits on a wall for weeks, so this
 * screen does one thing: take a six-character code and get out of the way. There
 * is no email, no password and no account behind it - the code *is* the
 * credential, and the owner reads it out of the admin app.
 *
 * Built for a kitchen: very large type, six separate boxes so a fat finger lands
 * somewhere useful, and paste support for the case where the code was messaged
 * to whoever is setting the screen up.
 */
const CODE_LENGTH = 6;

export default function KitchenLoginPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  // A screen that is already signed in goes straight to the board.
  useEffect(() => {
    if (kitchenSession.read()) router.replace('/kitchen/board' as Route);
  }, [router]);

  const code = digits.join('');

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;

    setBusy(true);
    setError(null);

    try {
      kitchenSession.write(await signInWithCode(value));
      router.replace('/kitchen/board' as Route);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'That code was not recognised.');
      setDigits(Array(CODE_LENGTH).fill(''));
      inputs.current[0]?.focus();
      setBusy(false);
    }
  };

  const setAt = (index: number, raw: string) => {
    // Typing, or pasting the whole code into any box.
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (cleaned.length > 1) {
      const filled = cleaned.slice(0, CODE_LENGTH).split('');
      const next = Array(CODE_LENGTH)
        .fill('')
        .map((_, position) => filled[position] ?? '');

      setDigits(next);
      void submit(next.join(''));
      return;
    }

    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);

    if (cleaned && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
    if (next.every(Boolean)) void submit(next.join(''));
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4 py-10">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand-600 text-white">
          <ChefHat className="size-8" aria-hidden />
        </span>

        <h1 className="mt-5 text-3xl font-bold tracking-tight text-white">Kitchen screen</h1>
        <p className="mt-2 text-sm text-white/60">
          Enter the kitchen code from your restaurant&apos;s admin app, under Settings.
        </p>

        <div className="mt-8 flex justify-center gap-2 sm:gap-3">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              value={digit}
              onChange={(event) => setAt(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && !digits[index] && index > 0) {
                  inputs.current[index - 1]?.focus();
                }
              }}
              disabled={busy}
              autoFocus={index === 0}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label={`Kitchen code character ${index + 1}`}
              className={cn(
                // Six boxes at 56px plus their gaps are wider than a 360px
                // phone, which pushed the whole screen sideways. They start
                // small enough to fit the narrowest handset and grow from there.
                'size-11 rounded-xl border-2 bg-white/5 text-center text-xl font-bold text-white uppercase sm:size-14 sm:text-2xl md:size-16 md:text-3xl',
                'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 focus:outline-none',
                error ? 'border-danger-500' : 'border-white/20',
              )}
            />
          ))}
        </div>

        <div className="mt-5 min-h-12">
          {busy && (
            <p className="inline-flex items-center gap-2 text-sm text-white/70">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Signing in…
            </p>
          )}

          {error && !busy && (
            <p
              role="alert"
              className="inline-flex items-start gap-2 rounded-xl bg-danger-500/15 px-4 py-2.5 text-sm font-medium text-danger-100"
            >
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void submit(code)}
          disabled={code.length !== CODE_LENGTH || busy}
          className="h-12 w-full rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Open the kitchen board
        </button>

        <p className="mt-8 text-xs text-white/40">
          This screen only shows what to cook. It cannot see bills, prices or takings.
        </p>
      </div>
    </main>
  );
}
