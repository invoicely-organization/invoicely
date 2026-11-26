import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // ADR-002 "8. Конвенции на API": every route is under /api/v1; only the health check is outside it.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // CORS allows only the web origin; on staging render.yaml gives it in WEB_ORIGIN, locally it is Vite of `pnpm dev`.
  app.enableCors({ origin: [process.env['WEB_ORIGIN'] ?? 'http://localhost:5173'] });
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
}

void bootstrap();
