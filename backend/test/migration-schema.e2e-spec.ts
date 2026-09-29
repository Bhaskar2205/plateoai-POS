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

    const addPattern = /ALTER TABLE `(\w+)` ADD `(\w+)` ([A-Z]+)(?:\([\d,]+\))?([^'"`]*)/g;
    for (const match of up.matchAll(addPattern)) {
      const [, table, column, type, rest] = match;
      tables.get(table)?.set(column, {
        type: type.toUpperCase(),
        nullable: !/\bNOT NULL\b/i.test(rest),
      });
    }

    // MODIFY runs after ADD in a migration's up(), e.g. add nullable -> backfill -> NOT NULL.
    const modifyPattern = /ALTER TABLE `(\w+)` MODIFY `(\w+)` ([A-Z]+)(?:\([\d,]+\))?([^'"`]*)/g;
    for (const match of up.matchAll(modifyPattern)) {
      const [, table, column, type, rest] = match;
      tables.get(table)?.set(column, {
        type: type.toUpperCase(),
        nullable: !/\bNOT NULL\b/i.test(rest),
      });
    }

    for (const match of up.matchAll(/ALTER TABLE `(\w+)` DROP COLUMN `(\w+)`/g)) {
      tables.get(match[1])?.delete(match[2]);
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

  it('creates the seven Week 1 tables plus tables, orders and kitchen tickets', () => {
    expect([...migrationTables.keys()].sort()).toEqual([
      'categories',
      'dish_ingredients',
      'dishes',
      'ingredients',
      'kot_tickets',
      'order_items',
      'orders',
      'restaurant_tables',
      'restaurant_users',
      'restaurants',
      'users',
    ]);
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
