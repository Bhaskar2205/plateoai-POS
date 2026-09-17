/**
 * End-to-end test config.
 *
 * These specs boot the full Nest application (guards, pipes, filters, TypeORM)
 * against an in-memory SQLite database so the suite runs on any machine without
 * a MySQL server. Production and migrations always target MySQL 8; entity column
 * types are deliberately kept driver-portable (see src/modules/**\/*.entity.ts).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 60000,
};
