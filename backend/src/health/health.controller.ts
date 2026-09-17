import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'plateo-backend', timestamp: '2026-01-01T12:00:00.000Z' },
    },
  })
  check() {
    return {
      status: 'ok',
      service: 'plateo-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
