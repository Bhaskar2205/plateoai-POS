import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { KotStatus, OrderItemStatus } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { QueryKotTicketsDto } from './dto/order-actions.dto';
import { KitchenTicketDto } from './dto/order.dto';
import { KotTicket } from './entities/kot-ticket.entity';
import { toKitchenTicketDto } from './order-mapper';
import { syncTicketItemStatus } from './order-writer';

/** What the kitchen panel shows by default: everything still being worked on. */
const LIVE_STATUSES = [KotStatus.NEW, KotStatus.PREPARING, KotStatus.READY];

/**
 * Which status a ticket may move to next.
 *
 * Forward-only, with one exception: a ticket can be pulled back from READY to
 * PREPARING, because "ready" gets tapped by mistake and a cook must be able to
 * correct it. DONE and CANCELLED are terminal - reopening a finished ticket would
 * put food back on a bill that may already have been settled.
 */
const ALLOWED_TRANSITIONS: Record<KotStatus, KotStatus[]> = {
  [KotStatus.NEW]: [KotStatus.PREPARING, KotStatus.READY, KotStatus.CANCELLED],
  [KotStatus.PREPARING]: [KotStatus.READY, KotStatus.DONE, KotStatus.CANCELLED],
  [KotStatus.READY]: [KotStatus.PREPARING, KotStatus.DONE, KotStatus.CANCELLED],
  [KotStatus.DONE]: [],
  [KotStatus.CANCELLED]: [],
};

/** The line status that goes with each ticket status the kitchen can set. */
const ITEM_STATUS_FOR: Partial<Record<KotStatus, OrderItemStatus>> = {
  [KotStatus.PREPARING]: OrderItemStatus.PREPARING,
  [KotStatus.READY]: OrderItemStatus.READY,
  [KotStatus.DONE]: OrderItemStatus.SERVED,
  [KotStatus.CANCELLED]: OrderItemStatus.CANCELLED,
};

/**
 * The kitchen panel.
 *
 * Deliberately a separate service with its own role list: kitchen staff move
 * tickets through the cook, but never see a bill, a total or a discount. Nothing
 * here returns money.
 */
@Injectable()
export class KitchenService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(KotTicket) private readonly ticketsRepository: Repository<KotTicket>,
  ) {}

  /**
   * Today's tickets, oldest first - a kitchen works a queue, so the ticket that
   * has been waiting longest has to be at the top.
   */
  async findTickets(
    restaurantId: number,
    query: QueryKotTicketsDto = {},
  ): Promise<KitchenTicketDto[]> {
    const statuses = query.status?.length ? query.status : LIVE_STATUSES;

    const tickets = await this.ticketsRepository.find({
      where: {
        restaurantId,
        status: In(statuses),
        businessDate: businessDateFor(),
      },
      relations: { items: true, order: { table: true } },
      order: { createdAt: 'ASC' },
    });

    const now = new Date();

    return tickets.map((ticket) => toKitchenTicketDto(ticket, now));
  }

  async findTicket(restaurantId: number, ticketId: number): Promise<KitchenTicketDto> {
    return toKitchenTicketDto(await this.loadTicket(restaurantId, ticketId));
  }

  /**
   * Moves a ticket along, taking its lines with it.
   *
   * The lines follow the ticket rather than being tracked one by one: a cook works
   * a ticket, and per-line status on a printed KOT is a fiction nobody maintains.
   */
  async updateStatus(
    restaurantId: number,
    ticketId: number,
    status: KotStatus,
  ): Promise<KitchenTicketDto> {
    const ticket = await this.loadTicket(restaurantId, ticketId);

    if (ticket.status === status) {
      return toKitchenTicketDto(ticket);
    }

    if (!ALLOWED_TRANSITIONS[ticket.status].includes(status)) {
      throw new BadRequestException(
        `A ${ticket.status.toLowerCase()} ticket cannot be moved to ${status.toLowerCase()}.`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(KotTicket).update(ticket.id, { status });

      const itemStatus = ITEM_STATUS_FOR[status];

      if (itemStatus) {
        await syncTicketItemStatus(manager, ticket, itemStatus);
      }
    });

    return this.findTicket(restaurantId, ticketId);
  }

  /** Records that the ticket reached a printer, so staff can see what was printed. */
  async markPrinted(restaurantId: number, ticketId: number): Promise<KitchenTicketDto> {
    const ticket = await this.loadTicket(restaurantId, ticketId);

    await this.ticketsRepository.update(ticket.id, { printedAt: new Date() });

    return this.findTicket(restaurantId, ticketId);
  }

  private async loadTicket(restaurantId: number, ticketId: number): Promise<KotTicket> {
    const ticket = await this.ticketsRepository.findOne({
      where: { id: ticketId, restaurantId },
      relations: { items: true, order: { table: true } },
    });

    if (!ticket) {
      throw new NotFoundException(`Kitchen ticket ${ticketId} was not found.`);
    }

    return ticket;
  }
}
