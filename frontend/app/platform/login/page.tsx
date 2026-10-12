'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiError, platformTokenStorage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';

/**
 * Signing in to run Plateo.
 *
 * Its own page and its own token, not a mode of the restaurant login. The two
 * answer different questions - "which restaurant am I" versus "am I Plateo" - and
 * a single form with a toggle would invite somebody to try their restaurant
 * password against the platform.
 *
 * Nothing here says whether an address exists or is an administrator: the API
 * gives one message for every failure, and this page repeats it unchanged.
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await apiFetch<{ accessToken: string }>('/auth/platform/login', {
        method: 'POST',
        anonymous: true,
        body: { email: email.trim(), password },
      });

      platformTokenStorage.set(response.accessToken);
      router.replace('/platform');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not sign in. Try again.',
      );
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <span
            aria-hidden
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink text-white"
          >
            <ShieldCheck className="size-6" />
          </span>
          <h1 className="text-xl font-semibold text-ink">Plateo administration</h1>
          <p className="text-sm text-muted">
            For the people who run Plateo. Restaurant staff sign in on their own app.
          </p>
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
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
