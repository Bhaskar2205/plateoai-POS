import { ApiProperty } from '@nestjs/swagger';

/** The kitchen sign-in code, as the owner reads it off the screen. */
export class KitchenCodeDto {
  @ApiProperty({ example: 'K7F2QM', description: 'What is typed in. Case-insensitive.' })
  code: string;

  @ApiProperty({ example: 'K7F-2QM', description: 'The same code, grouped for reading aloud.' })
  display: string;
}
