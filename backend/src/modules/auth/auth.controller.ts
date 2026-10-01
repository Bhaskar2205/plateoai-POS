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
import { AuthResponseDto, LogoutResponseDto, MeResponseDto } from './dto/auth-response.dto';
import { KitchenSessionDto, KitchenSessionResponseDto } from './dto/kitchen-session.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SwitchRestaurantDto } from './dto/switch-restaurant.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @CredentialThrottle()
  @ApiOperation({
    summary: 'Register a restaurant owner and their restaurant',
    description:
      'Creates the restaurant, the owner account and the membership linking them inside a single ' +
      'database transaction, then returns a ready-to-use access token.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'Email already registered.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.', type: ErrorResponseDto })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
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
