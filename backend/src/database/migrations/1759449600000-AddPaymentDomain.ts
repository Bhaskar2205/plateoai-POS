import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The payment domain: intents, webhook deliveries, and the exceptions a person
 * has to look at.
 *
 * Additive. Nothing about existing orders or billing is touched, so cash, UPI,
 * card and "other" settlement keep working exactly as they do — online payment
 * is an addition, not a replacement, and a restaurant that never turns it on
 * should not be able to tell this shipped.
 *
 * Three indexes earn their place:
 *
 *  - `UQ_webhook_provider_event` makes a repeated delivery collide rather than
 *    run twice. Providers retry by design; this is the mechanism that makes that
 *    harmless.
 *  - `UQ_payment_intents_provider_payment` stops one provider payment being
 *    recorded against two intents, which is the backstop if a provider re-sends
 *    the same payment under a fresh event id.
 *  - The rest are the queries the payments screen and the reconciliation sweep
 *    actually make.
 *
 * `amount_paise` is BIGINT rather than DECIMAL, unlike every other money column.
 * Providers speak in the smallest unit, and converting once at the boundary is
 * safer than converting on each call.
 */
export class AddPaymentDomain1759449600000 implements MigrationInterface {
  name = 'AddPaymentDomain1759449600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`payment_intents\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NULL,
        \`bill_id\` INT UNSIGNED NULL,
        \`amount_paise\` BIGINT NOT NULL,
        \`currency\` VARCHAR(3) NOT NULL DEFAULT 'INR',
        \`status\` VARCHAR(24) NOT NULL DEFAULT 'CREATED',
        \`provider\` VARCHAR(24) NOT NULL,
        \`provider_payment_id\` VARCHAR(128) NULL,
        \`provider_order_id\` VARCHAR(128) NULL,
        \`idempotency_key\` VARCHAR(128) NULL,
        \`metadata\` JSON NULL,
        \`failure_reason\` VARCHAR(255) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`authorized_at\` DATETIME(6) NULL,
        \`captured_at\` DATETIME(6) NULL,
        \`failed_at\` DATETIME(6) NULL,
        \`cancelled_at\` DATETIME(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_payment_intents_provider_payment\` (\`provider\`, \`provider_payment_id\`),
        KEY \`IDX_payment_intents_restaurant_created\` (\`restaurant_id\`, \`created_at\`),
        KEY \`IDX_payment_intents_restaurant_status\` (\`restaurant_id\`, \`status\`),
        KEY \`IDX_payment_intents_order\` (\`order_id\`),
        CONSTRAINT \`FK_payment_intents_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_payment_intents_order\` FOREIGN KEY (\`order_id\`)
          REFERENCES \`orders\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`payment_webhook_events\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`provider\` VARCHAR(24) NOT NULL,
        \`provider_event_id\` VARCHAR(128) NOT NULL,
        \`event_type\` VARCHAR(64) NOT NULL,
        \`payload_hash\` VARCHAR(64) NOT NULL,
        \`payment_intent_id\` INT UNSIGNED NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'PROCESSED',
        \`processed_at\` DATETIME(6) NULL,
        \`error_message\` VARCHAR(500) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_webhook_provider_event\` (\`provider\`, \`provider_event_id\`),
        KEY \`IDX_webhook_created\` (\`created_at\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`payment_reconciliation_exceptions\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`issue\` VARCHAR(48) NOT NULL,
        \`payment_intent_id\` INT UNSIGNED NULL,
        \`order_id\` INT UNSIGNED NULL,
        \`detail\` VARCHAR(500) NOT NULL,
        \`context\` JSON NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`resolved_at\` DATETIME(6) NULL,
        \`resolution_note\` VARCHAR(500) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_recon_restaurant_resolved\` (\`restaurant_id\`, \`resolved_at\`),
        CONSTRAINT \`FK_recon_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `payment_reconciliation_exceptions`');
    await queryRunner.query('DROP TABLE `payment_webhook_events`');
    await queryRunner.query('DROP TABLE `payment_intents`');
  }
}
