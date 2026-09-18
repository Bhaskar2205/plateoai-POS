import { ApiProperty } from '@nestjs/swagger';

/**
 * What the owner API returns for a table - an explicit allow-list, never the
 * entity. The QR token appears only inside `menuPath` / `menuUrl`, which is the
 * link the owner needs to print; there is no standalone token field.
 */
export class RestaurantTableDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Table 01' })
  name: string;

  @ApiProperty({ example: true, description: 'Inactive tables are refused by the public menu.' })
  isActive: boolean;

  @ApiProperty({
    example: '/menu/town-coffee?table=Qm9sZF9yYW5kb21fdG9rZW5fMzJjaGFy',
    description: 'Public menu path for this table, relative to the Plateo web origin.',
  })
  menuPath: string;

  @ApiProperty({
    example: 'https://app.plateoai.in/menu/town-coffee?table=Qm9sZF9yYW5kb21fdG9rZW5fMzJjaGFy',
    description:
      'Absolute public menu URL to encode in the QR code. Regenerating the QR code changes it and ' +
      'retires the previous URL.',
  })
  menuUrl: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
