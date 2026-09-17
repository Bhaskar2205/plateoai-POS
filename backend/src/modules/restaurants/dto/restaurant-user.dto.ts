import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from 'src/common/enums';

/** A member of the restaurant, without any credential material. */
export class RestaurantUserDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Asha Verma' })
  name: string;

  @ApiProperty({ example: 'owner@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.RESTAURANT_OWNER })
  role: UserRole;

  @ApiProperty({ description: 'When this user joined the restaurant.' })
  joinedAt: Date;
}
