import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';

/** The public shape of a user. Deliberately has no `passwordHash` field. */
export class AuthUserDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Restaurant Owner' })
  name: string;

  @ApiProperty({ example: 'owner@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.RESTAURANT_OWNER })
  role: UserRole;
}

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Bearer token. Send as `Authorization: Bearer <accessToken>`.',
  })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ example: 86400, description: 'Token lifetime in seconds.' })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;

  @ApiProperty({ type: Restaurant, description: 'The active restaurant this token is scoped to.' })
  restaurant: Restaurant;

  @ApiProperty({
    type: [Restaurant],
    description:
      'Every restaurant this account may act for. Use POST /auth/switch-restaurant to move between them.',
  })
  restaurants: Restaurant[];
}

/** `GET /auth/me` - the authenticated identity plus its tenant context. */
export class MeResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;

  @ApiProperty({ type: Restaurant })
  restaurant: Restaurant;

  @ApiProperty({ type: [Restaurant] })
  restaurants: Restaurant[];
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example: 'Discard the access token on the client. It stays valid until it expires.',
  })
  message: string;
}
