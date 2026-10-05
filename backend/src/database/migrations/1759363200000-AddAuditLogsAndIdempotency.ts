import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two tables that record what happened and stop it happening twice.
 *
 * Purely additive: nothing existing is altered, so the application keeps working
 * untouched while this lands, and the rollback is a pair of drops.
 *
 * `audit_logs` is append-only by convention rather than by grant - the
 * application never issues an UPDATE or DELETE against it. Enforcing that in the
 * database would need a second MySQL user with narrower rights, which is a
 * deployment decision rather than a schema one; it is written down in
 * docs/production-readiness.md instead of being half-done here.
 *
 * `idempotency_keys` carries the unique index that does the actual work:
 * (restaurant_id, scope, `key`). Two requests with the same key race to insert,
 * one wins, and the loser is served the winner's stored response. `restaurant_id`
 * defaults to 0 rather than being nullable because MySQL treats NULLs as distinct
 * in a unique index, which would quietly allow the duplicates this prevents.
 */
export class AddAuditLogsAndIdempotency1759363200000 implements MigrationInterface {
  name = 'AddAuditLogsAndIdempotency1759363200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`audit_logs\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NULL,
        \`action\` VARCHAR(40) NOT NULL,
        \`entity_type\` VARCHAR(24) NOT NULL,
        \`entity_id\` INT UNSIGNED NULL,
        \`old_value\` JSON NULL,
        \`new_value\` JSON NULL,
        \`reason\` VARCHAR(255) NULL,
        \`request_id\` VARCHAR(64) NULL,
        \`ip_address\` VARCHAR(45) NULL,
        \`user_agent\` VARCHAR(255) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_audit_logs_restaurant_created\` (\`restaurant_id\`, \`created_at\`),
        KEY \`IDX_audit_logs_restaurant_action\` (\`restaurant_id\`, \`action\`),
        KEY \`IDX_audit_logs_entity\` (\`restaurant_id\`, \`entity_type\`, \`entity_id\`),
        CONSTRAINT \`FK_audit_logs_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`idempotency_keys\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`scope\` VARCHAR(32) NOT NULL,
        \`key\` VARCHAR(128) NOT NULL,
        \`request_hash\` VARCHAR(64) NOT NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS',
        \`response_status\` SMALLINT UNSIGNED NULL,
        \`response_body\` JSON NULL,
        \`resource_type\` VARCHAR(32) NULL,
        \`resource_id\` INT UNSIGNED NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`completed_at\` DATETIME(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_idempotency_restaurant_scope_key\` (\`restaurant_id\`, \`scope\`, \`key\`),
        KEY \`IDX_idempotency_created\` (\`created_at\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `idempotency_keys`');
    await queryRunner.query('DROP TABLE `audit_logs`');
  }
}
