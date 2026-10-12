'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { loginSchema, type LoginValues } from '@/lib/schemas';
import type { AuthResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { FormError, LoadingState } from '@/components/ui/states';

export default function LoginPage() {
  const router = useRouter();
  const { session, isLoading, signIn } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: LoginValues) =>
      apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: values,
        anonymous: true,
      }),
    onSuccess: (response) => {
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
      <main className="grid min-h-dvh place-items-center">
        <LoadingState label="Checking your session..." />
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1.5 text-center">
          <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Plateo</p>
          <h1 className="text-2xl font-semibold text-ink">Restaurant sign in</h1>
          <p className="text-sm text-muted">Manage your menu, dishes and ingredients.</p>
        </header>

        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4 rounded-xl border border-line bg-surface p-5"
          noValidate
        >
          <FormError error={mutation.error} />

          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="owner@example.com"
            required
            error={errors.email?.message}
            {...register('email')}
          />

          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />

          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-muted">
          Plateo accounts are set up for you. Contact Plateo to get your restaurant on board.
        </p>
      </div>
    </main>
  );
}
