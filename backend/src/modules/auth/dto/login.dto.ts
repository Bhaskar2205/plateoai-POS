import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Length, MaxLength, IsPositive } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsString()
  @Length(1, 128)
  password: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Optional. Which restaurant to sign in to when the account belongs to several. ' +
      'The server rejects any id the user is not a member of; when omitted the first ' +
      'membership is used. The response always lists every restaurant available.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  restaurantId?: number;
}

/**
 * A captain signing in from their phone.
 *
 * No restaurant field: the code identifies the person across Plateo, and asking
 * a waiter to type a restaurant as well as a code and a password, at a table,
 * every shift, is how a floor ends up sharing one login.
 */
export class StaffLoginDto {
  @ApiProperty({ example: 'ramesh', minLength: 3, maxLength: 32 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @Length(3, 32)
  code: string;

  @ApiProperty({ example: 'Shift2026!' })
  @IsString()
  @MaxLength(128)
  password: string;
}
