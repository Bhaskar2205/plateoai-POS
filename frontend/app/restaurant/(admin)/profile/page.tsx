'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, ExternalLink, Mail, MapPin, Phone, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/lib/auth-context';
import { useRestaurant, useRestaurantMembers, useUpdateRestaurant } from '@/lib/queries';
import { restaurantProfileSchema, type RestaurantProfileValues } from '@/lib/schemas';
import type { Restaurant } from '@/lib/types';
import { Avatar, initialsOf } from '@/components/dashboard/brand';
import { ROLE_LABELS } from '@/components/dashboard/sidebar';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { TextAreaField, TextField } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, FormError } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';

const toFormValues = (restaurant: Restaurant): RestaurantProfileValues => ({
  name: restaurant.name,
  description: restaurant.description ?? '',
  address: restaurant.address ?? '',
  phone: restaurant.phone ?? '',
  logoUrl: restaurant.logoUrl ?? '',
});

export default function ProfilePage() {
  const { session, refresh } = useAuth();
  const toast = useToast();
  const { data: restaurant, isPending, isError, error, refetch } = useRestaurant();
  const update = useUpdateRestaurant();

  // Only owners (and platform admins) may list the team; the API returns 403 otherwise.
  const canSeeTeam = session?.user.role === 'RESTAURANT_OWNER' || session?.user.role === 'SUPER_ADMIN';
  const members = useRestaurantMembers({ enabled: canSeeTeam });

  const form = useForm<RestaurantProfileValues>({
    resolver: zodResolver(restaurantProfileSchema),
    defaultValues: { name: '', description: '', address: '', phone: '', logoUrl: '' },
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = form;

  // Fill the form once the profile arrives.
  useEffect(() => {
    if (restaurant) reset(toFormValues(restaurant));
  }, [restaurant, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await update.mutateAsync({
        name: values.name,
        // Send null to clear a field; '' would fail the API's length rules.
        description: values.description || null,
        address: values.address || null,
        phone: values.phone || null,
        logoUrl: values.logoUrl || null,
      });

      reset(toFormValues(updated));
      // The header and sidebar show the restaurant name, so refresh the session too.
      await refresh();
      toast.success('Restaurant profile saved.');
    } catch {
      // The error is shown inline by <FormError />.
    }
  });

  const logoPreview = watch('logoUrl');

  return (
    <>
      <PageHeader title="Restaurant profile" description="How your restaurant appears to diners and across Plateo." />

      {isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : isPending ? (
        <ProfileSkeleton />
      ) : (
        <div className="space-y-6">
          <IdentityCard restaurant={restaurant} />

          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card>
              <CardHeader title="Edit details" description="Changes appear on your public menu straight away." />
              <form onSubmit={onSubmit} noValidate>
                <CardBody className="space-y-6">
                  <FormError error={update.error} />

                  <FormSection title="Basics">
                    <TextField id="profile-name" label="Restaurant name" required error={errors.name?.message} {...register('name')} />
                    <TextAreaField
                      id="profile-description"
                      label="Description"
                      placeholder="Seasonal bowls and salads, made fresh every morning."
                      hint="Shown under your name on the public menu."
                      error={errors.description?.message}
                      {...register('description')}
                    />
                  </FormSection>

                  <FormSection title="Contact and location">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        id="profile-address"
                        label="Address"
                        placeholder="C-12, Malviya Nagar, Jaipur 302017"
                        error={errors.address?.message}
                        {...register('address')}
                      />
                      <TextField
                        id="profile-phone"
                        label="Phone"
                        type="tel"
                        placeholder="+91 98765 43210"
                        error={errors.phone?.message}
                        {...register('phone')}
                      />
                    </div>
                  </FormSection>

                  <FormSection title="Branding">
                    <div className="flex items-start gap-4">
                      <LogoTile name={watch('name') || restaurant.name} url={logoPreview ?? ''} className="mt-7" />
                      <div className="min-w-0 flex-1">
                        <TextField
                          id="profile-logo-url"
                          label="Logo URL"
                          placeholder="https://cdn.example.com/logo.png"
                          hint="A full https:// link to a square image. Previewed on the left."
                          error={errors.logoUrl?.message}
                          {...register('logoUrl')}
                        />
                      </div>
                    </div>
                  </FormSection>
                </CardBody>

                <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted" aria-live="polite">
                    {isDirty ? 'You have unsaved changes.' : 'All changes saved.'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => reset(toFormValues(restaurant))}
                      disabled={!isDirty || update.isPending}
                    >
                      Discard
                    </Button>
                    <Button type="submit" loading={update.isPending} disabled={!isDirty}>
                      Save changes
                    </Button>
                  </div>
                </div>
              </form>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader title="At a glance" />
                <CardBody>
                  <dl className="space-y-4">
                    <Fact icon={<MapPin className="size-4" aria-hidden />} label="Address" value={restaurant.address} />
                    <Fact icon={<Phone className="size-4" aria-hidden />} label="Phone" value={restaurant.phone} />
                    {session && (
                      <Fact
                        icon={<Mail className="size-4" aria-hidden />}
                        label="Signed in as"
                        value={`${session.user.name} · ${session.user.email}`}
                      />
                    )}
                    <Fact
                      icon={<CalendarDays className="size-4" aria-hidden />}
                      label="On Plateo since"
                      value={new Date(restaurant.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    />
                  </dl>
                </CardBody>
              </Card>

              {canSeeTeam && (
                <Card>
                  <CardHeader title="Team" description="People who can manage this restaurant." />
                  {members.isError ? (
                    <ErrorState error={members.error} onRetry={() => void members.refetch()} />
                  ) : members.isPending ? (
                    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading team">
                      {[0, 1].map((row) => (
                        <div key={row} className="flex items-center gap-3">
                          <Skeleton className="size-9 rounded-full" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-2/3" />
                            <Skeleton className="h-3 w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : members.data.length === 0 ? (
                    <EmptyState compact icon={Users} title="No team members" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {members.data.map((member) => (
                        <li key={member.id} className="flex items-center gap-3 px-5 py-3">
                          <Avatar name={member.name} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">
                              {member.name}
                              {member.id === session?.user.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-muted">{member.email}</p>
                          </div>
                          <Badge>{ROLE_LABELS[member.role]}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function IdentityCard({ restaurant }: { restaurant: Restaurant }) {
  const menuPath = `/menu/${restaurant.slug}`;

  return (
    <Card className="overflow-hidden">
      <div className="h-16 border-b border-line bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-saffron-50))] sm:h-20" />
      <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:px-6">
        <LogoTile name={restaurant.name} url={restaurant.logoUrl ?? ''} className="-mt-8 size-16 ring-4 ring-surface sm:-mt-10 sm:size-20" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight text-ink">{restaurant.name}</h2>
            <Badge tone={restaurant.status === 'ACTIVE' ? 'success' : 'warn'} dot>
              {restaurant.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          {restaurant.description ? (
            <p className="line-clamp-2 max-w-2xl text-sm text-muted">{restaurant.description}</p>
          ) : (
            <p className="text-sm text-muted/80 italic">No description yet — add one below.</p>
          )}
        </div>
        <div className="flex min-w-0 max-w-full flex-col items-start gap-1 sm:items-end">
          <span className="text-xs text-muted">Public menu</span>
          <Link
            href={menuPath as Route}
            target="_blank"
            rel="noopener"
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-ground px-2.5 py-1.5 font-mono text-xs text-ink ring-1 ring-line transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            <span className="truncate">{menuPath}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/** Logo image, falling back to initials when unset, invalid or failing to load. */
function LogoTile({ name, url, className = '' }: { name: string; url: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usable = /^https?:\/\/\S+$/i.test(url.trim()) && failedUrl !== url;

  return (
    <span
      className={`relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-600 text-lg font-semibold text-white shadow-sm ${className}`}
    >
      {usable ? (
        // Restaurant-supplied URL on any host; next/image would need every host allow-listed.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`${name} logo`} onError={() => setFailedUrl(url)} className="size-full bg-surface object-cover" />
      ) : (
        <span aria-hidden>{initialsOf(name) || '?'}</span>
      )}
    </span>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-xs font-semibold tracking-[0.08em] text-muted uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className={`mt-0.5 text-sm [overflow-wrap:anywhere] ${value ? 'text-ink' : 'text-muted/70 italic'}`}>{value || 'Not set'}</dd>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading restaurant profile">
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-[30rem] rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
