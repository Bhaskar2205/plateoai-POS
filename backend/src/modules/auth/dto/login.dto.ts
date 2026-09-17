import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Length, IsPositive } from 'class-validator';

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
