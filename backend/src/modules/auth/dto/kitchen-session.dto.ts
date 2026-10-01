import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { normaliseKitchenCode } from 'src/modules/restaurants/kitchen-code';

/**
 * Signing a kitchen screen in.
 *
 * The code is normalised before validation, so a cook may type it in lower case,
 * with the dash it is printed with, or with a stray space - all of which happen
 * on a tablet in a kitchen.
 */
export class KitchenSessionDto {
  @ApiProperty({ example: 'K7F-2QM', description: 'The restaurant kitchen code. Case-insensitive.' })
  @Transform(({ value }) => normaliseKitchenCode(value))
  @IsString()
  @Length(6, 6, { message: 'A kitchen code is 6 characters' })
  @Matches(/^[ACDEFGHJKMNPQRTUVWXY2345679]{6}$/, { message: 'That is not a valid kitchen code' })
  code: string;
}

/**
 * What a kitchen screen gets back.
 *
 * Deliberately thin: the restaurant's name so the screen can title itself, and a
 * token that reaches the kitchen board and nothing else. No user, no menu, no
 * money - there is no account behind a kitchen screen, only a room.
 */
export class KitchenSessionResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ example: 86400 })
  expiresIn: number;

  @ApiProperty({ example: 'The Green Bowl' })
  restaurantName: string;
}
