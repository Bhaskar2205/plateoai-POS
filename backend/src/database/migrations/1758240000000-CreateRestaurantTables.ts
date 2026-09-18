import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds restaurant tables with QR codes.
 *
 * Additive only: one new table and one foreign key. No existing table, column or
 * row is touched, so `down()` (drop the new table) loses nothing but table data.
 *
 *  - `restaurant_id` is indexed first via the per-restaurant unique name index,
 *    so the tenant filter is always index-covered.
 *  - `qr_token` is globally unique: the public menu looks a table up by it. It
 *    uses a binary ASCII collation because tokens are case-sensitive base64url;
 *    under the default case-insensitive collation "abc" would match "ABC". (Not
 *    declared on the entity: SQLite, used by the test suite, rejects the collation.)
 *  - Deleting a restaurant deletes its tables (ON DELETE CASCADE), like every
 *    other tenant-owned table.
 */
export class CreateRestaurantTables1758240000000 implements MigrationInterface {
  name = 'CreateRestaurantTables1758240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`restaurant_tables\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(60) NOT NULL,
        \`qr_token\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_restaurant_tables_restaurant_name\` (\`restaurant_id\`, \`name\`),
        UNIQUE INDEX \`UQ_restaurant_tables_qr_token\` (\`qr_token\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      ALTER TABLE \`restaurant_tables\`
        ADD CONSTRAINT \`FK_restaurant_tables_restaurant\`
        FOREIGN KEY (\`restaurant_id\`) REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `restaurant_tables` DROP FOREIGN KEY `FK_restaurant_tables_restaurant`',
    );
    await queryRunner.query('DROP TABLE `restaurant_tables`');
  }
}
