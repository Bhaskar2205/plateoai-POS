import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod, TaxKind } from 'src/common/enums';

/**
 * The day-end statement a restaurant closes the till with - a Z report.
 *
 * Deliberately a statement of one business day rather than a range: it is the
 * thing printed at close, signed, and handed over with the cash. A business day
 * starts at 05:00, so a bill settled at 01:30 belongs to the night before.
 */

export class DayEndTaxLineDto {
  @ApiProperty({ example: 'CGST' })
  name: string;

  @ApiProperty({ enum: TaxKind, example: TaxKind.CGST })
  kind: TaxKind;

  @ApiProperty({ example: 2.5 })
  rate: number;

  @ApiProperty({ example: 12000, description: 'The value this rate was charged on, across the day.' })
  taxableAmount: number;

  @ApiProperty({ example: 300, description: 'Collected, and owed on filing.' })
  amount: number;

  @ApiProperty({ example: 24, description: 'How many bills carried this charge.' })
  bills: number;
}

export class DayEndPaymentDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  method: PaymentMethod;

  @ApiProperty({ example: 14 })
  bills: number;

  @ApiProperty({ example: 8450.5 })
  total: number;
}

export class DayEndReportDto {
  @ApiProperty({ example: '2026-10-01', description: 'The business day this statement covers.' })
  businessDate: string;

  @ApiProperty({ example: true, description: 'False when bills are still open, so the day is not final.' })
  isClosed: boolean;

  @ApiProperty({ example: 2, description: 'Bills still running. Their money is not in these totals.' })
  openBills: number;

  @ApiProperty({ example: 1840, description: 'Value of what is still on open tables.' })
  openValue: number;

  @ApiProperty({ example: 42 })
  bills: number;

  @ApiProperty({ example: 168 })
  itemsSold: number;

  @ApiProperty({ example: 24000, description: 'Menu value of everything sold, before discount and tax.' })
  gross: number;

  @ApiProperty({ example: 1200 })
  discounts: number;

  @ApiProperty({ example: 22800, description: 'gross - discounts. The value tax is charged on.' })
  netSales: number;

  @ApiProperty({ example: 0, description: "The restaurant's own service charge, which is not a tax." })
  serviceCharge: number;

  @ApiProperty({ type: [DayEndTaxLineDto], description: 'Each tax component collected, for filing.' })
  taxes: DayEndTaxLineDto[];

  @ApiProperty({ example: 1140 })
  taxTotal: number;

  @ApiProperty({ example: 23940, description: 'What was billed: net + service charge + tax.' })
  total: number;

  @ApiProperty({ example: 0, description: 'Income tax withheld by payers on corporate bills.' })
  tdsWithheld: number;

  @ApiProperty({ example: 23940, description: 'total - TDS. What should be in the drawer and the bank.' })
  collected: number;

  @ApiProperty({ type: [DayEndPaymentDto] })
  payments: DayEndPaymentDto[];

  @ApiProperty({ example: 570, description: 'Average settled bill.' })
  averageBill: number;

  @ApiProperty({ example: 3 })
  voidedBills: number;

  @ApiProperty({ example: 980, description: 'Value of voided bills. Never counted as takings.' })
  voidedValue: number;

  @ApiProperty({ nullable: true, example: '2026-10-01T06:42:00.000Z' })
  firstSettledAt: Date | null;

  @ApiProperty({ nullable: true, example: '2026-10-01T17:11:00.000Z' })
  lastSettledAt: Date | null;
}
