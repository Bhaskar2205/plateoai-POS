import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table bookings: what the Plateo guest app sends a restaurant that is not a QR
 * order at a table.
 *
 * Entirely additive. One new table and not one column changed on `orders`,
 * `order_items` or `kot_tickets`, which is the point: the POS keeps working
 * exactly as it does, and no floor view, bill list or settle path has to learn
 * to skip a kind of order that can never be settled.
 *
 * Bookings number per restaurant per business day, like bills do, so staff can
 * say "booking 4" to each other.
 *
 * The discount columns hold an *intention*, not money: a booking has no bill yet,
 * so there is nothing to compute an amount against. `discount_amount` therefore
 * has no equivalent here - it is worked out on the order when the discount is
 * actually applied. Type and value mirror `orders` so the number staff read off
 * the booking is the number they type into the bill, with no conversion.
 */
export class CreateTableBookings1759795200000 implements MigrationInterface {
  name = 'CreateTableBookings1759795200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`table_bookings\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`reference_number\` INT UNSIGNED NOT NULL,
        \`business_date\` DATE NOT NULL,
        \`guest_name\` VARCHAR(120) NOT NULL,
        \`guest_phone\` VARCHAR(32) NOT NULL,
        \`guest_email\` VARCHAR(190) NULL,
        \`party_size\` SMALLINT UNSIGNED NOT NULL,
        \`booked_for\` DATETIME(6) NOT NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
        \`table_id\` INT UNSIGNED NULL,
        \`discount_type\` VARCHAR(8) NULL,
        \`discount_value\` DECIMAL(10,2) NULL,
        \`discount_reason\` VARCHAR(255) NULL,
        \`guest_note\` VARCHAR(500) NULL,
        \`restaurant_note\` VARCHAR(500) NULL,
        \`responded_at\` DATETIME(6) NULL,
        \`seated_at\` DATETIME(6) NULL,
        \`handled_by_user_id\` INT UNSIGNED NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_table_bookings_restaurant_date_reference\`
          (\`restaurant_id\`, \`business_date\`, \`reference_number\`),
        KEY \`IDX_table_bookings_restaurant_time\` (\`restaurant_id\`, \`booked_for\`),
        KEY \`IDX_table_bookings_restaurant_status\` (\`restaurant_id\`, \`status\`),
        CONSTRAINT \`FK_table_bookings_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_table_bookings_table\` FOREIGN KEY (\`table_id\`)
          REFERENCES \`restaurant_tables\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_table_bookings_handler\` FOREIGN KEY (\`handled_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `table_bookings`');
  }
}
