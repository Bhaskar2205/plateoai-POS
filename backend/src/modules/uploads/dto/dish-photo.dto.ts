import { ApiProperty } from '@nestjs/swagger';

/** Where a stored dish photo lives, and what it ended up as after re-encoding. */
export class DishPhotoDto {
  @ApiProperty({
    example: 'https://api.plateoai.in/uploads/dishes/3/9f8c2a1b4d6e0f7a9c3b5d8e1f2a4c6b.webp',
    description: "Save this as the dish's imageUrl.",
  })
  url: string;

  @ApiProperty({
    example: 'https://imagedelivery.net/<hash>/<id>/thumb',
    description:
      'Grid-sized version of the same photo. Equal to `url` when the backing store cannot ' +
      'resize, so a client can always use it without checking.',
  })
  thumbnailUrl: string;

  @ApiProperty({ example: 1600 })
  width: number;

  @ApiProperty({ example: 1067 })
  height: number;

  @ApiProperty({ example: 148236, description: 'Size after re-encoding, in bytes.' })
  bytes: number;
}
