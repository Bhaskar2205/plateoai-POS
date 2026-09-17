'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { registerSchema, type RegisterValues } from '@/lib/schemas';
import type { AuthResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { FormError } from '@/components/ui/states';

export default function RegisterPage() {
  const router = useRouter();
  const { signIn } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      restaurantName: '',
      address: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        // Omit empty optional fields rather than sending '' - the API rejects
        // an address that is present but blank.
        body: {
          name: values.name,
          email: values.email,
          password: values.password,
          restaurantName: values.restaurantName,
          ...(values.address ? { address: values.address } : {}),
        },
        anonymous: true,
      }),
    onSuccess: (response) => {
      // Registration returns a usable token, so onboarding goes straight
      // through to the dashboard without a second sign-in.
      signIn(response);
      router.replace('/restaurant/dashboard');
    },
  });

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-1.5 text-center">
          <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Plateo</p>
          <h1 className="text-2xl font-semibold text-ink">Register your restaurant</h1>
          <p className="text-sm text-muted">
            Creates your owner account and your restaurant in one step.
          </p>
        </header>

        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4 rounded-xl border border-line bg-surface p-5"
          noValidate
        >
          <FormError error={mutation.error} />

          <TextField
            label="Your name"
            autoComplete="name"
            placeholder="Asha Verma"
            required
            error={errors.name?.message}
            {...register('name')}
          />

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
            autoComplete="new-password"
            required
            hint="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
            error={errors.password?.message}
            {...register('password')}
          />

          <hr className="border-line" />

          <TextField
            label="Restaurant name"
            placeholder="The Green Bowl"
            required
            error={errors.restaurantName?.message}
            {...register('restaurantName')}
          />

          <TextField
            label="Address"
            placeholder="Jaipur, Rajasthan"
            hint="Optional. You can add this later from your profile."
            error={errors.address?.message}
            {...register('address')}
          />

          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Create account
          </Button>
        </form>

        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/restaurant/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
