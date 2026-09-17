import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Documents the bearer-token requirement and the two auth failure shapes on a
 * controller, so every protected endpoint reads consistently in Swagger.
 */
export const ApiAuth = () =>
  applyDecorators(
    ApiBearerAuth('access-token'),
    ApiUnauthorizedResponse({
      description: 'Missing, expired or invalid access token.',
      type: ErrorResponseDto,
    }),
    ApiForbiddenResponse({
      description: 'Authenticated, but the role is not allowed to perform this action.',
      type: ErrorResponseDto,
    }),
  );
