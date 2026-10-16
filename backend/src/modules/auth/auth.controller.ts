import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { CredentialThrottle } from 'src/common/throttling';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-request.interface';
import { AuthService } from './auth.service';
import { AuthResponseDto, PlatformAuthResponseDto, LogoutResponseDto, MeResponseDto } from './dto/auth-response.dto';
import { KitchenSessionDto, KitchenSessionResponseDto } from './dto/kitchen-session.dto';
import { LoginDto, StaffLoginDto } from './dto/login.dto';
import { SwitchRestaurantDto } from './dto/switch-restaurant.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * There is no public registration.
   *
   * A restaurant comes to exist on Plateo when somebody at Plateo opens the
   * account - see `POST /platform/restaurants`. That makes the tenant list the
   * customer list rather than whoever found a sign-up form, and it stops a
   * stranger taking a restaurant's name or public slug by registering first.
   */
  /**
   * A captain signing in from their own phone, with a code instead of an email.
   *
   * Same throttle as every other credential route. Codes are short, which makes
   * them pleasant to type at a table and cheap to guess at, so the limiter is
   * doing more work here than it does on an email login.
   */
  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @CredentialThrottle()
  @ApiOperation({
    summary: 'Sign in as floor staff',
    description:
      'For the captain app. Returns the same token a restaurant login does, scoped to the one ' +
      'restaurant the captain belongs to, so every order they punch is recorded against them.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.', type: ErrorResponseDto })
  staffLogin(@Body() dto: StaffLoginDto): Promise<AuthResponseDto> {
    return this.authService.staffLogin(dto);
  }

  @Public()
  @Post('platform/login')
  @HttpCode(HttpStatus.OK)
  @CredentialThrottle()
  @ApiOperation({
    summary: 'Sign in as a Plateo administrator',
    description:
      'Issues a token scoped to the platform rather than to a restaurant. Its own endpoint ' +
      'because the invariants are opposite: a restaurant login must end up scoped to exactly ' +
      'one tenant, and this one to none.',
  })
  @ApiOkResponse({ type: PlatformAuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.', type: ErrorResponseDto })
  platformLogin(@Body() dto: LoginDto): Promise<PlatformAuthResponseDto> {
    return this.authService.platformLogin(dto);
  }

  @Public()
  @Post('kitchen')
  @HttpCode(HttpStatus.OK)
  @CredentialThrottle()
  @ApiOperation({
    summary: 'Sign a kitchen screen in with a kitchen code',
    description:
      'The kitchen board has no accounts: a screen signs in with the restaurant kitchen code, which ' +
      'the owner reads from Settings. The token it returns reaches the kitchen board and nothing ' +
      'else - no bills, no menu, no takings - so a code on a sticker cannot expose the business. ' +
      'Rate limited per IP like any other credential, and regenerating the code in the admin app ' +
      'retires every screen using the old one.',
  })
  @ApiOkResponse({ type: KitchenSessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unknown kitchen code.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.', type: ErrorResponseDto })
  kitchenSession(@Body() dto: KitchenSessionDto): Promise<KitchenSessionResponseDto> {
    return this.authService.kitchenSession(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @CredentialThrottle()
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Rate limited per IP (LOGIN_THROTTLE_LIMIT per LOGIN_THROTTLE_TTL, default 5/min). When the account belongs to several ' +
      'restaurants, pass `restaurantId` to choose one - the server rejects ids the user is ' +
      'not a member of.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.', type: ErrorResponseDto })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  @ApiAuth()
  @ApiOperation({ summary: 'Get the authenticated user and their restaurant context' })
  @ApiOkResponse({ type: MeResponseDto })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.authService.getProfile(user);
  }

  @Post('switch-restaurant')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Re-issue a token scoped to another of the user restaurants',
    description: 'Membership is re-verified server-side before the new token is signed.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  switchRestaurant(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchRestaurantDto,
  ): Promise<AuthResponseDto> {
    return this.authService.switchRestaurant(user, dto.restaurantId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Log out',
    description:
      'Plateo issues stateless JWT access tokens and keeps no server-side session table, so ' +
      'there is nothing to destroy here: a token stays cryptographically valid until it expires ' +
      '(JWT_EXPIRES_IN, 1 day by default). This endpoint therefore acknowledges the logout and ' +
      'the client is responsible for discarding the token - the Plateo admin UI removes it from ' +
      'storage and clears the in-memory query cache. Genuine server-side revocation needs either ' +
      'a denylist of token ids checked on every request, or short-lived access tokens paired ' +
      'with revocable refresh tokens; both are planned alongside the customer ordering flow.',
  })
  @ApiOkResponse({ type: LogoutResponseDto })
  logout(): LogoutResponseDto {
    return {
      success: true,
      message:
        'Discard the access token on the client. It remains valid until it expires; see the ' +
        'endpoint description for the revocation roadmap.',
    };
  }
}
