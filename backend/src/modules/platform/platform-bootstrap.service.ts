import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { hashPassword } from 'src/common/security/password';
import type { AppConfig } from 'src/config/configuration';
import { User } from 'src/modules/users/entities/user.entity';

/**
 * The first Plateo administrator.
 *
 * Removing self-registration creates a chicken and egg: restaurants are opened by
 * an administrator, and administrators are accounts in the same table. Somebody
 * has to exist before anybody can be created.
 *
 * So the first one comes from the environment, once. The rules that make that
 * safe rather than a back door:
 *
 *  - it runs **only when no administrator exists at all**, so it cannot be used
 *    to add a second one, and cannot be used to take over an existing account;
 *  - it never touches a password that is already set - a restart does not reset
 *    anybody, and leaving the variables in place does not re-apply them;
 *  - with the variables unset it does nothing and says so, which is the right
 *    behaviour for every environment that already has its administrator.
 *
 * Once the account exists, remove the variables. They are a seed, not a config.
 */
@Injectable()
export class PlatformBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PlatformBootstrapService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { email, password } = this.configService.get<AppConfig['platformAdmin']>('platformAdmin')!;

    const existing = await this.users.count({ where: { role: UserRole.SUPER_ADMIN } });

    if (existing > 0) {
      // Already have one. Nothing to do, and nothing to overwrite - saying so is
      // better than silence, because an operator who set the variables expecting
      // something to happen should learn that it did not.
      if (email || password) {
        this.logger.log(
          'A Plateo administrator already exists; the bootstrap variables were ignored. Remove them.',
        );
      }

      return;
    }

    if (!email || !password) {
      this.logger.warn(
        'No Plateo administrator exists and PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD are ' +
          'not set, so nobody can open a restaurant account. Set both and restart once.',
      );

      return;
    }

    const clash = await this.users.findOne({ where: { email } });

    if (clash) {
      // The email belongs to somebody who is not an administrator. Promoting them
      // from an environment variable would be a way to take over an account.
      this.logger.error(
        `PLATFORM_ADMIN_EMAIL is already used by a non-administrator account. ` +
          `Choose a different address; this account was left alone.`,
      );

      return;
    }

    await this.users.save(
      this.users.create({
        name: 'Plateo administrator',
        email,
        passwordHash: await hashPassword(password),
        role: UserRole.SUPER_ADMIN,
      }),
    );

    this.logger.log(
      `Created the first Plateo administrator (${email}). Remove PLATFORM_ADMIN_PASSWORD now.`,
    );
  }
}
