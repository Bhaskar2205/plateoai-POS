import { ApiProperty } from '@nestjs/swagger';
import { DietType } from 'src/common/enums';

/**
 * The public menu is a deliberate allow-list. Every field below is safe to show
 * an anonymous diner; nothing is serialised from an entity directly, so a column
 * added to `restaurants` or `dishes` later cannot leak here by accident.
 *
 * Never add: restaurant ids, status, phone, members, emails, timestamps, table
 * ids or QR tokens, or anything describing unavailable dishes or hidden categories.
 */

export class PublicRestaurantDto {
  @ApiProperty({ example: 'The Green Bowl' })
  name: string;

  @ApiProperty({ example: 'the-green-bowl' })
  slug: string;

  @ApiProperty({ nullable: true, example: 'Seasonal bowls and salads, made fresh every morning.' })
  description: string | null;

  @ApiProperty({ nullable: true, example: 'C-12, Malviya Nagar, Jaipur 302017' })
  address: string | null;

  @ApiProperty({ nullable: true, example: 'https://cdn.example.com/logo.png' })
  logoUrl: string | null;
}

export class PublicTableDto {
  @ApiProperty({ example: 'Table 01' })
  name: string;
}

/**
 * An ingredient as a diner sees it: the name, and whether it carries an allergen.
 *
 * Deliberately no quantity. A diner asking "what is in this?" wants to know there
 * is paneer in it, not that there are 180 grams of it - and the proportions of a
 * dish are the kitchen's own work, which has no business being readable by
 * anyone who opens the menu.
 */
export class PublicIngredientDto {
  @ApiProperty({ example: 'Paneer' })
  name: string;

  @ApiProperty({
    nullable: true,
    example: 'Contains milk',
    description: 'Allergen declaration as supplied by the restaurant, unverified.',
  })
  allergenInfo: string | null;
}

export class PublicNutritionDto {
  @ApiProperty({ nullable: true, example: 380, description: 'Energy in kilocalories (kcal).' })
  calories: number | null;

  @ApiProperty({ nullable: true, example: 22, description: 'Protein in grams.' })
  proteinGrams: number | null;

  @ApiProperty({ nullable: true, example: 24, description: 'Carbohydrates in grams.' })
  carbsGrams: number | null;

  @ApiProperty({ nullable: true, example: 19, description: 'Fat in grams.' })
  fatGrams: number | null;

  @ApiProperty({
    enum: ['RESTAURANT_DECLARED'],
    example: 'RESTAURANT_DECLARED',
    description: 'Values are entered by the restaurant; Plateo does not calculate or verify them.',
  })
  source: 'RESTAURANT_DECLARED';
}

export class PublicDishDto {
  @ApiProperty({ example: 7, description: 'Stable key for the dish within this menu.' })
  id: number;

  @ApiProperty({ example: 'Paneer Tikka Bowl' })
  name: string;

  @ApiProperty({ nullable: true, example: 'Grilled paneer with fresh vegetables and mint dressing' })
  description: string | null;

  @ApiProperty({ example: 299, description: 'Price in the menu currency.' })
  price: number;

  @ApiProperty({ nullable: true, example: 'https://cdn.example.com/paneer-tikka-bowl.jpg' })
  imageUrl: string | null;

  @ApiProperty({ nullable: true, example: 15, description: 'Typical preparation time in minutes.' })
  preparationTimeMinutes: number | null;

  @ApiProperty({ enum: DietType, nullable: true, example: DietType.VEG })
  dietType: DietType | null;

  @ApiProperty({
    type: PublicNutritionDto,
    nullable: true,
    description: 'Null when the restaurant has entered no nutrition values for the dish.',
  })
  nutrition: PublicNutritionDto | null;

  @ApiProperty({ type: [PublicIngredientDto] })
  ingredients: PublicIngredientDto[];

  @ApiProperty({
    type: [String],
    example: ['Contains milk', 'Contains tree nuts'],
    description: 'Distinct allergen declarations across the dish ingredients, sorted.',
  })
  allergens: string[];
}

export class PublicCategoryDto {
  @ApiProperty({ example: 3, description: 'Stable key for the section within this menu.' })
  id: number;

  @ApiProperty({ example: 'Signature Bowls' })
  name: string;

  @ApiProperty({ type: [PublicDishDto], description: 'Always at least one dish.' })
  dishes: PublicDishDto[];
}

export class PublicMenuDto {
  @ApiProperty({ type: PublicRestaurantDto })
  restaurant: PublicRestaurantDto;

  @ApiProperty({
    type: PublicTableDto,
    nullable: true,
    description: 'The table from `?table=`, or null when the menu was requested without one.',
  })
  table: PublicTableDto | null;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({
    type: [PublicCategoryDto],
    description: 'Active categories in display order. Categories with no available dishes are omitted.',
  })
  categories: PublicCategoryDto[];

  @ApiProperty({
    type: [PublicDishDto],
    description: 'Available dishes that are not in any category.',
  })
  uncategorisedDishes: PublicDishDto[];

  @ApiProperty({
    example:
      'Nutrition and allergen information is provided by the restaurant and has not been verified by Plateo.',
  })
  disclaimer: string;
}
