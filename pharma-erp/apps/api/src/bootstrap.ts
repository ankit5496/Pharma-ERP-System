// Must be the first import: NestJS's DI reads the decorator metadata this shim
// installs, and anything imported before it would be missing that metadata.
import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import type { EnvironmentVariables } from './config/env.validation';
import { VALIDATION_PIPE_OPTIONS } from './config/validation-pipe.options';

/**
 * Configures the Nest application without binding a port. Split out of
 * `main.ts` so a merged deployment (apps/server) can mount this app's HTTP
 * adapter alongside another server instead of calling `.listen()` itself.
 */
export async function createApiApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  app.enableCors({
    origin: config
      .get('WEB_ORIGIN', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
    // x-tenant-id is the development-only tenant hint; x-request-id lets the web
    // app correlate a browser action with the API's logs and audit rows.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });

  // Versioned from day one: retrofitting a prefix once clients exist is painful.
  // /health is excluded so orchestrators and probes have a stable, unversioned
  // URL that never moves.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });

  // Run onModuleDestroy / onApplicationShutdown on SIGTERM, so Prisma closes
  // its pool instead of leaving connections for Postgres to time out.
  app.enableShutdownHooks();

  return app;
}
