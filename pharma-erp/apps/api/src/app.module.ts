import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditModule } from './common/audit/audit.module';
import { validateEnv } from './config/env.validation';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { PartiesModule } from './parties/parties.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProcurementModule } from './procurement/procurement.module';
import { ProductionModule } from './production/production.module';
import { RequestContextMiddleware } from './tenant/request-context.middleware';
import { TenantModule } from './tenant/tenant.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // One env file for the whole monorepo, at the repo root. `validate` runs
      // before any provider is constructed, so a missing variable stops the
      // boot instead of surfacing as a runtime failure later.
      envFilePath: ['../../.env.local', '../../.env'],
      validate: validateEnv,
    }),
    TenantModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    UsersModule,
    DashboardModule,
    PlatformModule,
    ProcurementModule,
    PartiesModule,
    ProductionModule,
  ],
  providers: [
    {
      // Authentication is the default. A new controller is protected the moment
      // it is written; exposing one requires an explicit @Public('reason').
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // Registered after JwtAuthGuard so the request context already carries a
      // resolved role by the time this runs — Nest executes global guards in
      // registration order.
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      // Auditing is the default too: every mutating request is recorded unless
      // the handler carries @SkipAudit('reason'). Opt-out, never opt-in.
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including /health: the correlation id is useful there too,
    // and the middleware makes no authentication decisions of its own.
    //
    // '{*splat}' rather than '*': NestJS 11 runs on Express 5 / path-to-regexp
    // v8, where wildcards must be named. The braces make it match zero-or-more
    // segments, so '/' is covered too.
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
  }
}
