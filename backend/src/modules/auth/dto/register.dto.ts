import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Self-serve onboarding: creates the owner, their restaurant and the link. */
export class RegisterDto {
  @ApiProperty({ example: 'Restaurant Owner', minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: 'owner@example.com', maxLength: 190 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(190)
  email: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    minLength: 8,
    maxLength: 128,
    description:
      'At least 8 characters with one lowercase letter, one uppercase letter and one digit.',
  })
  @IsString()
  @Length(8, 128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'password must contain at least one lowercase letter, one uppercase letter and one digit',
  })
  password: string;

  @ApiProperty({ example: 'The Green Bowl', minLength: 2, maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  restaurantName: string;

  @ApiPropertyOptional({ example: 'Jaipur, Rajasthan', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[+]?[0-9 ()-]{6,32}$/, { message: 'phone must be a valid phone number' })
  phone?: string;
}
