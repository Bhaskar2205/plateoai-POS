import { ApiProperty } from '@nestjs/swagger';
import { TableBookingStatus } from 'src/common/enums';

/**
 * What the guest app is told back after asking for a table.
 *
 * An allow-list, not the booking row. The caller is anonymous; they are entitled
 * to the booking they just made and nothing about the restaurant's others - not
 * which tables exist, not who handled it, not what else is booked that evening.
 */
export class GuestBookingReceiptDto {
  @ApiProperty({ example: 4, description: 'Quote this to the restaurant. Restarts daily.' })
  reference: number;

  @ApiProperty({
    enum: TableBookingStatus,
    example: TableBookingStatus.REQUESTED,
    description: 'Always REQUESTED here. A table is not held until the restaurant confirms it.',
  })
  status: TableBookingStatus;

  @ApiProperty({ example: '2026-10-08T14:00:00.000Z' })
  bookedFor: string;

  @ApiProperty({ example: 4 })
  partySize: number;

  @ApiProperty({ example: 'The Green Bowl' })
  restaurantName: string;
}
