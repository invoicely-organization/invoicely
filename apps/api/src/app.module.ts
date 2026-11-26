import { Module } from '@nestjs/common';
import { HealthModule } from './common/health/health.module.js';

// The root module. Feature modules (src/modules, ADR-011) are added here as tasks need them.
@Module({ imports: [HealthModule] })
export class AppModule {}
