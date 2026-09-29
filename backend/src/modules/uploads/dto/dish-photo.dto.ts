import { ApiProperty } from '@nestjs/swagger';

/** Where a stored dish photo lives, and what it ended up as after re-encoding. */
export class DishPhotoDto {
  @ApiProperty({
    example: 'https://api.plateoai.in/uploads/dishes/3/9f8c2a1b4d6e0f7a9c3b5d8e1f2a4c6b.webp',
    description: "Save this as the dish's imageUrl.",
  })
  url: string;

  @ApiProperty({ example: 1600 })
  width: number;

  @ApiProperty({ example: 1067 })
  height: number;

  @ApiProperty({ example: 148236, description: 'Size on disk after re-encoding, in bytes.' })
  bytes: number;
}
