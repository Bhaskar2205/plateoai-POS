import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { entities } from 'src/database/data-source';

/**
 * Guards the hand-written MySQL migration against the entities.
 *
 * `migration:generate` normally does this comparison for you, but it needs a
 * live MySQL server to diff against. This spec does the equivalent offline:
 * it builds the entity metadata for the MySQL driver (no connection required)
 * and checks every column, type and nullability against the DDL in the
 * migration - so a column added to an entity and forgotten in the migration
 * fails CI instead of surfacing as a runtime error in production.
 *
 * It does not replace running `npm run migration:run` against a real MySQL 8;
 * it catches the drift that causes most migration bugs.
 */

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'database', 'migrations');

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'src',
  'database',
  'migrations',
  '1757980800000-InitSchema.ts',
);

/**
 * The migration writes its DDL inside template literals, so every backtick in
 * the file is escaped as a backslash-backtick. Normalise to plain SQL first.
 */
function readMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8').replaceAll('\\`', '`');
}

interface ParsedColumn {
  type: string;
  nullable: boolean;
}

/** Extracts `CREATE TABLE` bodies from the migration into column maps. */
function parseMigration(sql: string): Map<string, Map<string, ParsedColumn>> {
  const tables = new Map<string, Map<string, ParsedColumn>>();
  const tablePattern = /CREATE TABLE `(\w+)` \(([\s\S]*?)\n\s*\) ENGINE=InnoDB/g;

  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tablePattern.exec(sql)) !== null) {
    const [, tableName, body] = tableMatch;
    const columns = new Map<string, ParsedColumn>();

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');

      // Skip index and key declarations - only column definitions here.
      if (/^(PRIMARY KEY|UNIQUE INDEX|INDEX|KEY|CONSTRAINT)/i.test(line)) continue;

      const columnMatch = /^`(\w+)`\s+([A-Z]+)(?:\([\d,]+\))?(.*)$/.exec(line);
      if (!columnMatch) continue;

      const [, name, type, rest] = columnMatch;
      columns.set(name, {
        type: type.toUpperCase(),
        nullable: !/\bNOT NULL\b/i.test(rest),
      });
    }

    tables.set(tableName, columns);
  }

  return tables;
}

/**
 * The schema the migrations produce, replaying every migration's `up()` in
 * timestamp order: CREATE TABLE from any file, then ADD / DROP COLUMN from later
 * ones. Without this, a column added by a follow-up migration would be reported
 * as missing.
 */
function parseAllMigrations(): Map<string, Map<string, ParsedColumn>> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+-.+\.ts$/.test(file))
    .sort();

  const tables = new Map<string, Map<string, ParsedColumn>>();

  for (const file of files) {
    const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replaceAll('\\`', '`');
    const up = source.split('public async down')[0];

    for (const [name, columns] of parseMigration(up)) {
      tables.set(name, columns);
    }

    // One statement at a time. An ALTER TABLE may carry several comma-separated
    // clauses, and scanning the whole file for clause patterns would attribute a
    // clause to whichever table was named last rather than to its own statement.
    for (const chunk of up.split('queryRunner.query(').slice(1)) {
      const altered = /ALTER TABLE `(\w+)`/.exec(chunk);
      if (!altered) continue;

      const table = altered[1];

      // `ADD COLUMN x` and `ADD x` are both legal, and both appear in this project.
      const addPattern = /\bADD (?:COLUMN )?`(\w+)` ([A-Z]+)(?:\([\d,]+\))?([^,\r\n]*)/g;
      for (const [, column, type, rest] of chunk.matchAll(addPattern)) {
        tables.get(table)?.set(column, {
          type: type.toUpperCase(),
          nullable: !/\bNOT NULL\b/i.test(rest),
        });
      }

      // MODIFY runs after ADD in a migration's up(), e.g. add nullable -> backfill
      // -> NOT NULL.
      const modifyPattern = /\bMODIFY (?:COLUMN )?`(\w+)` ([A-Z]+)(?:\([\d,]+\))?([^,\r\n]*)/g;
      for (const [, column, type, rest] of chunk.matchAll(modifyPattern)) {
        tables.get(table)?.set(column, {
          type: type.toUpperCase(),
          nullable: !/\bNOT NULL\b/i.test(rest),
        });
      }

      for (const [, column] of chunk.matchAll(/\bDROP COLUMN `(\w+)`/g)) {
        tables.get(table)?.delete(column);
      }
    }
  }

  return tables;
}

/** TypeORM metadata type -> the MySQL keyword the migration should use. */
const TYPE_MAP: Record<string, string> = {
  int: 'INT',
  varchar: 'VARCHAR',
  text: 'TEXT',
  decimal: 'DECIMAL',
  boolean: 'TINYINT',
  datetime: 'DATETIME',
  date: 'DATE',
  smallint: 'SMALLINT',
  bigint: 'BIGINT',
};

describe('InitSchema migration matches the entities', () => {
  let migrationTables: Map<string, Map<string, ParsedColumn>>;
  let dataSource: DataSource;

  beforeAll(async () => {
    migrationTables = parseAllMigrations();

    // Metadata only - never connects, so this runs without a MySQL server.
    dataSource = new DataSource({
      type: 'mysql',
      host: 'localhost',
      database: 'plateo',
      entities,
    });
    await (dataSource as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
  });

  it('creates the seven Week 1 tables plus tables, orders, kitchen tickets and tax', () => {
    expect([...migrationTables.keys()].sort()).toEqual([
      'audit_logs',
      'categories',
      'dish_ingredients',
      'dishes',
      'idempotency_keys',
      'ingredients',
      'inventory_movements',
      'kot_tickets',
      'order_charges',
      'order_items',
      'orders',
      'payment_intents',
      'payment_reconciliation_exceptions',
      'payment_webhook_events',
      'restaurant_tables',
      'restaurant_tax_components',
      'restaurant_users',
      'restaurants',
      'users',
    ]);
  });

  /**
   * The tax migration has to be safe on a database that is already billing: it
   * adds, never rewrites, and an existing flat rate has to survive as components
   * that charge the same total.
   */
  it('adds tax components additively and keeps an existing flat rate charging the same', () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, '1759276800000-AddTaxComponentsAndCharges.ts'),
      'utf8',
    );
    const up = sql.split('public async down')[0];
    const down = sql.split('public async down')[1];

    // Nothing existing is dropped or rewritten on the way up.
    expect(up).not.toMatch(/DROP TABLE/);
    expect(up).not.toMatch(/DROP COLUMN/);
    // The old single rate stays where it is, so bills keep working during a deploy.
    expect(up).not.toMatch(/`restaurants`[\s\S]*?DROP/);

    // Lines and dishes both carry a tax group, defaulting to ordinary food.
    expect(up).toMatch(/ALTER TABLE `dishes` ADD `tax_group` VARCHAR\(16\) NOT NULL DEFAULT 'STANDARD'/);
    expect(up).toMatch(/ALTER TABLE `order_items` ADD `tax_group` VARCHAR\(16\) NOT NULL DEFAULT 'STANDARD'/);

    // Existing bills owe what they owed.
    expect(up).toMatch(/UPDATE `orders` SET `amount_payable` = `total`/);

    // A flat rate becomes two components that add back to it.
    expect(up).toMatch(/SELECT `id`, `tax_rate` FROM `restaurants` WHERE `tax_rate` > 0/);
    expect(up).toMatch(/INSERT INTO `restaurant_tax_components`/);

    // Both new tables cascade with their parent, and the down path is complete.
    expect(up).toMatch(/FK_order_charges_order[\s\S]*?ON DELETE CASCADE/);
    expect(up).toMatch(/FK_tax_components_restaurant[\s\S]*?ON DELETE CASCADE/);
    expect(down).toMatch(/DROP TABLE `order_charges`/);
    expect(down).toMatch(/DROP TABLE `restaurant_tax_components`/);
  });

  /**
   * The idempotency table only works if the database enforces the uniqueness.
   * An application-level check would let two requests both look, both find
   * nothing, and both proceed - which is the duplicate it exists to prevent.
   */
  it('makes the database enforce one operation per idempotency key', () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, '1759363200000-AddAuditLogsAndIdempotency.ts'),
      'utf8',
      // Backticks are escaped inside the migration's template literals; strip
      // them so these assertions read as the SQL rather than as its escaping.
    ).replaceAll('\\`', '`');
    const up = sql.split('public async down')[0];
    const down = sql.split('public async down')[1];

    expect(up).toMatch(
      /UNIQUE KEY `UQ_idempotency_restaurant_scope_key` \(`restaurant_id`, `scope`, `key`\)/,
    );
    // NOT NULL with a default, because MySQL treats NULLs as distinct in a
    // unique index and would happily allow the duplicates this prevents.
    expect(up).toMatch(/`restaurant_id` INT UNSIGNED NOT NULL DEFAULT 0/);

    // Audit records are scoped and indexed for the queries the screen makes.
    expect(up).toMatch(/KEY `IDX_audit_logs_restaurant_created` \(`restaurant_id`, `created_at`\)/);
    expect(up).toMatch(/FK_audit_logs_restaurant[\s\S]*?ON DELETE CASCADE/);

    // Additive only: nothing existing is touched on the way up.
    expect(up).not.toMatch(/DROP|ALTER TABLE/);

    expect(down).toMatch(/DROP TABLE `audit_logs`/);
    expect(down).toMatch(/DROP TABLE `idempotency_keys`/);
  });

  /**
   * The payment tables carry two unique indexes that are load-bearing: one makes
   * a repeated webhook delivery collide instead of running twice, the other stops
   * a single provider payment being recorded against two intents.
   */
  it('makes the database refuse duplicate webhooks and duplicate provider payments', () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, '1759449600000-AddPaymentDomain.ts'),
      'utf8',
      // Backticks are escaped inside the migration's template literals.
    ).replaceAll('\\`', '`');
    const up = sql.split('public async down')[0];
    const down = sql.split('public async down')[1];

    expect(up).toMatch(/UNIQUE KEY `UQ_webhook_provider_event` \(`provider`, `provider_event_id`\)/);
    expect(up).toMatch(
      /UNIQUE KEY `UQ_payment_intents_provider_payment` \(`provider`, `provider_payment_id`\)/,
    );

    // Money in the smallest unit, never a float.
    expect(up).toMatch(/`amount_paise` BIGINT NOT NULL/);
    expect(up).not.toMatch(/FLOAT|DOUBLE/);

    // A deleted bill must not take its payment record with it - the money still
    // happened - so the order link is SET NULL rather than CASCADE.
    expect(up).toMatch(/FK_payment_intents_order[\s\S]*?ON DELETE SET NULL/);
    expect(up).toMatch(/FK_payment_intents_restaurant[\s\S]*?ON DELETE CASCADE/);

    // Additive: ordering and billing are untouched, so manual settlement is safe.
    expect(up).not.toMatch(/ALTER TABLE|DROP/);

    expect(down).toMatch(/DROP TABLE `payment_intents`/);
    expect(down).toMatch(/DROP TABLE `payment_webhook_events`/);
    expect(down).toMatch(/DROP TABLE `payment_reconciliation_exceptions`/);
  });

  it('scopes restaurant tables to their restaurant and keeps QR tokens unique and case-sensitive', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '1758240000000-CreateRestaurantTables.ts'), 'utf8').replaceAll(
      '\\`',
      '`',
    );

    expect(sql).toMatch(/UNIQUE INDEX `UQ_restaurant_tables_restaurant_name` \(`restaurant_id`, `name`\)/);
    expect(sql).toMatch(/UNIQUE INDEX `UQ_restaurant_tables_qr_token` \(`qr_token`\)/);
    expect(sql).toMatch(/`qr_token` VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    expect(sql).toMatch(
      /FK_restaurant_tables_restaurant`[\s\S]*?REFERENCES `restaurants`\(`id`\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/DROP TABLE `restaurant_tables`/);
  });

  it('adds a unique, backfilled public slug without touching updated_at', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '1758326400000-AddRestaurantPublicSlug.ts'), 'utf8');
    const up = sql.split('public async down')[0];
    const down = sql.split('public async down')[1];

    expect(up).toMatch(/ADD `public_slug` VARCHAR\(190\) NULL AFTER `slug`/);
    expect(up).toMatch(/UPDATE `restaurants` SET `public_slug` = `slug`, `updated_at` = `updated_at`/);
    expect(up).toMatch(/MODIFY `public_slug` VARCHAR\(190\) NOT NULL/);
    expect(up).toMatch(/CREATE UNIQUE INDEX `UQ_restaurants_public_slug` ON `restaurants` \(`public_slug`\)/);
    // Backfill before NOT NULL, NOT NULL before the unique index.
    expect(up.indexOf('UPDATE')).toBeLessThan(up.indexOf('MODIFY'));
    expect(up.indexOf('MODIFY')).toBeLessThan(up.indexOf('CREATE UNIQUE INDEX'));
    // No WHERE-less UPDATE of anything but the new column.
    expect(up.match(/UPDATE `/g)).toHaveLength(1);
    expect(down).toMatch(/DROP INDEX `UQ_restaurants_public_slug` ON `restaurants`/);
    expect(down).toMatch(/DROP COLUMN `public_slug`/);
  });

  it('keeps order history immutable, per-day numbered and tenant-scoped', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '1758758400000-CreateOrders.ts'), 'utf8').replaceAll(
      '\\`',
      '`',
    );
    const up = sql.split('public async down')[0];
    const down = sql.split('public async down')[1];
    // Foreign keys are declared across several lines; compare on one line.
    const flatUp = up.replace(/\s+/g, ' ');

    // Money is exact, never a float type.
    for (const column of [
      '`subtotal` DECIMAL(10,2)',
      '`discount_amount` DECIMAL(10,2)',
      '`tax_amount` DECIMAL(10,2)',
      '`total` DECIMAL(10,2)',
      '`unit_price` DECIMAL(10,2)',
      '`line_total` DECIMAL(10,2)',
    ]) {
      expect(up).toContain(column);
    }

    // Only the DDL itself: this migration's comment names FLOAT to say why it is unused.
    const ddl = [...up.matchAll(/CREATE TABLE[\s\S]*?ENGINE=InnoDB/g)].map((match) => match[0]).join('\n');
    expect(ddl).not.toMatch(/\b(FLOAT|DOUBLE|REAL)\b/);

    // A bill outlives the table, the dish and the staff accounts behind it.
    expect(flatUp).toContain(
      'FK_orders_table` FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON DELETE SET NULL',
    );
    expect(flatUp).toContain(
      'FK_order_items_dish` FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON DELETE SET NULL',
    );
    for (const column of ['settled_by_user_id', 'opened_by_user_id', 'created_by_user_id']) {
      expect(flatUp).toContain(
        'FOREIGN KEY (`' + column + '`) REFERENCES `users`(`id`) ON DELETE SET NULL',
      );
    }

    // Deleting a tenant still removes its orders, like every other tenant table.
    for (const fk of ['FK_orders_restaurant', 'FK_order_items_restaurant', 'FK_kot_tickets_restaurant']) {
      expect(flatUp).toContain(
        fk + '` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE',
      );
    }

    // Numbering restarts each business day, enforced by the database rather than
    // by the application, so concurrent orders cannot share a number.
    expect(up).toContain(
      'UNIQUE INDEX `UQ_orders_restaurant_date_number` (`restaurant_id`, `business_date`, `order_number`)',
    );
    expect(up).toContain(
      'UNIQUE INDEX `UQ_kot_tickets_restaurant_date_number` (`restaurant_id`, `business_date`, `ticket_number`)',
    );

    // Tax is additive and defaults to charging nothing extra.
    expect(up).toContain(
      'ALTER TABLE `restaurants` ADD `tax_rate` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `status`',
    );
    expect(up).toContain('ALTER TABLE `restaurants` ADD `tax_number` VARCHAR(32) NULL');

    // No existing row is rewritten or removed.
    expect(up).not.toMatch(/UPDATE `/);
    expect(up).not.toMatch(/DELETE FROM/);

    // down() removes exactly what up() added, children before parents.
    expect(down.indexOf('DROP TABLE `order_items`')).toBeLessThan(down.indexOf('DROP TABLE `orders`'));
    expect(down.indexOf('DROP TABLE `kot_tickets`')).toBeLessThan(down.indexOf('DROP TABLE `orders`'));
    expect(down).toContain('DROP COLUMN `tax_number`');
    expect(down).toContain('DROP COLUMN `tax_rate`');
  });

  it('defines a table for every entity', () => {
    for (const metadata of dataSource.entityMetadatas) {
      expect(migrationTables.has(metadata.tableName)).toBe(true);
    }
  });

  it('defines every entity column, with matching type and nullability', () => {
    const problems: string[] = [];

    for (const metadata of dataSource.entityMetadatas) {
      const columns = migrationTables.get(metadata.tableName);
      if (!columns) continue;

      for (const column of metadata.columns) {
        const migrationColumn = columns.get(column.databaseName);

        if (!migrationColumn) {
          problems.push(`${metadata.tableName}.${column.databaseName} is missing`);
          continue;
        }

        const expectedType = TYPE_MAP[String(column.type)];

        if (expectedType && migrationColumn.type !== expectedType) {
          problems.push(
            `${metadata.tableName}.${column.databaseName} is ${migrationColumn.type}, entity says ${expectedType}`,
          );
        }

        if (migrationColumn.nullable !== column.isNullable) {
          problems.push(
            `${metadata.tableName}.${column.databaseName} nullability differs ` +
              `(migration: ${migrationColumn.nullable}, entity: ${column.isNullable})`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('adds no columns the entities do not declare', () => {
    const problems: string[] = [];

    for (const metadata of dataSource.entityMetadatas) {
      const columns = migrationTables.get(metadata.tableName);
      if (!columns) continue;

      const entityColumns = new Set(metadata.columns.map((column) => column.databaseName));

      for (const name of columns.keys()) {
        if (!entityColumns.has(name)) {
          problems.push(`${metadata.tableName}.${name} exists only in the migration`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('uses DECIMAL for money and nutrition, never a float type', () => {
    const sql = readMigrationSql();

    expect(sql).toMatch(/`price` DECIMAL\(10,2\)/);
    expect(sql).toMatch(/`protein_grams` DECIMAL\(8,2\)/);
    expect(sql).toMatch(/`calories` DECIMAL\(8,2\)/);
    expect(sql).toMatch(/`carbs_grams` DECIMAL\(8,2\)/);
    expect(sql).toMatch(/`fat_grams` DECIMAL\(8,2\)/);
    expect(sql).toMatch(/`quantity` DECIMAL\(10,3\)/);

    // Only the DDL itself - the file's own comments mention FLOAT/DOUBLE to
    // explain why they are not used.
    const ddl = [...sql.matchAll(/CREATE TABLE[\s\S]*?ENGINE=InnoDB/g)]
      .map((match) => match[0])
      .join('\n');

    expect(ddl).not.toMatch(/\b(FLOAT|DOUBLE|REAL)\b/);
  });

  it('constrains every tenant-owned table with a restaurant foreign key', () => {
    const sql = readMigrationSql();

    for (const table of ['categories', 'ingredients', 'dishes', 'restaurant_users']) {
      expect(sql).toContain(`ALTER TABLE \`${table}\``);
    }

    expect(sql).toMatch(/FK_categories_restaurant[\s\S]*?REFERENCES `restaurants`/);
    expect(sql).toMatch(/FK_ingredients_restaurant[\s\S]*?REFERENCES `restaurants`/);
    expect(sql).toMatch(/FK_dishes_restaurant[\s\S]*?REFERENCES `restaurants`/);
  });

  it('prevents duplicate user-restaurant memberships', () => {
    const sql = readMigrationSql();

    expect(sql).toMatch(
      /UNIQUE INDEX `UQ_restaurant_users_user_restaurant` \(`user_id`, `restaurant_id`\)/,
    );
  });

  it('drops everything it creates', () => {
    const sql = readMigrationSql();
    const created = [...sql.matchAll(/CREATE TABLE `(\w+)`/g)].map((match) => match[1]);
    const dropped = [...sql.matchAll(/DROP TABLE `(\w+)`/g)].map((match) => match[1]);

    expect(dropped.sort()).toEqual(created.sort());
  });
});
