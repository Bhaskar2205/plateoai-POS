import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from 'src/config/configuration';
import { entities } from './data-source';
import { mysqlSslConnectionOptions } from './mysql-ssl';
import { mysqlUtcConnectionOptions } from './mysql-utc';

/**
 * Wires TypeORM to MySQL using the validated application config.
 *
 * `synchronize` stays off by default: schema changes go through the migrations
 * in `src/database/migrations`, which are the same files the CLI runs.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const database = configService.get<AppConfig['database']>('database')!;

        return {
          type: 'mysql' as const,
          host: database.host,
          port: database.port,
          username: database.username,
          password: database.password,
          database: database.name,
          entities,
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          migrationsTableName: 'plateo_migrations',
          migrationsRun: false,
          synchronize: database.synchronize,
          logging: database.logging,
          charset: 'utf8mb4',
          // The driver default of 10 queues a burst of QR scans behind each
          // other, since one menu read is several queries.
          poolSize: database.poolSize,
          // UTC on the wire *and* in the MySQL session - see mysql-utc.ts.
          ...mysqlUtcConnectionOptions,
          // TLS for managed MySQL - see mysql-ssl.ts.
          ...mysqlSslConnectionOptions(database.ssl),
          autoLoadEntities: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
