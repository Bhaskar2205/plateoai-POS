'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { loginSchema, type LoginValues } from '@/lib/schemas';
import type { AuthResponse } from '@/lib/types';
import { PlateoLogo } from '@/components/dashboard/brand';
import { Button } from '@/components/ui/button';
import { FormError, LoadingState } from '@/components/ui/states';

/**
 * Where a restaurant starts its day.
 *
 * Most people who see this screen are standing at a till at eight in the
 * morning, and they see it every single shift. So it is built for speed and
 * recognition rather than for persuasion: the brand says whose software this is,
 * and everything else is two fields and a button.
 *
 * There is no sign-up. A restaurant exists on Plateo because somebody at Plateo
 * opened the account, and a form promising otherwise would only produce
 * confusion and support calls.
 */

/** Where a remembered address is kept. Never the password - see `Remembered`. */
const REMEMBERED_EMAIL_KEY = 'plateo.rememberedEmail';

export default function LoginPage() {
  const router = useRouter();
  const { session, isLoading, signIn } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  /**
   * Blank until the browser says what year it is.
   *
   * `new Date()` during render is read on the server too, and the two can
   * disagree - across a new year, or when a till's clock is wrong. That is a
   * hydration mismatch for the sake of four characters in a footer, so the year
   * arrives after mount instead.
   */
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => setYear(new Date().getFullYear()), []);

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  /**
   * Fills in a remembered address.
   *
   * In an effect, never during render: the server has no browser storage to read,
   * so deciding here what the first paint contains is how a page ends up with
   * markup the server never sent, and React throws the whole tree away.
   */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);

      if (!saved) return;

      setRemember(true);
      setValue('email', saved);
      // They only need to type the password, so start them there.
      setFocus('password');
    } catch {
      // Storage blocked. The form still works, it just starts empty.
    }
  }, [setValue, setFocus]);

  const mutation = useMutation({
    mutationFn: (values: LoginValues) =>
      apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: values,
        anonymous: true,
      }),
    onSuccess: (response, values) => {
      try {
        if (remember) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, values.email);
        else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      } catch {
        // Nothing to remember with. Signing in still works.
      }

      signIn(response);
      router.replace('/restaurant/dashboard');
    },
  });

  // Someone who is already signed in has no business on the login screen.
  useEffect(() => {
    if (!isLoading && session) {
      router.replace('/restaurant/dashboard');
    }
  }, [isLoading, session, router]);

  if (isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-ground">
        <LoadingState label="Checking your session..." />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-ground lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* The brand half. Hidden on a phone, where the screen belongs to the
          form - a logo that pushes the password field below the fold is
          decoration charged to the person trying to work. */}
      <aside className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(47,125,82,.45),transparent_55%),radial-gradient(circle_at_85%_80%,rgba(234,88,12,.35),transparent_50%)]"
        />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-white/80 uppercase backdrop-blur">
            <ShieldCheck className="size-3.5" aria-hidden />
            Restaurant admin
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-semibold text-balance text-white">
            Everything your floor needs, on one screen.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Menus, orders, kitchen tickets, stock and the day&rsquo;s takings — the whole service
            from the moment a guest scans the code to the moment the bill settles.
          </p>
        </div>

        <p className="relative text-xs text-white/50">
          © {year ?? ''} PlateoAI. Eat with complete trust.
        </p>
      </aside>

      <div className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <header className="text-center">
            {/* The same component the admin's masthead uses, so the product
                does not introduce itself twice in two different sizes. */}
            <PlateoLogo className="mx-auto h-10 sm:h-11" priority />
            <h1 className="mt-5 text-xl font-semibold text-ink sm:text-2xl">Sign in</h1>
            <p className="mt-1 text-sm text-muted">Welcome back. Let&rsquo;s open the doors.</p>
          </header>

          <form
            onSubmit={handleSubmit((values) => mutation.mutate(values))}
            className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
            noValidate
          >
            <FormError error={mutation.error} />

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
              <span className="relative block">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="owner@restaurant.in"
                  aria-invalid={errors.email ? 'true' : undefined}
                  className="h-12 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-base text-ink transition-colors focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none"
                  {...register('email')}
                />
              </span>
              {errors.email?.message && (
                <span role="alert" className="mt-1 block text-xs font-medium text-danger-600">
                  {errors.email.message}
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Password</span>
              <span className="relative block">
                <Lock
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={errors.password ? 'true' : undefined}
                  className="h-12 w-full rounded-xl border border-line bg-surface pr-11 pl-9 text-base text-ink transition-colors focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none"
                  {...register('password')}
                />
                {/* Typing a password you cannot see, one-handed, on a till at
                    the start of a shift, is where most failed sign-ins come
                    from. */}
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </span>
              {errors.password?.message && (
                <span role="alert" className="mt-1 block text-xs font-medium text-danger-600">
                  {errors.password.message}
                </span>
              )}
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-line text-brand-600 focus:ring-2 focus:ring-brand-500/30"
              />
              <span className="text-sm text-ink">
                Remember me on this device
                <span className="mt-0.5 block text-xs text-muted">
                  Fills in your email next time. Let your browser save the password — Plateo never
                  stores it on the device.
                </span>
              </span>
            </label>

            <Button type="submit" className="h-12 w-full text-base" loading={mutation.isPending}>
              Sign in
            </Button>
          </form>

          <p className="mt-5 text-center text-xs leading-relaxed text-muted">
            Plateo accounts are opened for you. Contact Plateo to get your restaurant on board.
          </p>

          <p className="mt-6 text-center text-[11px] text-muted lg:hidden">
            © {year ?? ''} PlateoAI
          </p>
        </div>
      </div>
    </main>
  );
}
