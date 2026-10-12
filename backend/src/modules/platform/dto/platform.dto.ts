import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { RestaurantStatus } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRestaurantAccountDto {
  @ApiProperty({ example: 'The Green Bowl', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  restaurantName: string;

  @ApiPropertyOptional({ example: '14 Residency Road, Bengaluru', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: '+919876543210', maxLength: 32 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ example: 'Arjun Mehta', description: "The owner's name.", maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  ownerName: string;

  @ApiProperty({ example: 'arjun@thegreenbowl.in', description: 'What the owner signs in with.' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(190)
  ownerEmail: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    description:
      'Given to the owner out of band. The same strength rules self-registration enforced - an ' +
      'owner who did not choose this is relying entirely on whoever typed it.',
    minLength: 8,
  })
  @IsString()
  @Length(8, 128)
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter' })
  @Matches(/\d/, { message: 'Password must include a number' })
  ownerPassword: string;
}

export class UpdateRestaurantStatusDto {
  @ApiProperty({ enum: RestaurantStatus })
  @IsEnum(RestaurantStatus)
  status: RestaurantStatus;
}

export class ResetOwnerPasswordDto {
  @ApiProperty({ example: 'arjun@thegreenbowl.in', description: 'Which account to reset.' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(190)
  email: string;

  @ApiProperty({ example: 'NewStrongPassword123!', minLength: 8 })
  @IsString()
  @Length(8, 128)
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter' })
  @Matches(/\d/, { message: 'Password must include a number' })
  newPassword: string;
}
