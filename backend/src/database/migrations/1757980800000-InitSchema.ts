import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Week 1 baseline schema for the Plateo platform (MySQL 8 / InnoDB / utf8mb4).
 *
 * Design notes:
 *  - Money (`dishes.price`) and nutrition are DECIMAL, never FLOAT/DOUBLE.
 *  - Every tenant-owned table carries `restaurant_id` and indexes it first, so
 *    the mandatory tenant filter is always index-covered.
 *  - Enum-like columns are VARCHAR + application-level validation, which keeps
 *    new roles/statuses out of DDL migrations.
 */
export class InitSchema1757980800000 implements MigrationInterface {
  name = 'InitSchema1757980800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(120) NOT NULL,
        \`email\` VARCHAR(190) NOT NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`role\` VARCHAR(32) NOT NULL DEFAULT 'RESTAURANT_OWNER',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_users_email\` (\`email\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`restaurants\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(150) NOT NULL,
        \`slug\` VARCHAR(190) NOT NULL,
        \`description\` TEXT NULL,
        \`address\` VARCHAR(255) NULL,
        \`phone\` VARCHAR(32) NULL,
        \`logo_url\` VARCHAR(512) NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_restaurants_slug\` (\`slug\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`restaurant_users\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_restaurant_users_user\` (\`user_id\`),
        INDEX \`IDX_restaurant_users_restaurant\` (\`restaurant_id\`),
        UNIQUE INDEX \`UQ_restaurant_users_user_restaurant\` (\`user_id\`, \`restaurant_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`categories\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(120) NOT NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_categories_restaurant_sort\` (\`restaurant_id\`, \`sort_order\`),
        UNIQUE INDEX \`UQ_categories_restaurant_name\` (\`restaurant_id\`, \`name\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`ingredients\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(120) NOT NULL,
        \`description\` TEXT NULL,
        \`allergen_info\` VARCHAR(255) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_ingredients_restaurant_name\` (\`restaurant_id\`, \`name\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`dishes\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`category_id\` INT UNSIGNED NULL,
        \`name\` VARCHAR(150) NOT NULL,
        \`description\` TEXT NULL,
        \`price\` DECIMAL(10,2) NOT NULL,
        \`image_url\` VARCHAR(512) NULL,
        \`protein_grams\` DECIMAL(8,2) NULL,
        \`calories\` DECIMAL(8,2) NULL,
        \`carbs_grams\` DECIMAL(8,2) NULL,
        \`fat_grams\` DECIMAL(8,2) NULL,
        \`diet_type\` VARCHAR(16) NULL,
        \`is_available\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_dishes_restaurant\` (\`restaurant_id\`),
        INDEX \`IDX_dishes_restaurant_category\` (\`restaurant_id\`, \`category_id\`),
        INDEX \`IDX_dishes_restaurant_available\` (\`restaurant_id\`, \`is_available\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`dish_ingredients\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`dish_id\` INT UNSIGNED NOT NULL,
        \`ingredient_id\` INT UNSIGNED NOT NULL,
        \`quantity\` DECIMAL(10,3) NOT NULL,
        \`unit\` VARCHAR(16) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_dish_ingredients_ingredient\` (\`ingredient_id\`),
        UNIQUE INDEX \`UQ_dish_ingredients_dish_ingredient\` (\`dish_id\`, \`ingredient_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      ALTER TABLE \`restaurant_users\`
        ADD CONSTRAINT \`FK_restaurant_users_user\`
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`restaurant_users\`
        ADD CONSTRAINT \`FK_restaurant_users_restaurant\`
        FOREIGN KEY (\`restaurant_id\`) REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`categories\`
        ADD CONSTRAINT \`FK_categories_restaurant\`
        FOREIGN KEY (\`restaurant_id\`) REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`ingredients\`
        ADD CONSTRAINT \`FK_ingredients_restaurant\`
        FOREIGN KEY (\`restaurant_id\`) REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`dishes\`
        ADD CONSTRAINT \`FK_dishes_restaurant\`
        FOREIGN KEY (\`restaurant_id\`) REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`dishes\`
        ADD CONSTRAINT \`FK_dishes_category\`
        FOREIGN KEY (\`category_id\`) REFERENCES \`categories\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`dish_ingredients\`
        ADD CONSTRAINT \`FK_dish_ingredients_dish\`
        FOREIGN KEY (\`dish_id\`) REFERENCES \`dishes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE \`dish_ingredients\`
        ADD CONSTRAINT \`FK_dish_ingredients_ingredient\`
        FOREIGN KEY (\`ingredient_id\`) REFERENCES \`ingredients\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `dish_ingredients` DROP FOREIGN KEY `FK_dish_ingredients_ingredient`',
    );
    await queryRunner.query(
      'ALTER TABLE `dish_ingredients` DROP FOREIGN KEY `FK_dish_ingredients_dish`',
    );
    await queryRunner.query('ALTER TABLE `dishes` DROP FOREIGN KEY `FK_dishes_category`');
    await queryRunner.query('ALTER TABLE `dishes` DROP FOREIGN KEY `FK_dishes_restaurant`');
    await queryRunner.query('ALTER TABLE `ingredients` DROP FOREIGN KEY `FK_ingredients_restaurant`');
    await queryRunner.query('ALTER TABLE `categories` DROP FOREIGN KEY `FK_categories_restaurant`');
    await queryRunner.query(
      'ALTER TABLE `restaurant_users` DROP FOREIGN KEY `FK_restaurant_users_restaurant`',
    );
    await queryRunner.query(
      'ALTER TABLE `restaurant_users` DROP FOREIGN KEY `FK_restaurant_users_user`',
    );

    await queryRunner.query('DROP TABLE `dish_ingredients`');
    await queryRunner.query('DROP TABLE `dishes`');
    await queryRunner.query('DROP TABLE `ingredients`');
    await queryRunner.query('DROP TABLE `categories`');
    await queryRunner.query('DROP TABLE `restaurant_users`');
    await queryRunner.query('DROP TABLE `restaurants`');
    await queryRunner.query('DROP TABLE `users`');
  }
}
