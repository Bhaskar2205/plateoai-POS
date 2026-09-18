import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import { hashPassword } from 'src/common/security/password';
import { slugify } from 'src/common/utils/slug.util';
import dataSource from '../data-source';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { User } from 'src/modules/users/entities/user.entity';

/**
 * Development seed: one restaurant with a small, plausible menu so the admin UI
 * has something to render before a real restaurant signs up.
 *
 * Nutrition values here are illustrative placeholders for local development.
 * They are not measured, verified, or nutritional advice - production data must
 * be entered by the restaurant itself.
 *
 * Safe to re-run: it exits early if the demo account already exists.
 */
const DEMO_EMAIL = 'owner@plateo.test';
const DEMO_PASSWORD = 'StrongPassword123!';

async function seed(source: DataSource): Promise<void> {
  const existing = await source.getRepository(User).findOne({ where: { email: DEMO_EMAIL } });

  if (existing) {
    console.log(`Seed skipped: ${DEMO_EMAIL} already exists.`);
    return;
  }

  await source.transaction(async (manager) => {
    const restaurant = await manager.getRepository(Restaurant).save(
      manager.getRepository(Restaurant).create({
        name: 'The Green Bowl',
        slug: slugify('The Green Bowl'),
        publicSlug: slugify('The Green Bowl'),
        description: 'Seasonal bowls and salads, made fresh every morning.',
        address: 'C-12, Malviya Nagar, Jaipur, Rajasthan 302017',
        phone: '+919876543210',
        status: RestaurantStatus.ACTIVE,
      }),
    );

    const owner = await manager.getRepository(User).save(
      manager.getRepository(User).create({
        name: 'Demo Owner',
        email: DEMO_EMAIL,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        role: UserRole.RESTAURANT_OWNER,
      }),
    );

    await manager.getRepository(RestaurantUser).save(
      manager
        .getRepository(RestaurantUser)
        .create({ userId: owner.id, restaurantId: restaurant.id }),
    );

    const categoryRepository = manager.getRepository(Category);
    const [bowls, drinks] = await categoryRepository.save([
      categoryRepository.create({
        restaurantId: restaurant.id,
        name: 'Signature Bowls',
        sortOrder: 1,
      }),
      categoryRepository.create({ restaurantId: restaurant.id, name: 'Drinks', sortOrder: 2 }),
    ]);

    const ingredientRepository = manager.getRepository(Ingredient);
    const [paneer, spinach, mango] = await ingredientRepository.save([
      ingredientRepository.create({
        restaurantId: restaurant.id,
        name: 'Paneer',
        description: 'Fresh cottage cheese, made in house.',
        allergenInfo: 'Contains milk',
      }),
      ingredientRepository.create({ restaurantId: restaurant.id, name: 'Baby Spinach' }),
      ingredientRepository.create({ restaurantId: restaurant.id, name: 'Alphonso Mango' }),
    ]);

    const dishRepository = manager.getRepository(Dish);
    const [paneerBowl] = await dishRepository.save([
      dishRepository.create({
        restaurantId: restaurant.id,
        categoryId: bowls.id,
        name: 'Paneer Tikka Bowl',
        description: 'Grilled paneer with fresh vegetables and mint dressing.',
        price: 299,
        proteinGrams: 22,
        calories: 380,
        carbsGrams: 24,
        fatGrams: 19,
        dietType: 'VEG' as Dish['dietType'],
        isAvailable: true,
      }),
      dishRepository.create({
        restaurantId: restaurant.id,
        categoryId: drinks.id,
        name: 'Mango Lassi',
        description: 'Yoghurt blended with Alphonso mango.',
        price: 129,
        proteinGrams: 6,
        calories: 210,
        carbsGrams: 34,
        fatGrams: 5,
        dietType: 'VEG' as Dish['dietType'],
        isAvailable: true,
      }),
    ]);

    const dishIngredientRepository = manager.getRepository(DishIngredient);
    await dishIngredientRepository.save([
      dishIngredientRepository.create({
        dishId: paneerBowl.id,
        ingredientId: paneer.id,
        quantity: 120,
        unit: 'g',
      }),
      dishIngredientRepository.create({
        dishId: paneerBowl.id,
        ingredientId: spinach.id,
        quantity: 40,
        unit: 'g',
      }),
    ]);

    console.log('Seeded restaurant:', restaurant.name);
    console.log('Login with:', DEMO_EMAIL, '/', DEMO_PASSWORD);
    console.log('Unused sample ingredient available:', mango.name);
  });
}

async function main(): Promise<void> {
  const source = await dataSource.initialize();

  try {
    await seed(source);
  } finally {
    await source.destroy();
  }
}

void main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
