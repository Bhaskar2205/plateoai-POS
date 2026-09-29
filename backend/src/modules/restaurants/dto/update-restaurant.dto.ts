import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RestaurantStatus } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Partial update of the authenticated restaurant's profile.
 *
 * `id`, `slug`, `publicSlug` and `createdAt` are intentionally absent: the slug
 * is derived server-side from the name so it cannot be squatted or collided with
 * by input, and `publicSlug` is permanent. The global ValidationPipe rejects
 * any of them in a request body with 400.
 */
export class UpdateRestaurantDto {
  @ApiPropertyOptional({ example: 'The Green Bowl', minLength: 2, maxLength: 150 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  name?: string;

  @ApiPropertyOptional({ example: 'Seasonal bowls and salads, made fresh every morning.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'C-12, Malviya Nagar, Jaipur, Rajasthan 302017' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[+]?[0-9 ()-]{6,32}$/, {
    message: 'phone must be a valid phone number',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { require_protocol: true, require_tld: false, protocols: ['http', 'https'] },
    { message: 'logoUrl must be a valid http(s) URL' },
  )
  @MaxLength(512)
  logoUrl?: string;

  /**
   * Tax percentage added to bills.
   *
   * Capped at 100 rather than left open: a typo of 500 would otherwise sextuple
   * every bill the restaurant prints. The rate is copied onto each bill when it
   * is settled, so changing it here never rewrites a bill already paid.
   */
  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({
    example: '08AAAAA0000A1Z5',
    description: 'Tax registration number printed on bills, e.g. a GSTIN. Send an empty string to clear it.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  taxNumber?: string;

  /**
   * Platform state, not a profile field.
   *
   * Only SUPER_ADMIN may set it (enforced in `RestaurantsService`). An owner who
   * could suspend their own restaurant would lock their whole team out with no
   * way back in, since an INACTIVE tenant refuses both login and existing
   * tokens.
   */
  @ApiPropertyOptional({
    enum: RestaurantStatus,
    example: RestaurantStatus.ACTIVE,
    description: 'Platform support only (SUPER_ADMIN). Owners cannot change their own status.',
  })
  @IsOptional()
  @IsIn(Object.values(RestaurantStatus))
  status?: RestaurantStatus;
}
