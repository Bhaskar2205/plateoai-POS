'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiError, tokenStorage } from '@/lib/api';
import type { AuthResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';

/**
 * A captain signing in at the start of a shift.
 *
 * Two fields, both short. A waiter does this standing up, often one-handed,
 * sometimes on a cracked screen in bad light - every extra field is a reason to
 * share one login for the whole floor instead, which would destroy the only
 * thing that makes per-captain figures mean anything.
 *
 * The code is spelled `inputMode="text"` with autocapitalise off: phone keyboards
 * capitalise the first letter by default, and a captain typing "Ramesh" when the
 * code is "ramesh" would be told their password was wrong. The API folds case
 * too, so this is belt and braces.
 *
 * One message for every failure, repeated from the API unchanged: codes are
 * short enough to guess at, and saying which half was wrong halves the work.
 */
export default function CaptainLoginPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await apiFetch<AuthResponse>('/auth/staff/login', {
        method: 'POST',
        anonymous: true,
        body: { code: code.trim().toLowerCase(), password },
      });

      tokenStorage.set(response.accessToken);
      router.replace('/captain');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in. Try again.');
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-bold text-ink">Captain</h1>
          <p className="text-sm text-muted">Sign in to take orders.</p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
          noValidate
        >
          {error && (
            <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {error}
            </p>
          )}

          <TextField
            label="Your code"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ramesh"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />

          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <Button type="submit" className="w-full" loading={busy}>
            Start shift
          </Button>
        </form>

        <p className="text-center text-xs text-muted">
          Ask your manager for a code. They set it in the POS.
        </p>
      </div>
    </main>
  );
}
