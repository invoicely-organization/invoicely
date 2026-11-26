import { Controller, Get } from '@nestjs/common';

// Liveness for local runs and the host: GET /health answers 200 while the process is up. Outside /api/v1 on purpose.
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
