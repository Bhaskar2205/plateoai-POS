import { ApiProperty } from '@nestjs/swagger';
import { DietType } from 'src/common/enums';

/**
 * One dish on a captain's order board.
 *
 * The smallest thing a waiter can punch from: what it is called, what it costs,
 * which course it belongs to, and whether it is veg. No description, no photo,
 * no allergens, no nutrition - a captain knows the menu, and every field here
 * is one they read at a table on a phone during service.
 */
export class OrderBoardDishDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 'Paneer Tikka' })
  name: string;

  @ApiProperty({ example: 320 })
  price: number;

  @ApiProperty({ nullable: true, example: 'Starters', description: 'Null for uncategorised dishes.' })
  categoryName: string | null;

  @ApiProperty({ nullable: true, enum: DietType })
  dietType: DietType | null;
}
