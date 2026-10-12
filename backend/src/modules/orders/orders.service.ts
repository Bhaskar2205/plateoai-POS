import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  AuditAction,
  AuditEntity,
  DiscountType,
  IdempotencyScope,
  KotStatus,
  MAX_DISCOUNT_PERCENT,
  OrderItemStatus,
  OrderSource,
  OrderStatus,
} from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { lineTotal, toPaise } from 'src/common/utils/money.util';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import type { TaxComponentInput } from 'src/common/utils/tax.util';
import { AuditService, type AuditContext } from 'src/modules/audit/audit.service';
import { InventoryService } from 'src/modules/inventory/inventory.service';
import { IdempotencyService } from 'src/modules/idempotency/idempotency.service';
import { TaxComponent } from 'src/modules/taxes/entities/tax-component.entity';
import { loadTaxComponents } from 'src/modules/taxes/tax-profile';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import {
  ApplyDiscountDto,
  ApproveOrderItemsDto,
  CancelOrderDto,
  CancelOrderItemDto,
  MarkItemNonChargeableDto,
  MarkOrderNonChargeableDto,
  QueryOrdersDto,
  SettleOrderDto,
  UpdateOrderItemDto,
} from './dto/order-actions.dto';
import { AddOrderItemsDto, CreateOrderDto, SetTdsDto } from './dto/order-input.dto';
import { BillDto, KotPrintDto, OrderDto, TableOrderSummaryDto } from './dto/order.dto';
import { KotTicket } from './entities/kot-ticket.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import {
  isAwaitingApproval,
  wasMade,
  isUnsent,
  toBillDto,
  toKotPrintDto,
  toOrderDto,
  toTableOrderSummaryDto,
} from './order-mapper';
import {
  buildOrderItems,
  insertOrder,
  nextOrderNumber,
  nextTicketNumber,
  recalculateOrder,
  withNumberRetry,
} from './order-writer';

/**
 * Table ordering and billing for staff.
 *
 * Every method takes the `restaurantId` from the access token and filters on it,
 * so an id belonging to another restaurant is simply "not found" - a tenant can
 * neither read nor bill another tenant's table. Role checks live on the
 * controller: taking an order and settling one are deliberately different
 * permissions.
 *
 * Money is never accepted from a client. Prices are snapshotted from the menu,
 * totals are recomputed from the order's own lines after every change, and the
 * tax rate is frozen onto the bill at settlement.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemsRepository: Repository<OrderItem>,
    @InjectRepository(KotTicket) private readonly ticketsRepository: Repository<KotTicket>,
    @InjectRepository(RestaurantTable) private readonly tablesRepository: Repository<RestaurantTable>,
    @InjectRepository(Restaurant) private readonly restaurantsRepository: Repository<Restaurant>,
    @InjectRepository(TaxComponent)
    private readonly taxComponentsRepository: Repository<TaxComponent>,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly inventoryService: InventoryService,
  ) {}

  /** Opens a bill, optionally with its first lines already on it. */
  async create(
    restaurantId: number,
    userId: number,
    dto: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<OrderDto> {
    const outcome = await this.idempotencyService.run(
      {
        scope: IdempotencyScope.ORDER_CREATE,
        key: idempotencyKey,
        restaurantId,
        payload: dto,
        resourceType: 'ORDER',
      },
      () => this.createOnce(restaurantId, userId, dto),
    );

    return outcome.result;
  }

  private async createOnce(
    restaurantId: number,
    userId: number,
    dto: CreateOrderDto,
  ): Promise<OrderDto> {
    const tableId = dto.tableId ?? null;

    if (tableId !== null) {
      await this.assertTableAvailable(restaurantId, tableId);
    }

    const components = await this.taxComponentsFor(restaurantId);

    const orderId = await withNumberRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const businessDate = businessDateFor();

        const order = await insertOrder(manager, {
          restaurantId,
          tableId,
          orderNumber: await nextOrderNumber(manager, restaurantId, businessDate),
          source: OrderSource.STAFF,
          openedByUserId: userId,
          notes: dto.notes || null,
          taxRate: 0,
        });

        // Staff lines are approved by the act of a staff member entering them;
        // they wait for a KOT, not for a review.
        await this.appendItems(manager, restaurantId, order.id, dto.items, {
          status: OrderItemStatus.QUEUED,
          createdByUserId: userId,
        });

        await recalculateOrder(manager, order.id, components);

        return order.id;
      }),
    );

    return this.findOne(restaurantId, orderId);
  }

  /**
   * The orders a till needs to see now.
   *
   * Open bills are always included whatever their date - a table left open
   * overnight must still be reachable and settleable in the morning. Closed bills
   * are scoped to today's business day, because yesterday's takings belong in
   * reporting rather than in the live list.
   */
  async findAll(restaurantId: number, query: QueryOrdersDto = {}): Promise<OrderDto[]> {
    const table = query.tableId ? { tableId: query.tableId } : {};
    const today = businessDateFor();

    const scope =
      query.status === OrderStatus.OPEN
        ? [{ restaurantId, status: OrderStatus.OPEN, ...table }]
        : query.status
          ? [{ restaurantId, status: query.status, businessDate: today, ...table }]
          : [
              { restaurantId, status: OrderStatus.OPEN, ...table },
              { restaurantId, businessDate: today, ...table },
            ];

    const orders = await this.ordersRepository.find({
      where: scope,
      relations: { items: true, table: true, charges: true },
      order: { createdAt: 'DESC' },
    });

    const ticketsByOrder = await this.ticketsFor(orders.map((order) => order.id));

    return orders.map((order) => toOrderDto(order, ticketsByOrder.get(order.id) ?? []));
  }

  async findOne(restaurantId: number, id: number): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, id);
    const tickets = await this.ticketsFor([order.id]);

    return toOrderDto(order, tickets.get(order.id) ?? []);
  }

  /**
   * Every table with whatever is happening at it: what the Tables page shows.
   *
   * One query per concern rather than a join, so a table with no bill is a null
   * rather than a missing row.
   */
  async findTableSummaries(restaurantId: number): Promise<TableOrderSummaryDto[]> {
    const tables = await this.tablesRepository.find({
      where: { restaurantId },
      order: { name: 'ASC' },
    });

    const openOrders = await this.ordersRepository.find({
      where: { restaurantId, status: OrderStatus.OPEN },
      relations: { items: true },
    });

    const byTable = new Map<number, Order>();
    for (const order of openOrders) {
      if (order.tableId !== null) byTable.set(order.tableId, order);
    }

    // One query for every table's tickets, so the floor view stays a fixed number
    // of queries however many tables a restaurant has.
    const ticketsByOrder = await this.ticketsFor(openOrders.map((order) => order.id));

    return tables.map((table) => {
      const order = byTable.get(table.id) ?? null;

      return toTableOrderSummaryDto(
        table,
        order,
        order ? (ticketsByOrder.get(order.id) ?? []) : [],
      );
    });
  }

  /** The open bill at a table, or null when the table is free. */
  async findOpenForTable(restaurantId: number, tableId: number): Promise<OrderDto | null> {
    await this.assertTableExists(restaurantId, tableId);

    const order = await this.ordersRepository.findOne({
      where: { restaurantId, tableId, status: OrderStatus.OPEN },
      relations: { items: true, table: true, charges: true },
    });

    if (!order) return null;

    const tickets = await this.ticketsFor([order.id]);

    return toOrderDto(order, tickets.get(order.id) ?? []);
  }

  async addItems(
    restaurantId: number,
    orderId: number,
    userId: number,
    dto: AddOrderItemsDto,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      await this.appendItems(manager, restaurantId, order.id, dto.items, {
        status: OrderItemStatus.QUEUED,
        createdByUserId: userId,
      });

      await recalculateOrder(manager, order.id, components);
    });

    return this.findOne(restaurantId, orderId);
  }

  /** Changes a line that has not reached the kitchen yet. */
  async updateItem(
    restaurantId: number,
    orderId: number,
    itemId: number,
    dto: UpdateOrderItemDto,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const item = this.itemOf(order, itemId);

    if (item.status === OrderItemStatus.CANCELLED) {
      throw new BadRequestException('This line has been cancelled.');
    }

    if (item.kotTicketId !== null) {
      throw new BadRequestException(
        'This line is already with the kitchen. Cancel it instead of changing it.',
      );
    }

    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      if (dto.quantity !== undefined) {
        item.quantity = dto.quantity;
        item.lineTotal = lineTotal({ unitPrice: item.unitPrice, quantity: dto.quantity });
      }

      if (dto.note !== undefined) {
        item.note = dto.note || null;
      }

      await manager.getRepository(OrderItem).save(item);
      await recalculateOrder(manager, order.id, components);
    });

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Cancels one line, keeping it on the order with its reason.
   *
   * The row is never deleted: "we took it off the bill" is something an owner
   * must be able to see afterwards. If this empties a kitchen ticket, the ticket
   * is cancelled too so the kitchen stops cooking it.
   */
  async cancelItem(
    restaurantId: number,
    orderId: number,
    itemId: number,
    dto: CancelOrderItemDto,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const item = this.itemOf(order, itemId);

    if (item.status === OrderItemStatus.CANCELLED) {
      throw new BadRequestException('This line has already been cancelled.');
    }

    // Once a ticket exists the kitchen has cooked, or is cooking, this food.
    // Taking it off the bill now is a write-off, and a write-off without a
    // reason is indistinguishable from a till being quietly emptied.
    if (item.kotTicketId !== null && !dto.reason) {
      throw new BadRequestException(
        'This line has already gone to the kitchen, so a reason is required to take it off the bill.',
      );
    }

    const components = await this.taxComponentsFor(restaurantId);
    const ticketId = item.kotTicketId;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(OrderItem).save({
        ...item,
        status: OrderItemStatus.CANCELLED,
        cancelledReason: dto.reason || null,
      });

      if (ticketId !== null) {
        await this.cancelTicketIfEmpty(manager, ticketId);
      }

      await recalculateOrder(manager, order.id, components);
    });

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Comps one line: cooked, served, not charged for.
   *
   * The line keeps its price. Zeroing it here would destroy the only record of
   * what the giveaway was worth, which is the number an owner wants at the end
   * of the month; the bill shows it at zero and the totals leave it out.
   */
  async markItemNonChargeable(
    restaurantId: number,
    orderId: number,
    itemId: number,
    dto: MarkItemNonChargeableDto,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const item = this.itemOf(order, itemId);

    if (item.status === OrderItemStatus.CANCELLED) {
      throw new BadRequestException('A cancelled line cannot be comped: it was never served.');
    }

    if (item.isNonChargeable) {
      throw new BadRequestException('This line is already comped.');
    }

    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(OrderItem).save({
        ...item,
        isNonChargeable: true,
        ncReason: dto.reason,
      });

      await recalculateOrder(manager, order.id, components);

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.ORDER_ITEM_COMPED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        newValue: { itemId, name: item.name, value: item.lineTotal },
        reason: dto.reason,
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /** Puts a comped line back on the bill. */
  async clearItemNonChargeable(
    restaurantId: number,
    orderId: number,
    itemId: number,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const item = this.itemOf(order, itemId);

    if (!item.isNonChargeable) {
      throw new BadRequestException('This line is not comped.');
    }

    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(OrderItem).save({
        ...item,
        isNonChargeable: false,
        ncReason: null,
      });

      await recalculateOrder(manager, order.id, components);

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.ORDER_ITEM_COMP_CLEARED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: { itemId, name: item.name, reason: item.ncReason },
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Marks the whole bill as given away, or takes that mark off again.
   *
   * Only while the bill is open. Once it has settled the day's figures have been
   * read off it, and a bill that could silently stop being a sale afterwards
   * would make every report that was already printed wrong.
   */
  async setOrderNonChargeable(
    restaurantId: number,
    orderId: number,
    dto: MarkOrderNonChargeableDto | null,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Order).update(
        { id: order.id, restaurantId },
        {
          isNonChargeable: dto !== null,
          ncReason: dto?.reason ?? null,
          ncFor: dto?.forWhom ?? null,
        },
      );

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: dto ? AuditAction.ORDER_MARKED_NC : AuditAction.ORDER_NC_CLEARED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        newValue: dto ? { forWhom: dto.forWhom, value: order.amountPayable } : null,
        reason: dto?.reason ?? null,
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Erases a no-charge bill. Owners only, and only ever an NC one.
   *
   * This is the one place in Plateo where a financial row is destroyed rather
   * than marked, and it is deliberate: an owner asked to be able to take their
   * own meals out of the system entirely. The guard rails that make it survivable:
   *
   *  - only a bill already marked NC can go, so no sale can be deleted by
   *    mistake or by design;
   *  - the audit record is written first and outlives the bill, so the act is
   *    always visible even though its subject is not;
   *  - stock is left exactly as it was. `inventory_movements` points at orders by
   *    a loose reference rather than a foreign key, so the ledger survives this
   *    and keeps reconciling against what is on the shelf. That food was eaten;
   *    putting the ingredients back would make the counts lie.
   *
   * `order_items`, `order_charges` and `kot_tickets` go with it through their
   * cascades. Any payment intent is detached rather than deleted, which is the
   * existing ON DELETE SET NULL and the right behaviour: a payment is a fact
   * about money that moved and is not the restaurant's to erase.
   */
  async deleteNonChargeable(
    restaurantId: number,
    orderId: number,
    userId: number,
    context?: AuditContext,
  ): Promise<void> {
    const order = await this.loadOrder(restaurantId, orderId);

    if (!order.isNonChargeable) {
      throw new BadRequestException(
        'Only a no-charge bill can be deleted. A sale is kept, whatever its state.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      // Written before the delete, and on purpose not tied to the row by a
      // foreign key, so it is still here tomorrow when somebody asks what
      // happened to bill 412.
      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.NC_ORDER_DELETED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: {
          orderNumber: order.orderNumber,
          businessDate: order.businessDate,
          value: order.amountPayable,
          forWhom: order.ncFor,
          items: order.items.filter(wasMade).map((item) => ({
            name: item.name,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          })),
        },
        reason: order.ncReason,
        context,
      });

      await manager.getRepository(Order).delete({ id: order.id, restaurantId });
    });
  }

  /**
   * Approves diner requests so they can go to the kitchen.
   *
   * With no ids, everything still pending is approved - the usual case when staff
   * glance at the table's requests and wave them through.
   */
  async approveItems(
    restaurantId: number,
    orderId: number,
    dto: ApproveOrderItemsDto,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const pending = order.items.filter(isAwaitingApproval);

    const chosen = dto.itemIds
      ? dto.itemIds.map((id) => {
          const item = this.itemOf(order, id);

          if (!isAwaitingApproval(item)) {
            throw new BadRequestException(`Line ${id} is not waiting for approval.`);
          }

          return item;
        })
      : pending;

    if (chosen.length === 0) {
      throw new BadRequestException('There is nothing waiting for approval on this order.');
    }

    await this.itemsRepository.update(
      { id: In(chosen.map((item) => item.id)) },
      { status: OrderItemStatus.QUEUED },
    );

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Sends everything approved-but-unsent to the kitchen as one new ticket.
   *
   * A second round of drinks becomes a *second* ticket rather than a reprint of
   * the first: the kitchen must see only what is new. Returns the ticket ready to
   * print.
   */
  async createKotTicket(
    restaurantId: number,
    orderId: number,
    userId: number,
  ): Promise<KotPrintDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const unsent = order.items.filter(isUnsent);

    if (unsent.length === 0) {
      const waiting = order.items.filter(isAwaitingApproval).length;

      throw new BadRequestException(
        waiting > 0
          ? 'Approve the pending diner requests before sending them to the kitchen.'
          : 'There is nothing new to send to the kitchen.',
      );
    }

    const ticketId = await withNumberRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(KotTicket);

        const ticket = await repository.save(
          repository.create({
            restaurantId,
            orderId: order.id,
            ticketNumber: await nextTicketNumber(manager, restaurantId, order.businessDate),
            businessDate: order.businessDate,
            status: KotStatus.NEW,
            printedAt: null,
            createdByUserId: userId,
          }),
        );

        await manager
          .getRepository(OrderItem)
          .update({ id: In(unsent.map((item) => item.id)) }, { kotTicketId: ticket.id });

        return ticket.id;
      }),
    );

    return this.kotPrint(restaurantId, orderId, ticketId);
  }

  /** A ticket of this order, as a printable payload. */
  async kotPrint(restaurantId: number, orderId: number, ticketId: number): Promise<KotPrintDto> {
    const ticket = await this.ticketsRepository.findOne({
      where: { id: ticketId, restaurantId, orderId },
      relations: { items: true, order: { table: true } },
    });

    if (!ticket) {
      throw new NotFoundException(`Kitchen ticket ${ticketId} was not found.`);
    }

    const restaurant = await this.restaurantOf(restaurantId);

    return toKotPrintDto(ticket, restaurant.name);
  }

  /**
   * Applies a discount to an open bill.
   *
   * Capped at half the subtotal whichever form it takes, so a percentage and a
   * flat amount cannot be used to reach different places. The cap is checked here
   * rather than in the DTO because a flat amount only means something relative to
   * this bill's subtotal.
   */
  async applyDiscount(
    restaurantId: number,
    orderId: number,
    dto: ApplyDiscountDto,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    if (order.subtotal <= 0) {
      throw new BadRequestException('Add something to the bill before discounting it.');
    }

    if (dto.type === DiscountType.PERCENT && dto.value > MAX_DISCOUNT_PERCENT) {
      throw new BadRequestException(`A discount may not exceed ${MAX_DISCOUNT_PERCENT}%.`);
    }

    if (dto.type === DiscountType.AMOUNT) {
      const capPaise = Math.floor((toPaise(order.subtotal) * MAX_DISCOUNT_PERCENT) / 100);

      if (toPaise(dto.value) > capPaise) {
        throw new BadRequestException(
          `A discount may not exceed ${MAX_DISCOUNT_PERCENT}% of the bill (${capPaise / 100}).`,
        );
      }
    }

    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Order).update(order.id, {
        discountType: dto.type,
        discountValue: dto.value,
        discountReason: dto.reason,
      });

      await recalculateOrder(manager, order.id, components);

      // In the same transaction as the money: a discount that rolls back must
      // not leave a record saying it was given.
      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.BILL_DISCOUNTED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: {
          discountType: order.discountType,
          discountValue: order.discountValue,
          total: order.total,
        },
        newValue: { discountType: dto.type, discountValue: dto.value },
        reason: dto.reason,
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Records what a corporate payer withholds from this bill.
   *
   * Changes nothing about the tax owed: it is applied after GST, to the value
   * before GST, and only moves money between "billed" and "collected".
   */
  async setTds(
    restaurantId: number,
    orderId: number,
    dto: SetTdsDto,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const rate = dto.rate === undefined || dto.rate === null || dto.rate <= 0 ? null : dto.rate;
    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Order).update(order.id, { tdsRate: rate });

      await recalculateOrder(manager, order.id, components);

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.BILL_TDS_RECORDED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: { tdsRate: order.tdsRate },
        newValue: { tdsRate: rate },
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  async removeDiscount(
    restaurantId: number,
    orderId: number,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    const components = await this.taxComponentsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Order).update(order.id, {
        discountType: null,
        discountValue: null,
        discountReason: null,
      });

      await recalculateOrder(manager, order.id, components);

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.BILL_DISCOUNT_REMOVED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: {
          discountType: order.discountType,
          discountValue: order.discountValue,
          discountAmount: order.discountAmount,
        },
        newValue: null,
        reason: order.discountReason,
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /**
   * Takes the money and closes the bill.
   *
   * Pending diner requests block settlement: they are either part of this bill or
   * they are not, and settling around them would either charge for food nobody
   * confirmed or hand over food nobody paid for. The tax rate is copied onto the
   * order here, so a later change to the restaurant's rate cannot rewrite a bill
   * that has already been paid.
   */
  /**
   * Takes the money and closes the bill.
   *
   * Two layers of protection, and both are needed. The idempotency key stops a
   * retry - a tap that the network swallowed, a page refreshed mid-request -
   * from settling twice, by replaying the first answer. The claim inside the
   * transaction stops two *different* requests racing, which no key can prevent
   * because they legitimately carry different keys.
   */
  async settle(
    restaurantId: number,
    orderId: number,
    userId: number,
    dto: SettleOrderDto,
    context?: AuditContext,
    idempotencyKey?: string,
  ): Promise<OrderDto> {
    const outcome = await this.idempotencyService.run(
      {
        scope: IdempotencyScope.ORDER_SETTLE,
        key: idempotencyKey,
        restaurantId,
        payload: { orderId, ...dto },
        resourceType: 'ORDER',
      },
      () => this.settleOnce(restaurantId, orderId, userId, dto, context),
    );

    return outcome.result;
  }

  /**
   * Settles on behalf of a captured payment, with nobody signed in.
   *
   * Goes through exactly the same path as a till settlement - the same claim on
   * the open bill, the same audit record - so an online payment cannot settle a
   * bill the till could not.
   */
  settleForPayment(
    restaurantId: number,
    orderId: number,
    dto: SettleOrderDto,
    context?: AuditContext,
  ): Promise<OrderDto> {
    return this.settleOnce(restaurantId, orderId, null, dto, context);
  }

  private async settleOnce(
    restaurantId: number,
    orderId: number,
    userId: number | null,
    dto: SettleOrderDto,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    // `wasMade`, not `isBillable`. A bill where every line is comped has nothing
    // to charge for and everything to settle: the food was cooked, the stock has
    // to come off and the table has to be freed.
    if (order.items.filter(wasMade).length === 0) {
      throw new BadRequestException('There is nothing on this bill to settle.');
    }

    if (order.items.some(isAwaitingApproval)) {
      throw new BadRequestException(
        'Approve or cancel the pending diner requests before settling the bill.',
      );
    }

    const components = await this.taxComponentsFor(restaurantId);
    const inventorySettings = await this.inventoryService.settingsFor(restaurantId);

    await this.dataSource.transaction(async (manager) => {
      // Claim the bill before touching anything else.
      //
      // The checks above ran outside this transaction, so two tills pressing
      // Settle at the same moment both reached them while the bill was still
      // open. Moving the status with the open state as part of the WHERE makes
      // the database the arbiter: exactly one caller can take a bill out of OPEN,
      // and the loser is told so instead of being told it succeeded. It matters
      // more than it looks - the day a payment provider is wired to settlement,
      // two successes would be two captures.
      const claimed = await manager.getRepository(Order).update(
        { id: order.id, restaurantId, status: OrderStatus.OPEN },
        {
          status: OrderStatus.SETTLED,
          paymentMethod: dto.paymentMethod,
          settledAt: new Date(),
          settledByUserId: userId ?? undefined,
        },
      );

      if (claimed.affected === 0) {
        throw new BadRequestException('This bill has already been settled or voided.');
      }

      const settled = await recalculateOrder(manager, order.id, components);

      // Anything still on the bill has been served by the time it is paid for.
      await manager
        .getRepository(OrderItem)
        .createQueryBuilder()
        .update(OrderItem)
        .set({ status: OrderItemStatus.SERVED })
        .where('order_id = :orderId', { orderId: order.id })
        .andWhere('status != :cancelled', { cancelled: OrderItemStatus.CANCELLED })
        .execute();

      await this.closeTickets(manager, order.id, KotStatus.DONE);

      // Inside this transaction on purpose. A bill must never be left settled
      // with its ingredients half taken out of stock, so if the deduction
      // fails the settlement goes back with it. When inventory is switched
      // off - which it is for every restaurant until somebody turns it on -
      // this costs one already-loaded setting and does nothing else.
      await this.inventoryService.consumeForOrderIn(
        manager,
        restaurantId,
        order.id,
        inventorySettings,
        userId,
        context,
      );

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.BILL_SETTLED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: { status: OrderStatus.OPEN },
        newValue: {
          status: OrderStatus.SETTLED,
          paymentMethod: dto.paymentMethod,
          total: settled.total,
          amountPayable: settled.amountPayable,
          orderNumber: settled.orderNumber,
        },
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /** Voids a whole bill, with the reason kept on the order. */
  async cancel(
    restaurantId: number,
    orderId: number,
    dto: CancelOrderDto,
    userId: number,
    context?: AuditContext,
  ): Promise<OrderDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    this.assertOpen(order);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(OrderItem)
        .createQueryBuilder()
        .update(OrderItem)
        .set({ status: OrderItemStatus.CANCELLED, cancelledReason: dto.reason })
        .where('order_id = :orderId', { orderId: order.id })
        .andWhere('status != :cancelled', { cancelled: OrderItemStatus.CANCELLED })
        .execute();

      await this.closeTickets(manager, order.id, KotStatus.CANCELLED);

      // Same claim as settling: a void racing a settle must not be able to zero
      // a bill that has just been paid.
      const claimed = await manager.getRepository(Order).update(
        { id: order.id, restaurantId, status: OrderStatus.OPEN },
        {
          status: OrderStatus.CANCELLED,
          cancelledReason: dto.reason,
          subtotal: 0,
          discountAmount: 0,
          serviceChargeAmount: 0,
          taxAmount: 0,
          total: 0,
          tdsAmount: 0,
          amountPayable: 0,
        },
      );

      if (claimed.affected === 0) {
        throw new BadRequestException('This bill has already been settled or voided.');
      }

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.BILL_VOIDED,
        entityType: AuditEntity.ORDER,
        entityId: order.id,
        oldValue: { status: order.status, total: order.total, orderNumber: order.orderNumber },
        newValue: { status: OrderStatus.CANCELLED, total: 0 },
        reason: dto.reason,
        context,
      });
    });

    return this.findOne(restaurantId, orderId);
  }

  /** The bill, printable whether it is still open or already settled. */
  async bill(restaurantId: number, orderId: number): Promise<BillDto> {
    const order = await this.loadOrder(restaurantId, orderId);
    const restaurant = await this.restaurantOf(restaurantId);

    return toBillDto(order, restaurant);
  }

  // ---------------------------------------------------------------- internals

  private async loadOrder(restaurantId: number, id: number): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id, restaurantId },
      relations: { items: true, table: true, charges: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${id} was not found.`);
    }

    return order;
  }

  private itemOf(order: Order, itemId: number): OrderItem {
    const item = order.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      throw new NotFoundException(`Line ${itemId} was not found on order ${order.id}.`);
    }

    return item;
  }

  private assertOpen(order: Order): void {
    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException(
        order.status === OrderStatus.SETTLED
          ? 'This bill has already been settled.'
          : 'This bill has been cancelled.',
      );
    }
  }

  private async assertTableExists(restaurantId: number, tableId: number): Promise<RestaurantTable> {
    const table = await this.tablesRepository.findOne({ where: { id: tableId, restaurantId } });

    if (!table) {
      throw new NotFoundException(`Table ${tableId} was not found.`);
    }

    return table;
  }

  /**
   * A table can hold one open bill at a time.
   *
   * Two tills opening a bill for the same table in the same instant can still
   * both pass this check - there is no partial unique index to lean on in MySQL -
   * but both bills are then visible at the table rather than one being lost, and
   * staff can cancel the spare.
   */
  private async assertTableAvailable(restaurantId: number, tableId: number): Promise<void> {
    const table = await this.assertTableExists(restaurantId, tableId);

    if (!table.isActive) {
      throw new BadRequestException(`${table.name} is not active.`);
    }

    const existing = await this.ordersRepository.findOne({
      where: { restaurantId, tableId, status: OrderStatus.OPEN },
      select: { id: true, orderNumber: true },
    });

    if (existing) {
      throw new ConflictException(
        `${table.name} already has an open bill (#${existing.orderNumber}). Add to it instead.`,
      );
    }
  }

  private async appendItems(
    manager: EntityManager,
    restaurantId: number,
    orderId: number,
    inputs: CreateOrderDto['items'],
    context: { status: OrderItemStatus; createdByUserId: number | null },
  ): Promise<void> {
    const rows = await buildOrderItems(manager, restaurantId, inputs, context);
    const repository = manager.getRepository(OrderItem);

    await repository.save(rows.map((row) => repository.create({ ...row, orderId })));
  }

  /** Cancels a kitchen ticket once every line on it has been cancelled. */
  private async cancelTicketIfEmpty(manager: EntityManager, ticketId: number): Promise<void> {
    const repository = manager.getRepository(KotTicket);

    const ticket = await repository.findOne({
      where: { id: ticketId },
      relations: { items: true },
    });

    if (!ticket || ticket.status === KotStatus.CANCELLED) return;

    if (ticket.items.every((item) => item.status === OrderItemStatus.CANCELLED)) {
      await repository.update(ticket.id, { status: KotStatus.CANCELLED });
    }
  }

  /** Closes out the live tickets of an order that is being settled or voided. */
  private async closeTickets(
    manager: EntityManager,
    orderId: number,
    status: KotStatus,
  ): Promise<void> {
    await manager
      .getRepository(KotTicket)
      .createQueryBuilder()
      .update(KotTicket)
      .set({ status })
      .where('order_id = :orderId', { orderId })
      .andWhere('status NOT IN (:...closed)', { closed: [KotStatus.DONE, KotStatus.CANCELLED] })
      .execute();
  }

  private async ticketsFor(orderIds: number[]): Promise<Map<number, KotTicket[]>> {
    const byOrder = new Map<number, KotTicket[]>();

    if (orderIds.length === 0) return byOrder;

    const tickets = await this.ticketsRepository.find({
      where: { orderId: In(orderIds) },
      relations: { items: true },
      order: { ticketNumber: 'ASC' },
    });

    for (const ticket of tickets) {
      const list = byOrder.get(ticket.orderId) ?? [];
      list.push(ticket);
      byOrder.set(ticket.orderId, list);
    }

    return byOrder;
  }

  private async restaurantOf(restaurantId: number): Promise<Restaurant> {
    const restaurant = await this.restaurantsRepository.findOne({ where: { id: restaurantId } });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${restaurantId} was not found.`);
    }

    return restaurant;
  }

  private taxComponentsFor(restaurantId: number): Promise<TaxComponentInput[]> {
    return loadTaxComponents(
      this.taxComponentsRepository,
      this.restaurantsRepository,
      restaurantId,
    );
  }
}
