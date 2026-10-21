import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

/** `YYYY-MM-DD`, the shape `orders.business_date` is stored in. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Erasing a stretch of trading history, permanently.
 *
 * There is no soft delete and no recycle bin here, because a feature called
 * "delete permanently" that quietly keeps the data would be a lie told to
 * somebody who had a reason to ask. What survives is the audit record saying it
 * happened, who did it, and what the totals were at the moment it went - which
 * is the one thing an owner, or an inspector, needs afterwards and the one thing
 * the deleted rows cannot provide.
 *
 * Both ends are business dates and both are inclusive.
 */
export class DeleteTradingDataDto {
  @ApiProperty({ example: '2025-04-01', description: 'First business day to erase, inclusive.' })
  @Matches(DATE_PATTERN, { message: 'from must be a date in YYYY-MM-DD form' })
  from: string;

  @ApiProperty({ example: '2025-06-30', description: 'Last business day to erase, inclusive.' })
  @Matches(DATE_PATTERN, { message: 'to must be a date in YYYY-MM-DD form' })
  to: string;

  @ApiProperty({
    example: 'The Green Bowl',
    description:
      "The restaurant's own name, typed out. Not a formality: it is the difference between " +
      'clicking through a dialog and stating which restaurant is being erased, and it is the only ' +
      'guard that still works when somebody is in a hurry.',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  confirmName: string;
}

export class TradingDataSummaryDto {
  @ApiProperty({ example: '2025-04-01' })
  from: string;

  @ApiProperty({ example: '2025-06-30' })
  to: string;

  @ApiProperty({ example: 1840, description: 'Settled bills in the range.' })
  settledBills: number;

  @ApiProperty({ example: 22, description: 'Voided bills in the range.' })
  voidedBills: number;

  @ApiProperty({ example: 48, description: 'No-charge bills in the range.' })
  ncBills: number;

  @ApiProperty({
    example: 0,
    description: 'Bills still open. Any at all blocks the deletion: an unfinished service is not history yet.',
  })
  openBills: number;

  @ApiProperty({ example: 7320, description: 'Billed lines that would go with them.' })
  items: number;

  @ApiProperty({ example: 1512, description: 'Kitchen tickets that would go with them.' })
  kotTickets: number;

  @ApiProperty({ example: 3680, description: 'Tax and charge lines that would go with them.' })
  charges: number;

  @ApiProperty({ example: 2480650, description: 'What those bills took. Shown so an owner can check they exported it.' })
  collected: number;

  @ApiProperty({ nullable: true, example: '2025-04-01', description: 'Earliest business day found in the range.' })
  firstDate: string | null;

  @ApiProperty({ nullable: true, example: '2025-06-29' })
  lastDate: string | null;

  @ApiProperty({ example: true, description: 'False when something blocks it; see `blockedReason`.' })
  canDelete: boolean;

  @ApiProperty({ nullable: true, example: 'Two bills in this range are still open.' })
  blockedReason: string | null;
}

export class TradingDataDeletedDto {
  @ApiProperty({ example: '2025-04-01' })
  from: string;

  @ApiProperty({ example: '2025-06-30' })
  to: string;

  @ApiProperty({ example: 1910, description: 'Bills erased.' })
  deletedBills: number;

  @ApiProperty({ example: 7320 })
  deletedItems: number;

  @ApiProperty({ example: 1512 })
  deletedKotTickets: number;

  @ApiProperty({ example: 3680 })
  deletedCharges: number;

  @ApiProperty({
    example: 4,
    description:
      'Payment-gateway records that pointed at an erased bill and no longer do. They are kept: a ' +
      "restaurant deleting its own history must not be able to erase the processor's side of a " +
      'payment.',
  })
  detachedPaymentRecords: number;
}
