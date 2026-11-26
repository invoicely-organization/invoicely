import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // ADR-002 "8. Конвенции на API": every route is under /api/v1; only the health check is outside it.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
}

void bootstrap();
