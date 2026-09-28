import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createApiApp } from './bootstrap';
import type { EnvironmentVariables } from './config/env.validation';

/**
 * Standalone entrypoint — used for local dev and for any deployment that
 * still runs the API as its own service. The merged production deployment
 * (apps/server) uses `createApiApp` directly instead and never imports this
 * file.
 */
async function bootstrap(): Promise<void> {
  // NOT bufferLogs: true. Buffering holds every log until the application
  // finishes initialising, so a crash during init — a database that will not
  // connect, a failing onModuleInit — discards the buffer and the process dies
  // with no output at all. That is the single worst thing a deploy log can do.
  // Buffering only pays off when a custom logger is attached later, which this
  // app does not do.
  const app = await createApiApp();
  const logger = new Logger('Bootstrap');

  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const port = config.get('API_PORT', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  // Bind 0.0.0.0 explicitly rather than relying on the default. A container
  // platform routes traffic to the container's own address, so a server bound
  // only to loopback is unreachable and the host reports "no open ports
  // detected" without any error from the process itself.
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on port ${port} (${nodeEnv})`);
  logger.log(`Health check: /health`);
}

void bootstrap().catch((error: unknown) => {
  // Env validation and the initial database connection both throw here. Exit
  // non-zero and loudly: a process that starts up misconfigured is worse than
  // one that refuses to start.
  // eslint-disable-next-line no-console -- the Nest logger may not exist yet
  console.error('Failed to start API:', error);

  // NOT process.exit(1): that terminates immediately and can truncate the write
  // above before stdout flushes, which on a hosted platform shows up as a
  // process that died with no explanation. Setting exitCode lets the runtime
  // drain its streams and exit on its own; the unref'd timer is the backstop
  // for a handle that would otherwise keep the process alive forever.
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 3_000).unref();
});
