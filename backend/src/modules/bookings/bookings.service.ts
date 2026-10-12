import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  AuditAction,
  AuditEntity,
  CLOSED_BOOKING_STATUSES,
  DiscountType,
  TableBookingStatus,
} from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { AuditContext, AuditService } from 'src/modules/audit/audit.service';
import { nextBookingReference, withNumberRetry } from 'src/modules/orders/order-writer';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import {
  BookingDiscountDto,
  CloseBookingDto,
  ConfirmBookingDto,
  CreateBookingDto,
  QueryBookingsDto,
} from './dto/booking.dto';
import { TableBooking } from './entities/table-booking.entity';

/**
 * Table bookings made through the Plateo guest app.
 *
 * The restaurant's side of a promise somebody made on their phone. Every move is
 * a status change with a timestamp and an audit record, because the interesting
 * question afterwards is never "what is this booking" but "who said yes to it,
 * and when" - a table held for a no-show costs a service.
 *
 * Transitions are checked against a table rather than an `if`, so an impossible
 * move is refused in one place and the reason can be read off it.
 */

/** What a booking may become, from where. Anything absent is refused. */
const ALLOWED: Record<TableBookingStatus, TableBookingStatus[]> = {
  [TableBookingStatus.REQUESTED]: [
    TableBookingStatus.CONFIRMED,
    TableBookingStatus.DECLINED,
    TableBookingStatus.CANCELLED,
  ],
  [TableBookingStatus.CONFIRMED]: [
    TableBookingStatus.SEATED,
    TableBookingStatus.CANCELLED,
    TableBookingStatus.NO_SHOW,
  ],
  [TableBookingStatus.SEATED]: [TableBookingStatus.COMPLETED],
  // Terminal. A booking that is over cannot be reopened - the guest would make a
  // new one, and reviving the old row would lose when the first one ended.
  [TableBookingStatus.COMPLETED]: [],
  [TableBookingStatus.DECLINED]: [],
  [TableBookingStatus.CANCELLED]: [],
  [TableBookingStatus.NO_SHOW]: [],
};

const LIVE_STATUSES = Object.values(TableBookingStatus).filter(
  (status) => !CLOSED_BOOKING_STATUSES.includes(status),
);

@Injectable()
export class BookingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TableBooking) private readonly bookings: Repository<TableBooking>,
    @InjectRepository(RestaurantTable) private readonly tables: Repository<RestaurantTable>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Takes a booking from the guest app.
   *
   * Not audited: nobody at the restaurant did this, and an audit log that fills
   * with "a stranger made a booking" stops being the record of what staff did.
   * The booking row is itself the record.
   */
  async create(restaurantId: number, dto: CreateBookingDto): Promise<TableBooking> {
    this.assertDiscountUsable(dto.discount);

    const bookedFor = new Date(dto.bookedFor);

    if (Number.isNaN(bookedFor.getTime())) {
      throw new BadRequestException('That booking time could not be read.');
    }

    // A booking for a time that has passed is a clock problem somewhere, and the
    // restaurant can do nothing useful with it.
    if (bookedFor.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('That booking time is in the past.');
    }

    // Filed against the service it belongs to, not the day it was made, so a
    // booking taken on Monday for Friday appears in Friday's list.
    const businessDate = businessDateFor(bookedFor);

    return withNumberRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(TableBooking);

        return repository.save(
          repository.create({
            restaurantId,
            referenceNumber: await nextBookingReference(manager, restaurantId, businessDate),
            businessDate,
            guestName: dto.guestName,
            guestPhone: dto.guestPhone,
            guestEmail: dto.guestEmail || null,
            partySize: dto.partySize,
            bookedFor,
            guestNote: dto.guestNote || null,
            status: TableBookingStatus.REQUESTED,
            discountType: dto.discount?.type ?? null,
            discountValue: dto.discount?.value ?? null,
            discountReason: dto.discount?.reason ?? null,
          }),
        );
      }),
    );
  }

  /**
   * The booking list.
   *
   * `upcoming` is what the screen opens on: everything still live, whatever day
   * it is for, soonest first. A restaurant cares about what is coming, not about
   * what day it is filed under.
   */
  findAll(restaurantId: number, query: QueryBookingsDto = {}): Promise<TableBooking[]> {
    const wantsUpcoming = query.upcoming === 'true' || (!query.date && !query.status);

    if (wantsUpcoming) {
      return this.bookings.find({
        where: {
          restaurantId,
          status: In(LIVE_STATUSES),
          // Yesterday's unanswered requests still matter - they are a guest who
          // was never replied to - so the window reaches back a day rather than
          // starting at now.
          bookedFor: MoreThanOrEqual(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        },
        relations: { table: true },
        order: { bookedFor: 'ASC' },
        take: 200,
      });
    }

    return this.bookings.find({
      where: {
        restaurantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.date ? { businessDate: query.date } : {}),
      },
      relations: { table: true },
      order: { bookedFor: 'ASC' },
      take: 200,
    });
  }

  async findOne(restaurantId: number, id: number): Promise<TableBooking> {
    const booking = await this.bookings.findOne({
      where: { id, restaurantId },
      relations: { table: true },
    });

    // 404 rather than 403: another restaurant's booking should not be
    // distinguishable from one that does not exist.
    if (!booking) throw new NotFoundException(`Booking ${id} was not found.`);

    return booking;
  }

  async confirm(
    restaurantId: number,
    id: number,
    dto: ConfirmBookingDto,
    userId: number,
    context?: AuditContext,
  ): Promise<TableBooking> {
    const booking = await this.findOne(restaurantId, id);

    this.assertCanBecome(booking, TableBookingStatus.CONFIRMED);

    if (dto.tableId !== undefined) {
      // Checked here rather than trusted: a table id from a client could name
      // another restaurant's table, and the foreign key alone would accept it.
      const table = await this.tables.findOne({
        where: { id: dto.tableId, restaurantId, isActive: true },
      });

      if (!table) throw new NotFoundException(`Table ${dto.tableId} was not found.`);

      booking.tableId = table.id;
    }

    booking.status = TableBookingStatus.CONFIRMED;
    booking.respondedAt = new Date();
    booking.handledByUserId = userId;
    if (dto.note !== undefined) booking.restaurantNote = dto.note || null;

    // Absent leaves whatever the booking came in with; null clears it. The two
    // have to stay distinguishable, or staff could never take back a discount
    // the app promised.
    if (dto.discount !== undefined) {
      this.assertDiscountUsable(dto.discount);

      booking.discountType = dto.discount?.type ?? null;
      booking.discountValue = dto.discount?.value ?? null;
      booking.discountReason = dto.discount?.reason ?? null;
    }

    await this.bookings.save(booking);
    await this.record(booking, AuditAction.BOOKING_CONFIRMED, userId, context);

    return this.findOne(restaurantId, id);
  }

  /** Declining, cancelling, marking a no-show, seating, or closing out. */
  async moveTo(
    restaurantId: number,
    id: number,
    status: TableBookingStatus,
    dto: CloseBookingDto,
    userId: number,
    context?: AuditContext,
  ): Promise<TableBooking> {
    const booking = await this.findOne(restaurantId, id);

    this.assertCanBecome(booking, status);

    booking.status = status;
    booking.handledByUserId = userId;
    if (dto.note !== undefined) booking.restaurantNote = dto.note || null;

    if (status === TableBookingStatus.SEATED) booking.seatedAt = new Date();
    if (
      status === TableBookingStatus.DECLINED ||
      status === TableBookingStatus.CANCELLED ||
      status === TableBookingStatus.NO_SHOW
    ) {
      booking.respondedAt ??= new Date();
    }

    await this.bookings.save(booking);

    const action =
      status === TableBookingStatus.SEATED
        ? AuditAction.BOOKING_SEATED
        : status === TableBookingStatus.DECLINED
          ? AuditAction.BOOKING_DECLINED
          : AuditAction.BOOKING_CLOSED;

    await this.record(booking, action, userId, context);

    return this.findOne(restaurantId, id);
  }

  /** What the dashboard shows: how many are coming, and how many are unanswered. */
  async summary(
    restaurantId: number,
    businessDate: string,
  ): Promise<{ today: number; covers: number; awaitingReply: number; nextAt: string | null }> {
    const [forToday, unanswered] = await Promise.all([
      this.bookings.find({
        where: {
          restaurantId,
          businessDate,
          status: In([
            TableBookingStatus.CONFIRMED,
            TableBookingStatus.SEATED,
            TableBookingStatus.COMPLETED,
          ]),
        },
        order: { bookedFor: 'ASC' },
      }),
      this.bookings.count({
        where: { restaurantId, status: TableBookingStatus.REQUESTED },
      }),
    ]);

    const next = forToday.find((booking) => booking.bookedFor.getTime() >= Date.now()) ?? null;

    return {
      today: forToday.length,
      covers: forToday.reduce((sum, booking) => sum + booking.partySize, 0),
      awaitingReply: unanswered,
      nextAt: next ? next.bookedFor.toISOString() : null,
    };
  }

  /**
   * Bookings that were confirmed for a time that has passed and never seated.
   *
   * Surfaced rather than closed automatically: Plateo cannot tell a no-show from
   * a guest the staff forgot to mark as seated, and quietly recording the first
   * when it was the second would put a mark against somebody who did turn up.
   */
  findStale(restaurantId: number, olderThanMinutes = 45): Promise<TableBooking[]> {
    return this.bookings.find({
      where: {
        restaurantId,
        status: TableBookingStatus.CONFIRMED,
        bookedFor: LessThan(new Date(Date.now() - olderThanMinutes * 60_000)),
      },
      relations: { table: true },
      order: { bookedFor: 'ASC' },
      take: 50,
    });
  }

  /**
   * Refuses a discount the till could never honour.
   *
   * A bill caps any discount at half its subtotal, so a percentage above 50 is a
   * promise that will be refused at the counter. Saying so when the booking is
   * made costs nothing; finding out in front of the guest costs a great deal.
   *
   * A flat amount cannot be checked here - there is no subtotal to check it
   * against until somebody orders - so it is taken at face value.
   */
  private assertDiscountUsable(discount?: BookingDiscountDto | null): void {
    if (!discount) return;

    if (discount.type === DiscountType.PERCENT && discount.value > 50) {
      throw new BadRequestException('A percentage discount may not exceed 50%.');
    }
  }

  private assertCanBecome(booking: TableBooking, next: TableBookingStatus): void {
    if (booking.status === next) {
      throw new BadRequestException(`This booking is already ${next.toLowerCase()}.`);
    }

    if (!ALLOWED[booking.status].includes(next)) {
      throw new BadRequestException(
        `A booking that is ${booking.status.toLowerCase()} cannot become ${next.toLowerCase()}.`,
      );
    }
  }

  private record(
    booking: TableBooking,
    action: AuditAction,
    userId: number,
    context?: AuditContext,
  ): Promise<void> {
    return this.auditService.record({
      restaurantId: booking.restaurantId,
      userId,
      action,
      entityType: AuditEntity.TABLE_BOOKING,
      entityId: booking.id,
      newValue: {
        status: booking.status,
        reference: booking.referenceNumber,
        partySize: booking.partySize,
        bookedFor: booking.bookedFor.toISOString(),
      },
      reason: booking.restaurantNote,
      context,
    });
  }
}
