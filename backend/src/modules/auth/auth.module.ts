import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { AppConfig } from 'src/config/configuration';
import { RestaurantsModule } from 'src/modules/restaurants/restaurants.module';
import { UsersModule } from 'src/modules/users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    RestaurantsModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwt = configService.get<AppConfig['jwt']>('jwt')!;

        return {
          secret: jwt.secret,
          signOptions: {
            // `expiresIn` is a template-literal union in @types/jsonwebtoken;
            // ours comes from the environment, so it is narrowed here.
            expiresIn: jwt.expiresIn as JwtSignOptions['expiresIn'],
            issuer: 'plateo',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
