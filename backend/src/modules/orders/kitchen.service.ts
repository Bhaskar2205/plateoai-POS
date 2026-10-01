import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { KotStatus, OrderItemStatus } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { QueryKotTicketsDto } from './dto/order-actions.dto';
import { KitchenTicketDto } from './dto/order.dto';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
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
    @InjectRepository(DishIngredient)
    private readonly recipesRepository: Repository<DishIngredient>,
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
    const recipes = await this.recipesFor(restaurantId, tickets);

    return tickets.map((ticket) => toKitchenTicketDto(ticket, now, recipes));
  }

  async findTicket(restaurantId: number, ticketId: number): Promise<KitchenTicketDto> {
    const ticket = await this.loadTicket(restaurantId, ticketId);

    return toKitchenTicketDto(ticket, new Date(), await this.recipesFor(restaurantId, [ticket]));
  }

  /**
   * What goes into every dish on these tickets, in one query.
   *
   * A cook wants to see the components without leaving the board - to start the
   * mise en place, and to answer "does this have nuts in it" without walking to
   * the till. Recipe lines are re-checked against the restaurant, so a dish can
   * never show another tenant's ingredients even if data were mis-linked.
   */
  private async recipesFor(
    restaurantId: number,
    tickets: KotTicket[],
  ): Promise<Map<number, { ingredients: string[]; allergens: string[] }>> {
    const recipes = new Map<number, { ingredients: string[]; allergens: string[] }>();

    const dishIds = [
      ...new Set(
        tickets
          .flatMap((ticket) => ticket.items ?? [])
          .map((item) => item.dishId)
          .filter((dishId): dishId is number => dishId !== null),
      ),
    ];

    if (dishIds.length === 0) return recipes;

    const lines = await this.recipesRepository.find({
      where: { dishId: In(dishIds) },
      relations: { ingredient: true },
      order: { id: 'ASC' },
    });

    for (const line of lines) {
      if (!line.ingredient || line.ingredient.restaurantId !== restaurantId) continue;

      const recipe = recipes.get(line.dishId) ?? { ingredients: [], allergens: [] };

      recipe.ingredients.push(line.ingredient.name);

      const allergen = line.ingredient.allergenInfo?.trim();
      if (allergen && !recipe.allergens.includes(allergen)) recipe.allergens.push(allergen);

      recipes.set(line.dishId, recipe);
    }

    return recipes;
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
