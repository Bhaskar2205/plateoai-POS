import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { configuration } from 'src/config/configuration';
import { User } from 'src/modules/users/entities/user.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { mysqlUtcConnectionOptions } from './mysql-utc';

loadEnv({ quiet: true });

/**
 * Explicit entity list rather than a glob, so the TypeORM CLI, the Nest runtime
 * and the compiled `dist` build all resolve the same classes.
 */
export const entities = [
  User,
  Restaurant,
  RestaurantUser,
  Category,
  Dish,
  Ingredient,
  DishIngredient,
];

export const buildDataSourceOptions = (): DataSourceOptions => {
  const { database } = configuration();

  return {
    type: 'mysql',
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
    entities,
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    migrationsTableName: 'plateo_migrations',
    synchronize: database.synchronize,
    logging: database.logging,
    charset: 'utf8mb4',
    // UTC on the wire *and* in the MySQL session - see mysql-utc.ts.
    ...mysqlUtcConnectionOptions,
  };
};

/** Default export consumed by `npm run migration:*`. */
const dataSource = new DataSource(buildDataSourceOptions());

export default dataSource;
