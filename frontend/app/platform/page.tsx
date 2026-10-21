'use client';

import {
  Building2,
  Check,
  Download,
  KeyRound,
  LogOut,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Store,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, platformFetch, platformTokenStorage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';

/**
 * Running Plateo: every restaurant on the platform, and the way new ones are
 * opened.
 *
 * This replaces self-registration. A restaurant exists because somebody here
 * opened the account and handed the owner their credentials - which is what
 * makes the list below the customer list, rather than whoever found a sign-up
 * form.
 *
 * Deliberately shows nothing about what a restaurant sold. Opening and
 * suspending accounts does not require reading a customer's takings, and an
 * operator who cannot read them is a much smaller thing to protect.
 */
interface PlatformRestaurant {
  id: number;
  name: string;
  slug: string;
  publicSlug: string;
  status: 'ACTIVE' | 'INACTIVE';
  address: string | null;
  phone: string | null;
  taxNumber: string | null;
  createdAt: string;
  owners: Array<{ id: number; name: string; email: string; role: string }>;
}

interface Stats {
  restaurants: number;
  active: number;
  suspended: number;
  owners: number;
}

export default function PlatformPage() {
  const router = useRouter();

  const [restaurants, setRestaurants] = useState<PlatformRestaurant[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [opening, setOpening] = useState(false);
  const [resetting, setResetting] = useState<PlatformRestaurant | null>(null);
  const [deleting, setDeleting] = useState<PlatformRestaurant | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const [list, counts] = await Promise.all([
        platformFetch<PlatformRestaurant[]>('/platform/restaurants'),
        platformFetch<Stats>('/platform/stats'),
      ]);

      setRestaurants(list);
      setStats(counts);
      setError(null);
    } catch (caught) {
      // A 401 means the token is gone or expired; anything else is worth showing.
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        platformTokenStorage.clear();
        router.replace('/platform/login');

        return;
      }

      setError(caught);
    }
  };

  useEffect(() => {
    if (!platformTokenStorage.get()) {
      router.replace('/platform/login');

      return;
    }

    void load();
    // Loading once on mount is deliberate: this list changes when somebody here
    // changes it, not on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = () => {
    platformTokenStorage.clear();
    router.replace('/platform/login');
  };

  const setStatus = async (restaurant: PlatformRestaurant) => {
    const next = restaurant.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    try {
      await platformFetch(`/platform/restaurants/${restaurant.id}/status`, {
        method: 'PATCH',
        body: { status: next },
      });

      setNotice(
        next === 'INACTIVE'
          ? `${restaurant.name} is suspended. Their staff are signed out on their next click.`
          : `${restaurant.name} is live again.`,
      );
      await load();
    } catch (caught) {
      setNotice(caught instanceof ApiError ? caught.message : 'That did not work.');
    }
  };

  return (
    <main className="min-h-dvh bg-ground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-ink text-white">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Plateo administration</p>
            <p className="text-xs text-muted">Restaurant accounts on this platform</p>
          </div>
          <Button variant="ghost" onClick={signOut}>
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {notice && (
          <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card">
            {notice}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Restaurants" value={stats?.restaurants} icon={Building2} />
          <Tile label="Live" value={stats?.active} icon={Check} />
          <Tile label="Suspended" value={stats?.suspended} icon={Pause} tone="warn" />
        </div>

        <Card>
          <CardHeader
            title="Restaurants"
            description="Newest first. Opening an account here is the only way a restaurant gets onto Plateo."
            action={
              <Button onClick={() => setOpening(true)}>
                <Plus className="size-4" aria-hidden />
                Open an account
              </Button>
            }
          />

          {error ? (
            <ErrorState error={error} onRetry={() => void load()} />
          ) : restaurants === null ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : restaurants.length === 0 ? (
            <EmptyState
              icon={Store}
              title="No restaurants yet"
              description="Open the first account and hand the owner their credentials."
            />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {restaurants.map((restaurant) => (
                <li key={restaurant.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{restaurant.name}</span>
                      <Badge tone={restaurant.status === 'ACTIVE' ? 'success' : 'danger'} dot>
                        {restaurant.status === 'ACTIVE' ? 'Live' : 'Suspended'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {restaurant.owners.map((owner) => owner.email).join(', ') || 'No owner'}
                      {restaurant.address ? ` · ${restaurant.address}` : ''}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted">
                      /menu/{restaurant.publicSlug}
                    </p>
                    {/* A bill without one is not a tax invoice, so it is worth seeing
                        at a glance which restaurants are missing it. */}
                    {restaurant.taxNumber ? (
                      <p className="mt-0.5 text-[11px] text-muted">
                        GSTIN <span className="font-mono text-ink">{restaurant.taxNumber}</span>
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-warn-600">No GST number on bills</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setResetting(restaurant)}>
                      <KeyRound className="size-4" aria-hidden />
                      Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant={restaurant.status === 'ACTIVE' ? 'secondary' : 'primary'}
                      onClick={() => void setStatus(restaurant)}
                    >
                      {restaurant.status === 'ACTIVE' ? (
                        <>
                          <Pause className="size-4" aria-hidden />
                          Suspend
                        </>
                      ) : (
                        <>
                          <Play className="size-4" aria-hidden />
                          Restore
                        </>
                      )}
                    </Button>
                    {/* Last, and quiet. It is the only action here that cannot be
                        undone, so it should not sit under a thumb heading for
                        Suspend. */}
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(restaurant)}>
                      <Trash2 className="size-4 text-danger-600" aria-hidden />
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {deleting && (
        <DeleteRestaurantDialog
          restaurant={deleting}
          onClose={() => setDeleting(null)}
          onDone={(message) => {
            setDeleting(null);
            setNotice(message);
            void load();
          }}
        />
      )}

      {opening && (
        <OpenAccountDialog
          onClose={() => setOpening(false)}
          onDone={(message) => {
            setOpening(false);
            setNotice(message);
            void load();
          }}
        />
      )}

      {resetting && (
        <ResetPasswordDialog
          restaurant={resetting}
          onClose={() => setResetting(null)}
          onDone={(message) => {
            setResetting(null);
            setNotice(message);
          }}
        />
      )}
    </main>
  );
}

function Tile({
  label,
  value,
  icon: Icon,
  tone = 'calm',
}: {
  label: string;
  value: number | undefined;
  icon: typeof Building2;
  tone?: 'calm' | 'warn';
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-medium text-muted">{label}</span>
          <span
            aria-hidden
            className={cn(
              'grid size-8 place-items-center rounded-lg',
              tone === 'warn' ? 'bg-warn-50 text-warn-600' : 'bg-ground text-muted',
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        {value === undefined ? (
          <Skeleton className="mt-2 h-8 w-12" />
        ) : (
          <p
            className={cn(
              'mt-1 text-3xl font-semibold',
              tone === 'warn' && value > 0 ? 'text-warn-600' : 'text-ink',
            )}
          >
            {value}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Opening an account.
 *
 * The password is typed here and handed to the owner out of band - Plateo never
 * emails it and never shows it again, so the dialog says so plainly rather than
 * letting somebody assume the owner will be told automatically.
 */
function OpenAccountDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    restaurantName: '',
    address: '',
    phone: '',
    taxNumber: '',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      const created = await platformFetch<PlatformRestaurant>('/platform/restaurants', {
        method: 'POST',
        body: {
          restaurantName: form.restaurantName.trim(),
          address: form.address.trim() || undefined,
          phone: form.phone.trim() || undefined,
          taxNumber: form.taxNumber.trim() || undefined,
          ownerName: form.ownerName.trim(),
          ownerEmail: form.ownerEmail.trim(),
          ownerPassword: form.ownerPassword,
        },
      });

      onDone(
        `${created.name} is open. Give ${form.ownerEmail.trim()} their password — Plateo will not show it again.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detailText ?? caught.message)
          : 'Could not open the account.',
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Open a restaurant account"
      description="Creates the restaurant and the owner who signs in to it."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Open account
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm whitespace-pre-line text-danger-600">
            {error}
          </p>
        )}

        <TextField label="Restaurant name" required value={form.restaurantName} onChange={set('restaurantName')} />
        <TextField label="Address" value={form.address} onChange={set('address')} />
        <TextField label="Phone" value={form.phone} onChange={set('phone')} />
        {/* Printed on every bill. Set here so a restaurant that is already
            registered has it from its first bill rather than after somebody
            remembers to fill in a profile field. */}
        <TextField
          label="GST number"
          placeholder="08AAAAA0000A1Z5"
          hint="Printed on every bill under the name and address. The owner can change it later."
          maxLength={32}
          value={form.taxNumber}
          onChange={set('taxNumber')}
        />

        <hr className="border-line" />

        <TextField label="Owner's name" required value={form.ownerName} onChange={set('ownerName')} />
        <TextField
          label="Owner's email"
          type="email"
          required
          hint="What they sign in with."
          value={form.ownerEmail}
          onChange={set('ownerEmail')}
        />
        <TextField
          label="Password"
          type="text"
          required
          hint="At least 8 characters with an uppercase letter, a lowercase letter and a number. Give it to the owner yourself — Plateo never shows it again."
          value={form.ownerPassword}
          onChange={set('ownerPassword')}
        />
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({
  restaurant,
  onClose,
  onDone,
}: {
  restaurant: PlatformRestaurant;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [email, setEmail] = useState(restaurant.owners[0]?.email ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      await platformFetch(`/platform/restaurants/${restaurant.id}/reset-password`, {
        method: 'POST',
        body: { email: email.trim(), newPassword },
      });

      onDone(`Password changed for ${email.trim()}. Give it to them yourself.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detailText ?? caught.message)
          : 'Could not change the password.',
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Reset a password at ${restaurant.name}`}
      description="Plateo has no password reset of its own yet, so this is how somebody locked out gets back in."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Change it
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm whitespace-pre-line text-danger-600">
            {error}
          </p>
        )}

        <TextField
          label="Account"
          type="email"
          required
          hint="Must belong to this restaurant."
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="New password"
          type="text"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </form>
    </Modal>
  );
}

interface DeletionImpact {
  name: string;
  bills: number;
  staff: number;
  /** People who also work at another Plateo restaurant and lose that job too. */
  alsoWorkElsewhere: string[];
}

/**
 * Closing an account for good.
 *
 * Three things stand between a mis-click and a destroyed restaurant: the panel
 * says what will be destroyed, it offers the data back as a file first, and the
 * name has to be typed. None of that is friction for its own sake - this is the
 * only action in Plateo with nothing behind it to undo with.
 */
function DeleteRestaurantDialog({
  restaurant,
  onClose,
  onDone,
}: {
  restaurant: PlatformRestaurant;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [typed, setTyped] = useState('');
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    platformFetch<DeletionImpact>(`/platform/restaurants/${restaurant.id}/deletion-impact`)
      .then((result) => live && setImpact(result))
      .catch(() => live && setImpact(null));

    return () => {
      live = false;
    };
  }, [restaurant.id]);

  /** Hands the restaurant its own records back before they stop existing. */
  const download = async () => {
    setBusy(true);
    setError(null);

    try {
      const data = await platformFetch<Record<string, unknown>>(
        `/platform/restaurants/${restaurant.id}/export`,
      );

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `plateo-${restaurant.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not export. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);

    try {
      const result = await platformFetch<{ name: string; staffDeleted: number }>(
        `/platform/restaurants/${restaurant.id}/delete`,
        { method: 'POST', body: { confirmName: typed.trim() } },
      );

      onDone(
        `${result.name} and ${result.staffDeleted} account${
          result.staffDeleted === 1 ? '' : 's'
        } were deleted.`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete. Try again.');
      setBusy(false);
    }
  };

  const matches = typed.trim() === restaurant.name;

  return (
    <Modal
      open
      title={`Delete ${restaurant.name}?`}
      description="This cannot be undone. Everything below is destroyed permanently."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" loading={busy} disabled={!matches} onClick={() => void remove()}>
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
            {error}
          </p>
        )}

        <div className="rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          <p className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            What goes
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li>
              {impact ? impact.bills : '…'} bill{impact?.bills === 1 ? '' : 's'}, with every line,
              payment and kitchen ticket
            </li>
            <li>The menu, tables, bookings and stock</li>
            <li>
              {impact ? impact.staff : '…'} login{impact?.staff === 1 ? '' : 's'} — the owner and
              every captain
            </li>
            <li>The activity log, which is why this cannot be recorded in it</li>
          </ul>
        </div>

        {/* The consequence nobody should meet afterwards. */}
        {impact && impact.alsoWorkElsewhere.length > 0 && (
          <p className="rounded-lg border border-warn-600/30 bg-warn-50 px-3 py-2 text-xs text-warn-600">
            <span className="font-semibold">
              {impact.alsoWorkElsewhere.join(', ')} also work
              {impact.alsoWorkElsewhere.length === 1 ? 's' : ''} at another Plateo restaurant
            </span>{' '}
            and will lose that job too, because deleting a restaurant deletes every account linked
            to it.
          </p>
        )}

        <div className="rounded-lg border border-line bg-ground px-3 py-2">
          <p className="text-xs text-muted">
            Take a copy first. Once this is done there is nothing to hand back if they ask — a
            restaurant has to keep its bills for years after it closes.
          </p>
          <Button
            size="sm"
            variant={exported ? 'ghost' : 'secondary'}
            className="mt-2"
            loading={busy && !matches}
            onClick={() => void download()}
          >
            <Download className="size-4" aria-hidden />
            {exported ? 'Downloaded — download again' : 'Download their data'}
          </Button>
        </div>

        <TextField
          label={`Type "${restaurant.name}" to confirm`}
          placeholder={restaurant.name}
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
    </Modal>
  );
}
