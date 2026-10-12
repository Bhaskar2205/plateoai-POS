'use client';

import { CalendarCheck, CalendarClock, Inbox, Lock, UserRound } from 'lucide-react';
import { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { canTakeOrders } from '@/lib/permissions';
import {
  useBookings,
  useCompleteBooking,
  useConfirmBooking,
  useTables,
  useDeclineBooking,
  useNoShowBooking,
  useSeatBooking,
} from '@/lib/queries';
import type { RestaurantTable, TableBooking } from '@/lib/types';
import { Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { BookingCard, type BookingActions } from '@/components/bookings/booking-card';

/**
 * Tables booked through the Plateo app.
 *
 * Grouped by what the restaurant has to do rather than by time: anything
 * unanswered first, because a guest is waiting on a reply, then everything
 * confirmed and coming. A single list sorted by time buries the one booking
 * somebody needs to act on among twenty that are already settled.
 *
 * Walk-ins are not here and never will be - that is the floor. This is only the
 * promises made through the app.
 */
export default function BookingsPage() {
  const { session } = useAuth();
  const toast = useToast();
  const canAnswer = canTakeOrders(session?.user.role);

  const bookings = useBookings();

  const onError = (error: Error) => toast.error(error);
  const confirm = useConfirmBooking({ onSuccess: () => toast.success('Confirmed.'), onError });
  // Offered on the cards that can still be answered, so a booking can be put
  // on a table at the moment it is confirmed.
  const tables = useTables();
  const decline = useDeclineBooking({ onSuccess: () => toast.success('Declined.'), onError });
  const seat = useSeatBooking({ onSuccess: () => toast.success('Seated.'), onError });
  const complete = useCompleteBooking({ onSuccess: () => toast.success('Closed out.'), onError });
  const noShow = useNoShowBooking({ onSuccess: () => toast.success('Recorded as a no-show.'), onError });

  const busy =
    confirm.isPending || decline.isPending || seat.isPending || complete.isPending || noShow.isPending;

  const actions: BookingActions = {
    confirm: (id, discount, tableId) => confirm.mutate({ id, discount, tableId }),
    decline: (id, note) => decline.mutate({ id, note: note || undefined }),
    seat: (id) => seat.mutate({ id }),
    complete: (id) => complete.mutate({ id }),
    noShow: (id) => noShow.mutate({ id }),
    busy,
  };

  const groups = useMemo(() => split(bookings.data ?? []), [bookings.data]);

  if (!session) return null;

  if (!canAnswer) {
    return (
      <>
        <PageHeader title="Bookings" description="Tables booked through the Plateo app." />
        <EmptyState
          icon={Lock}
          title="Bookings are for the people on the floor"
          description="Answering a booking is a promise made on the restaurant's behalf, so it sits with the staff who take orders."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Tables guests booked through the Plateo app. Walk-ins stay on the floor."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Tile
          label="Waiting on you"
          value={groups.requested.length}
          hint={groups.requested.length > 0 ? 'A guest has not been answered' : 'Nothing unanswered'}
          tone={groups.requested.length > 0 ? 'urgent' : 'calm'}
          icon={Inbox}
        />
        <Tile
          label="Coming"
          value={groups.upcoming.length}
          hint="Confirmed and still to arrive"
          icon={CalendarCheck}
        />
        <Tile
          label="Covers booked"
          value={[...groups.requested, ...groups.upcoming, ...groups.here].reduce(
            (sum, booking) => sum + booking.partySize,
            0,
          )}
          hint="People expected across every live booking"
          icon={UserRound}
        />
      </div>

      {bookings.isError ? (
        <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />
      ) : bookings.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (bookings.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No bookings yet"
            description="When a guest books a table in the Plateo app, it lands here for you to confirm."
          />
        </Card>
      ) : (
        <div className="space-y-8">
          <Section
            title="Waiting on you"
            description="A guest has asked and nobody has replied."
            bookings={groups.requested}
            actions={actions}
            tables={tables.data}
          />
          <Section
            title="In the restaurant"
            description="Arrived and sitting down."
            bookings={groups.here}
            actions={actions}
            tables={tables.data}
          />
          <Section
            title="Coming"
            description="Confirmed, soonest first."
            bookings={groups.upcoming}
            actions={actions}
            tables={tables.data}
          />
        </div>
      )}
    </>
  );
}

/**
 * By what the restaurant has to do about it, not by time.
 *
 * The API already returns live bookings soonest first, so each group keeps that
 * order and only the grouping is added here.
 */
function split(all: TableBooking[]) {
  return {
    requested: all.filter((booking) => booking.status === 'REQUESTED'),
    here: all.filter((booking) => booking.status === 'SEATED'),
    upcoming: all.filter((booking) => booking.status === 'CONFIRMED'),
  };
}

function Section({
  title,
  description,
  bookings,
  actions,
  tables,
}: {
  title: string;
  description: string;
  bookings: TableBooking[];
  actions: BookingActions;
  tables?: RestaurantTable[];
}) {
  if (bookings.length === 0) return null;

  return (
    <section aria-labelledby={`${title}-heading`}>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id={`${title}-heading`} className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-line" />
        <span className="text-xs text-muted">{description}</span>
      </div>

      <ul className="space-y-3">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <BookingCard booking={booking} actions={actions} tables={tables} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'calm',
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Inbox;
  tone?: 'calm' | 'urgent';
}) {
  return (
    <Card className={tone === 'urgent' ? 'border-warn-600/30' : undefined}>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-medium text-muted">{label}</span>
          <span
            aria-hidden
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg',
              tone === 'urgent' ? 'bg-warn-50 text-warn-600' : 'bg-ground text-muted',
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p
          className={cn(
            'mt-1 text-3xl font-semibold',
            tone === 'urgent' ? 'text-warn-600' : 'text-ink',
          )}
        >
          {value}
        </p>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </CardBody>
    </Card>
  );
}
