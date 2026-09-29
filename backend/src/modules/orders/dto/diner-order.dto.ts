import { ApiProperty } from '@nestjs/swagger';

export class DinerOrderLineDto {
  @ApiProperty({ example: 'Paneer Tikka Bowl' })
  name: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ nullable: true, example: 'No onion, less spicy' })
  note: string | null;
}

/**
 * What a diner gets back after ordering from a table QR menu.
 *
 * Deliberately narrow: the lines this request added, and the fact that staff have
 * to confirm them. It carries no totals, no discount and none of the *other*
 * lines already on the table's bill - a table QR code is printed in public, and
 * anyone who photographs one should not be able to watch a bill from elsewhere.
 * The bill is shown by staff at the table.
 */
export class DinerOrderReceiptDto {
  @ApiProperty({ example: 'Table 01' })
  tableName: string;

  @ApiProperty({ type: [DinerOrderLineDto] })
  items: DinerOrderLineDto[];

  @ApiProperty({
    example: 3,
    description: 'How many of your requests are waiting for staff to confirm.',
  })
  awaitingApprovalCount: number;

  @ApiProperty({
    example: 'Sent to the restaurant. A member of staff will confirm your order shortly.',
  })
  message: string;
}
