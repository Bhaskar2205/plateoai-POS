import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { OrderItemStatus, OrderStatus, PaymentMethod, TAX_KINDS, TaxKind } from 'src/common/enums';
import { BUSINESS_DAY_UTC_OFFSET_MINUTES, businessDateFor } from 'src/common/utils/business-date.util';
import { fromPaise, toPaise } from 'src/common/utils/money.util';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { KotTicket } from 'src/modules/orders/entities/kot-ticket.entity';
import { OrderCharge } from 'src/modules/orders/entities/order-charge.entity';
import { OrderItem } from 'src/modules/orders/entities/order-item.entity';
import { Order } from 'src/modules/orders/entities/order.entity';
import { DayEndReportDto, DayEndTaxLineDto } from './dto/day-end.dto';
import { ReportRangeDto } from './dto/report-range.dto';
import {
  AdjustmentsReportDto,
  ItemSalesDto,
  OrderRowDto,
  ReportPeriodDto,
  SalesSummaryDto,
  SectionSalesDto,
  StaffSalesDto,
  TableSalesDto,
} from './dto/report.dto';

/** A year of trading is plenty to compare against; beyond that a report is an export. */
const MAX_RANGE_DAYS = 366;

/** Beyond a month, "which hour is busiest" averages into noise, so it is not computed. */
const MAX_HOURLY_RANGE_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reporting over settled bills.
 *
 * Two decisions shape everything here:
 *
 *  - **Only settled bills are sales.** Open bills are money not yet taken;
 *    voided bills are money never taken. Both are shown, never added in.
 *  - **Money is summed in paise.** The stored figures are DECIMAL and arrive as
 *    JS numbers, and adding thousands of them as floats drifts. Every total is
 *    accumulated as integers and converted back once, so a month's takings match
 *    the sum of the printed bills exactly.
 *
 * Aggregation happens in TypeScript rather than SQL on purpose: the same code has
 * to give identical answers on MySQL and on the SQLite the test suite runs, and
 * date handling (a business day that starts at 05:00) is already expressed once
 * in `business-date.util.ts`. A restaurant's year of bills is a few tens of
 * thousands of rows - small enough that correctness and portability win.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemsRepository: Repository<OrderItem>,
    @InjectRepository(KotTicket) private readonly ticketsRepository: Repository<KotTicket>,
    @InjectRepository(Dish) private readonly dishesRepository: Repository<Dish>,
    @InjectRepository(Category) private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(OrderCharge) private readonly chargesRepository: Repository<OrderCharge>,
  ) {}

  /** Normalises the requested range, defaulting to today and refusing silly spans. */
  period(range: ReportRangeDto): ReportPeriodDto {
    const today = businessDateFor();
    const from = range.from ?? today;
    const to = range.to ?? today;

    if (from > to) {
      throw new BadRequestException('The start of the range is after its end.');
    }

    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

    if (!Number.isFinite(days) || days < 1) {
      throw new BadRequestException('That date range could not be read.');
    }

    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(`A report covers at most ${MAX_RANGE_DAYS} days.`);
    }

    return { from, to, days };
  }

  async salesSummary(restaurantId: number, range: ReportRangeDto): Promise<SalesSummaryDto> {
    const period = this.period(range);
    const orders = await this.ordersIn(restaurantId, period);

    const settled = orders.filter((order) => order.status === OrderStatus.SETTLED);
    const voided = orders.filter((order) => order.status === OrderStatus.CANCELLED);
    const open = orders.filter((order) => order.status === OrderStatus.OPEN);

    let grossPaise = 0;
    let discountPaise = 0;
    let taxPaise = 0;
    let netPaise = 0;

    const byPayment = new Map<PaymentMethod, { bills: number; paise: number }>();
    const byDay = new Map<string, { bills: number; paise: number }>();
    const byHour = new Map<number, { bills: number; paise: number }>();

    for (const order of settled) {
      const total = toPaise(order.total);

      grossPaise += toPaise(order.subtotal);
      discountPaise += toPaise(order.discountAmount);
      taxPaise += toPaise(order.taxAmount);
      netPaise += total;

      const method = order.paymentMethod ?? PaymentMethod.OTHER;
      const payment = byPayment.get(method) ?? { bills: 0, paise: 0 };
      byPayment.set(method, { bills: payment.bills + 1, paise: payment.paise + total });

      const day = byDay.get(order.businessDate) ?? { bills: 0, paise: 0 };
      byDay.set(order.businessDate, { bills: day.bills + 1, paise: day.paise + total });

      if (period.days <= MAX_HOURLY_RANGE_DAYS && order.settledAt) {
        const hour = this.localHour(order.settledAt);
        const bucket = byHour.get(hour) ?? { bills: 0, paise: 0 };
        byHour.set(hour, { bills: bucket.bills + 1, paise: bucket.paise + total });
      }
    }

    const itemsSold = await this.countItemsSold(settled.map((order) => order.id));

    return {
      period,
      bills: settled.length,
      itemsSold,
      gross: fromPaise(grossPaise),
      discounts: fromPaise(discountPaise),
      tax: fromPaise(taxPaise),
      net: fromPaise(netPaise),
      averageBill: settled.length === 0 ? 0 : fromPaise(Math.round(netPaise / settled.length)),
      openBills: open.length,
      voidedBills: voided.length,
      // A voided bill stores zeroed totals, so its worth is read from its lines.
      voidedValue: fromPaise(await this.valueOfItems(voided.map((order) => order.id))),
      payments: [...byPayment.entries()]
        .map(([method, value]) => ({ method, bills: value.bills, total: fromPaise(value.paise) }))
        .sort((a, b) => b.total - a.total),
      daily: this.everyDayIn(period).map((businessDate) => ({
        businessDate,
        bills: byDay.get(businessDate)?.bills ?? 0,
        net: fromPaise(byDay.get(businessDate)?.paise ?? 0),
      })),
      hourly: [...byHour.entries()]
        .map(([hour, value]) => ({ hour, bills: value.bills, total: fromPaise(value.paise) }))
        .sort((a, b) => a.hour - b.hour),
    };
  }


  /**
   * The day-end statement, as a till is closed.
   *
   * One business day, not a range, and it reports the tax **component by
   * component** - the number a restaurant needs is how much CGST it collected,
   * not how much "tax" it collected, because those go on different lines of a
   * return. Components are read from what each bill actually charged rather than
   * from the restaurant's current profile, so a rate changed this afternoon does
   * not retell this morning's takings.
   *
   * Open bills are counted and shown but never added in: their money has not been
   * taken yet, and a statement that included it would not match the drawer. The
   * day is only `isClosed` when nothing is still running.
   */
  async dayEnd(restaurantId: number, businessDate?: string): Promise<DayEndReportDto> {
    const day = businessDate ?? businessDateFor();
    const orders = await this.ordersRepository.find({
      where: { restaurantId, businessDate: day },
      select: {
        id: true,
        status: true,
        subtotal: true,
        discountAmount: true,
        serviceChargeAmount: true,
        taxAmount: true,
        total: true,
        tdsAmount: true,
        amountPayable: true,
        paymentMethod: true,
        settledAt: true,
      },
    });

    const settled = orders.filter((order) => order.status === OrderStatus.SETTLED);
    const open = orders.filter((order) => order.status === OrderStatus.OPEN);
    const voided = orders.filter((order) => order.status === OrderStatus.CANCELLED);

    let grossPaise = 0;
    let discountPaise = 0;
    let servicePaise = 0;
    let taxPaise = 0;
    let totalPaise = 0;
    let tdsPaise = 0;
    let collectedPaise = 0;

    const byPayment = new Map<PaymentMethod, { bills: number; paise: number }>();
    let firstSettledAt: Date | null = null;
    let lastSettledAt: Date | null = null;

    for (const order of settled) {
      grossPaise += toPaise(order.subtotal);
      discountPaise += toPaise(order.discountAmount);
      servicePaise += toPaise(order.serviceChargeAmount);
      taxPaise += toPaise(order.taxAmount);
      totalPaise += toPaise(order.total);
      tdsPaise += toPaise(order.tdsAmount);
      collectedPaise += toPaise(order.amountPayable);

      const method = order.paymentMethod ?? PaymentMethod.OTHER;
      const payment = byPayment.get(method) ?? { bills: 0, paise: 0 };
      byPayment.set(method, { bills: payment.bills + 1, paise: payment.paise + toPaise(order.amountPayable) });

      if (order.settledAt) {
        if (firstSettledAt === null || order.settledAt < firstSettledAt) firstSettledAt = order.settledAt;
        if (lastSettledAt === null || order.settledAt > lastSettledAt) lastSettledAt = order.settledAt;
      }
    }

    return {
      businessDate: day,
      isClosed: open.length === 0,
      openBills: open.length,
      openValue: fromPaise(open.reduce((sum, order) => sum + toPaise(order.total), 0)),
      bills: settled.length,
      itemsSold: await this.countItemsSold(settled.map((order) => order.id)),
      gross: fromPaise(grossPaise),
      discounts: fromPaise(discountPaise),
      netSales: fromPaise(grossPaise - discountPaise),
      serviceCharge: fromPaise(servicePaise),
      taxes: await this.taxLinesFor(settled),
      taxTotal: fromPaise(taxPaise),
      total: fromPaise(totalPaise),
      tdsWithheld: fromPaise(tdsPaise),
      collected: fromPaise(collectedPaise),
      payments: [...byPayment.entries()]
        .map(([method, value]) => ({ method, bills: value.bills, total: fromPaise(value.paise) }))
        .sort((a, b) => b.total - a.total),
      averageBill:
        settled.length === 0 ? 0 : fromPaise(Math.round(collectedPaise / settled.length)),
      voidedBills: voided.length,
      // A voided bill stores zeroed totals, so its worth is read from its lines.
      voidedValue: fromPaise(await this.valueOfItems(voided.map((order) => order.id))),
      firstSettledAt,
      lastSettledAt,
    };
  }

  /**
   * Each tax component collected across a set of bills, grouped by what it is
   * and the rate it was charged at. A restaurant that changed its rate mid-day
   * sees two lines for the same tax, which is right: they are filed as the
   * amounts they were charged at.
   */
  private async taxLinesFor(settled: Order[]): Promise<DayEndTaxLineDto[]> {
    if (settled.length === 0) return [];

    const orderIds = settled.map((order) => order.id);
    const charges = await this.chargesRepository.find({ where: { orderId: In(orderIds) } });
    const grouped = new Map<string, DayEndTaxLineDto & { taxablePaise: number; paise: number }>();

    for (const charge of charges) {
      // A service charge is the restaurant's own income, not tax collected on
      // anyone's behalf. It is reported on its own line and must never be added
      // into a figure that goes onto a return.
      if (!TAX_KINDS.includes(charge.kind)) continue;

      const key = `${charge.kind}|${charge.name}|${charge.rate}`;
      const line = grouped.get(key) ?? {
        name: charge.name,
        kind: charge.kind,
        rate: charge.rate,
        taxableAmount: 0,
        amount: 0,
        bills: 0,
        taxablePaise: 0,
        paise: 0,
      };

      line.taxablePaise += toPaise(charge.taxableAmount);
      line.paise += toPaise(charge.amount);
      line.bills += 1;
      grouped.set(key, line);
    }

    // A bill settled before the breakdown existed carries a tax amount and no
    // components. Without this it would be missing from these lines while still
    // counting towards the day's tax total, and the statement would not add up on
    // the one day that matters most - the day the restaurant upgraded.
    const withBreakdown = new Set(charges.map((charge) => charge.orderId));
    let legacyTaxablePaise = 0;
    let legacyPaise = 0;
    let legacyBills = 0;

    for (const order of settled) {
      if (withBreakdown.has(order.id) || toPaise(order.taxAmount) === 0) continue;

      legacyTaxablePaise += toPaise(order.subtotal) - toPaise(order.discountAmount);
      legacyPaise += toPaise(order.taxAmount);
      legacyBills += 1;
    }

    const lines = [...grouped.values()].map((line) => ({
      name: line.name,
      kind: line.kind,
      rate: line.rate,
      taxableAmount: fromPaise(line.taxablePaise),
      amount: fromPaise(line.paise),
      bills: line.bills,
    }));

    if (legacyBills > 0) {
      lines.push({
        name: 'Tax (no breakdown recorded)',
        kind: TaxKind.OTHER,
        rate: 0,
        taxableAmount: fromPaise(legacyTaxablePaise),
        amount: fromPaise(legacyPaise),
        bills: legacyBills,
      });
    }

    return lines.sort((a, b) => b.amount - a.amount);
  }

  /** What sold, dish by dish. */
  async itemSales(restaurantId: number, range: ReportRangeDto): Promise<ItemSalesDto[]> {
    const period = this.period(range);
    const items = await this.soldItems(restaurantId, period);
    const sections = await this.sectionNamesByDish(restaurantId);

    const rows = new Map<string, ItemSalesDto & { paise: number }>();
    let totalPaise = 0;

    for (const item of items) {
      // Keyed by dish where there is one, by name where the dish is gone: two
      // dishes can share a name, and a deleted dish still has to report its sales.
      const key = item.dishId === null ? `name:${item.name}` : `dish:${item.dishId}`;
      const paise = toPaise(item.lineTotal);
      totalPaise += paise;

      const row = rows.get(key) ?? {
        dishId: item.dishId,
        name: item.name,
        section: item.dishId === null ? null : (sections.get(item.dishId) ?? null),
        quantity: 0,
        total: 0,
        share: 0,
        paise: 0,
      };

      row.quantity += item.quantity;
      row.paise += paise;
      rows.set(key, row);
    }

    return [...rows.values()]
      .map(({ paise, ...row }) => ({
        ...row,
        total: fromPaise(paise),
        share: totalPaise === 0 ? 0 : Math.round((paise / totalPaise) * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total);
  }

  /** The same sales, gathered into the menu sections diners see. */
  async sectionSales(restaurantId: number, range: ReportRangeDto): Promise<SectionSalesDto[]> {
    const period = this.period(range);
    const items = await this.soldItems(restaurantId, period);

    const dishes = await this.dishesRepository.find({
      where: { restaurantId },
      select: { id: true, categoryId: true },
    });
    const categories = await this.categoriesRepository.find({
      where: { restaurantId },
      select: { id: true, name: true },
    });

    const categoryOfDish = new Map(dishes.map((dish) => [dish.id, dish.categoryId]));
    const nameOfCategory = new Map(categories.map((category) => [category.id, category.name]));

    const rows = new Map<number | null, { name: string; dishes: Set<string>; quantity: number; paise: number }>();
    let totalPaise = 0;

    for (const item of items) {
      const categoryId = item.dishId === null ? null : (categoryOfDish.get(item.dishId) ?? null);
      const paise = toPaise(item.lineTotal);
      totalPaise += paise;

      const row = rows.get(categoryId) ?? {
        name: categoryId === null ? 'No section' : (nameOfCategory.get(categoryId) ?? 'Deleted section'),
        dishes: new Set<string>(),
        quantity: 0,
        paise: 0,
      };

      row.dishes.add(item.dishId === null ? `name:${item.name}` : `dish:${item.dishId}`);
      row.quantity += item.quantity;
      row.paise += paise;
      rows.set(categoryId, row);
    }

    return [...rows.entries()]
      .map(([categoryId, row]) => ({
        categoryId,
        name: row.name,
        dishes: row.dishes.size,
        quantity: row.quantity,
        total: fromPaise(row.paise),
        share: totalPaise === 0 ? 0 : Math.round((row.paise / totalPaise) * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total);
  }

  /** Every bill in the range, newest first - the report you reconcile a till against. */
  async orderRows(restaurantId: number, range: ReportRangeDto): Promise<OrderRowDto[]> {
    const period = this.period(range);

    const orders = await this.ordersRepository.find({
      where: {
        restaurantId,
        businessDate: Between(period.from, period.to),
      },
      relations: { table: true, settledBy: true, items: true },
      order: { businessDate: 'DESC', orderNumber: 'DESC' },
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      businessDate: order.businessDate,
      tableName: order.table?.name ?? null,
      status: order.status,
      source: order.source,
      items: order.items.filter((item) => item.status !== OrderItemStatus.CANCELLED).length,
      gross: order.subtotal,
      discount: order.discountAmount,
      tax: order.taxAmount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      settledBy: order.settledBy?.name ?? null,
      openedAt: order.createdAt,
      settledAt: order.settledAt,
    }));
  }

  /** Who opened bills, who took the money, and how much they discounted. */
  async staffSales(restaurantId: number, range: ReportRangeDto): Promise<StaffSalesDto[]> {
    const period = this.period(range);

    const orders = await this.ordersRepository.find({
      where: { restaurantId, businessDate: Between(period.from, period.to) },
      relations: { openedBy: true, settledBy: true },
    });

    const rows = new Map<
      number | null,
      { name: string; role: string; opened: number; settled: number; paise: number; discountPaise: number }
    >();

    const rowFor = (id: number | null, name: string, role: string) => {
      const existing = rows.get(id);

      if (existing) return existing;

      const created = { name, role, opened: 0, settled: 0, paise: 0, discountPaise: 0 };
      rows.set(id, created);

      return created;
    };

    for (const order of orders) {
      if (order.openedByUserId !== null || order.openedBy) {
        rowFor(
          order.openedByUserId,
          order.openedBy?.name ?? 'Removed account',
          order.openedBy?.role ?? '',
        ).opened += 1;
      } else {
        // No staff member: a diner opened it themselves from the table QR menu.
        rowFor(null, 'Diner (QR menu)', 'QR').opened += 1;
      }

      if (order.status === OrderStatus.SETTLED && (order.settledByUserId !== null || order.settledBy)) {
        const row = rowFor(
          order.settledByUserId,
          order.settledBy?.name ?? 'Removed account',
          order.settledBy?.role ?? '',
        );

        row.settled += 1;
        row.paise += toPaise(order.total);
        row.discountPaise += toPaise(order.discountAmount);
      }
    }

    return [...rows.entries()]
      .map(([userId, row]) => ({
        userId,
        name: row.name,
        role: row.role,
        billsOpened: row.opened,
        billsSettled: row.settled,
        settledValue: fromPaise(row.paise),
        discountsGiven: fromPaise(row.discountPaise),
      }))
      .sort((a, b) => b.settledValue - a.settledValue);
  }

  /** Which tables earn, and how long they take to turn over. */
  async tableSales(restaurantId: number, range: ReportRangeDto): Promise<TableSalesDto[]> {
    const period = this.period(range);

    const orders = await this.ordersRepository.find({
      where: {
        restaurantId,
        businessDate: Between(period.from, period.to),
        status: OrderStatus.SETTLED,
      },
      relations: { table: true },
    });

    const rows = new Map<number | null, { name: string; bills: number; paise: number; minutes: number }>();

    for (const order of orders) {
      const key = order.tableId;
      const row = rows.get(key) ?? {
        name: order.table?.name ?? (key === null ? 'Counter / takeaway' : 'Deleted table'),
        bills: 0,
        paise: 0,
        minutes: 0,
      };

      row.bills += 1;
      row.paise += toPaise(order.total);

      if (order.settledAt) {
        row.minutes += Math.max(
          0,
          Math.round((order.settledAt.getTime() - order.createdAt.getTime()) / 60_000),
        );
      }

      rows.set(key, row);
    }

    return [...rows.entries()]
      .map(([tableId, row]) => ({
        tableId,
        name: row.name,
        bills: row.bills,
        total: fromPaise(row.paise),
        averageBill: row.bills === 0 ? 0 : fromPaise(Math.round(row.paise / row.bills)),
        averageMinutes: row.bills === 0 ? 0 : Math.round(row.minutes / row.bills),
      }))
      .sort((a, b) => b.total - a.total);
  }

  /** Discounts, voided bills and struck-off items: everything that reduced takings. */
  async adjustments(restaurantId: number, range: ReportRangeDto): Promise<AdjustmentsReportDto> {
    const period = this.period(range);

    const orders = await this.ordersRepository.find({
      where: { restaurantId, businessDate: Between(period.from, period.to) },
      relations: { table: true, settledBy: true },
      order: { businessDate: 'DESC', orderNumber: 'DESC' },
    });

    const discounted = orders.filter(
      (order) => order.status === OrderStatus.SETTLED && order.discountAmount > 0,
    );
    const voided = orders.filter((order) => order.status === OrderStatus.CANCELLED);

    const cancelledItems = await this.itemsRepository.find({
      where: {
        restaurantId,
        status: OrderItemStatus.CANCELLED,
        orderId: In(orders.map((order) => order.id).concat(0)),
      },
    });

    const byName = new Map<string, { times: number; quantity: number; paise: number; reasons: Set<string> }>();

    for (const item of cancelledItems) {
      const row = byName.get(item.name) ?? { times: 0, quantity: 0, paise: 0, reasons: new Set<string>() };

      row.times += 1;
      row.quantity += item.quantity;
      row.paise += toPaise(item.lineTotal);
      if (item.cancelledReason) row.reasons.add(item.cancelledReason);

      byName.set(item.name, row);
    }

    const voidedValues = await this.valuesOfItemsByOrder(voided.map((order) => order.id));

    return {
      period,
      discountTotal: fromPaise(
        discounted.reduce((sum, order) => sum + toPaise(order.discountAmount), 0),
      ),
      discounts: discounted.map((order) => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        businessDate: order.businessDate,
        tableName: order.table?.name ?? null,
        amount: order.discountAmount,
        reason: order.discountReason,
        billTotal: order.total,
        settledBy: order.settledBy?.name ?? null,
      })),
      voidedTotal: fromPaise(
        voided.reduce((sum, order) => sum + (voidedValues.get(order.id) ?? 0), 0),
      ),
      voided: voided.map((order) => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        businessDate: order.businessDate,
        tableName: order.table?.name ?? null,
        value: fromPaise(voidedValues.get(order.id) ?? 0),
        reason: order.cancelledReason,
      })),
      cancelledTotal: fromPaise([...byName.values()].reduce((sum, row) => sum + row.paise, 0)),
      cancelledItems: [...byName.entries()]
        .map(([name, row]) => ({
          name,
          times: row.times,
          quantity: row.quantity,
          value: fromPaise(row.paise),
          reasons: [...row.reasons],
        }))
        .sort((a, b) => b.value - a.value),
    };
  }

  // ---------------------------------------------------------------- internals

  private ordersIn(restaurantId: number, period: ReportPeriodDto): Promise<Order[]> {
    return this.ordersRepository.find({
      where: { restaurantId, businessDate: Between(period.from, period.to) },
      select: {
        id: true,
        status: true,
        businessDate: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        total: true,
        paymentMethod: true,
        settledAt: true,
      },
    });
  }

  /** Lines on settled bills in the range - what actually sold. */
  private async soldItems(restaurantId: number, period: ReportPeriodDto): Promise<OrderItem[]> {
    const settled = await this.ordersRepository.find({
      where: {
        restaurantId,
        businessDate: Between(period.from, period.to),
        status: OrderStatus.SETTLED,
      },
      select: { id: true },
    });

    if (settled.length === 0) return [];

    return this.itemsRepository.find({
      where: {
        restaurantId,
        orderId: In(settled.map((order) => order.id)),
        // A line cancelled before the bill was paid was never sold.
        status: In([
          OrderItemStatus.SERVED,
          OrderItemStatus.READY,
          OrderItemStatus.PREPARING,
          OrderItemStatus.QUEUED,
          OrderItemStatus.PENDING,
        ]),
      },
    });
  }

  private async countItemsSold(orderIds: number[]): Promise<number> {
    if (orderIds.length === 0) return 0;

    const items = await this.itemsRepository.find({
      where: { orderId: In(orderIds) },
      select: { quantity: true, status: true },
    });

    return items
      .filter((item) => item.status !== OrderItemStatus.CANCELLED)
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  /** What a set of orders was worth, from their own lines, in paise. */
  private async valueOfItems(orderIds: number[]): Promise<number> {
    const byOrder = await this.valuesOfItemsByOrder(orderIds);

    return [...byOrder.values()].reduce((sum, paise) => sum + paise, 0);
  }

  private async valuesOfItemsByOrder(orderIds: number[]): Promise<Map<number, number>> {
    const totals = new Map<number, number>();

    if (orderIds.length === 0) return totals;

    const items = await this.itemsRepository.find({
      where: { orderId: In(orderIds) },
      select: { orderId: true, lineTotal: true },
    });

    for (const item of items) {
      totals.set(item.orderId, (totals.get(item.orderId) ?? 0) + toPaise(item.lineTotal));
    }

    return totals;
  }

  /** Dish id to the name of the section it currently sits in. */
  private async sectionNamesByDish(restaurantId: number): Promise<Map<number, string>> {
    const [dishes, categories] = await Promise.all([
      this.dishesRepository.find({ where: { restaurantId }, select: { id: true, categoryId: true } }),
      this.categoriesRepository.find({ where: { restaurantId }, select: { id: true, name: true } }),
    ]);

    const nameOf = new Map(categories.map((category) => [category.id, category.name]));
    const sections = new Map<number, string>();

    for (const dish of dishes) {
      if (dish.categoryId !== null) {
        sections.set(dish.id, nameOf.get(dish.categoryId) ?? 'Deleted section');
      }
    }

    return sections;
  }

  /** The hour a timestamp falls in, in the restaurant's own local time. */
  private localHour(instant: Date): number {
    const local = new Date(instant.getTime() + BUSINESS_DAY_UTC_OFFSET_MINUTES * 60_000);

    return local.getUTCHours();
  }

  private everyDayIn(period: ReportPeriodDto): string[] {
    const days: string[] = [];

    for (let index = 0; index < period.days; index += 1) {
      days.push(new Date(Date.parse(`${period.from}T00:00:00Z`) + index * DAY_MS).toISOString().slice(0, 10));
    }

    return days;
  }
}
