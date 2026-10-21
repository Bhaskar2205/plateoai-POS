import { ApiProperty } from '@nestjs/swagger';
import { DayEndPaymentDto, DayEndTaxLineDto } from './day-end.dto';

/**
 * The day-end statement repeated across a range - a month, usually.
 *
 * The single-day statement is what a till is closed on. This is the other
 * question, asked at the end of a month by whoever files the return: the same
 * figures, one row per trading day, plus the component-by-component totals the
 * return is actually filled in from.
 *
 * It exists as its own endpoint rather than thirty-one calls to the day-end
 * report because it reads the whole range in three queries. Thirty-one
 * round-trips for a month is the kind of thing that works on a laptop and times
 * out on a restaurant's connection.
 */

export class DayEndDayDto {
  @ApiProperty({ example: '2026-10-01' })
  businessDate: string;

  @ApiProperty({ example: true, description: 'False when bills from that day are still open.' })
  isClosed: boolean;

  @ApiProperty({ example: 0, description: 'Bills from that day still running.' })
  openBills: number;

  @ApiProperty({ example: 42, description: 'Settled bills, giveaways excluded.' })
  bills: number;

  @ApiProperty({ example: 168 })
  itemsSold: number;

  @ApiProperty({ example: 24000, description: 'Menu value sold, before discount and tax.' })
  gross: number;

  @ApiProperty({ example: 1200 })
  discounts: number;

  @ApiProperty({ example: 22800, description: 'gross - discounts. What tax is charged on.' })
  netSales: number;

  @ApiProperty({ example: 0, description: "The restaurant's own service charge. Not a tax." })
  serviceCharge: number;

  @ApiProperty({ example: 1140 })
  taxTotal: number;

  @ApiProperty({ example: 23940, description: 'net + service charge + tax.' })
  total: number;

  @ApiProperty({ example: 0, description: 'Income tax withheld by corporate payers.' })
  tdsWithheld: number;

  @ApiProperty({ example: 23940, description: 'total - TDS. What should have arrived.' })
  collected: number;

  @ApiProperty({ example: 1 })
  voidedBills: number;

  @ApiProperty({ example: 320, description: 'Never counted as takings.' })
  voidedValue: number;

  @ApiProperty({ example: 2, description: 'Bills given away. Never counted as sales.' })
  ncBills: number;

  @ApiProperty({ example: 860 })
  ncValue: number;

  @ApiProperty({ type: [DayEndTaxLineDto], description: 'That day, component by component.' })
  taxes: DayEndTaxLineDto[];

  @ApiProperty({ type: [DayEndPaymentDto] })
  payments: DayEndPaymentDto[];
}

export class DayEndTotalsDto {
  @ApiProperty({ example: 22, description: 'Business days in the range that traded.' })
  tradingDays: number;

  @ApiProperty({ example: 912 })
  bills: number;

  @ApiProperty({ example: 3640 })
  itemsSold: number;

  @ApiProperty({ example: 528000 })
  gross: number;

  @ApiProperty({ example: 26400 })
  discounts: number;

  @ApiProperty({ example: 501600 })
  netSales: number;

  @ApiProperty({ example: 0 })
  serviceCharge: number;

  @ApiProperty({ example: 25080 })
  taxTotal: number;

  @ApiProperty({ example: 526680 })
  total: number;

  @ApiProperty({ example: 0 })
  tdsWithheld: number;

  @ApiProperty({ example: 526680 })
  collected: number;

  @ApiProperty({ example: 11 })
  voidedBills: number;

  @ApiProperty({ example: 4200 })
  voidedValue: number;

  @ApiProperty({ example: 24 })
  ncBills: number;

  @ApiProperty({ example: 9800 })
  ncValue: number;

  @ApiProperty({ example: 578, description: 'Average settled bill across the range.' })
  averageBill: number;

  @ApiProperty({ example: 3, description: 'Days in the range with a bill still open.' })
  daysNotClosed: number;
}

export class DayEndSeriesDto {
  @ApiProperty({ example: '2026-10-01' })
  from: string;

  @ApiProperty({ example: '2026-10-31' })
  to: string;

  @ApiProperty({
    type: [DayEndDayDto],
    description: 'One row per business day that had any bill at all. Dead days are left out.',
  })
  days: DayEndDayDto[];

  @ApiProperty({ type: DayEndTotalsDto })
  totals: DayEndTotalsDto;

  @ApiProperty({
    type: [DayEndTaxLineDto],
    description: 'The whole range, component by component. This is what a monthly return is filed from.',
  })
  taxes: DayEndTaxLineDto[];

  @ApiProperty({ type: [DayEndPaymentDto], description: 'How the range was paid for.' })
  payments: DayEndPaymentDto[];
}
