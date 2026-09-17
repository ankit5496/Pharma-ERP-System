import { BadRequestException, type ValidationPipeOptions } from '@nestjs/common';

import { toFieldMessages, toReadableMessages } from './validation-message';

/**
 * Options for the global ValidationPipe.
 *
 * Extracted from main.ts so they can be asserted in a test. main.ts calls
 * bootstrap() at module scope, so importing it to read these would start the
 * application.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  // Strip properties with no matching DTO decorator...
  whitelist: true,
  // ...and reject outright when the client sent unknown ones, rather than
  // silently dropping them. A typo'd field name is a bug worth surfacing.
  forbidNonWhitelisted: true,
  // Turn plain JSON into DTO instances so @Type/@Transform run and path/query
  // params arrive as numbers and dates, not strings.
  transform: true,
  transformOptions: { enableImplicitConversion: false },

  /**
   * Messages are kept in production, deliberately.
   *
   * This was previously `disableErrorMessages: nodeEnv === 'production'`, on the
   * reasoning that constraint metadata should not leak. The effect was that
   * every rejected form in the deployed app showed one word — "Bad Request" —
   * with no indication of what was wrong. A user who typed
   * "kamal12@gmail.com." (one trailing dot) got a sign-in page that refused
   * them and explained nothing, while the DTO's own message,
   * "Enter a valid email address", was discarded on the way out.
   *
   * The messages on these DTOs are author-written, user-facing copy, not
   * internals. The genuinely sensitive part of a validation error is the
   * submitted VALUE — a rejected password would otherwise be echoed back — and
   * `validationError` below suppresses that independently of this flag. So
   * turning messages off bought nothing and cost every error message in the
   * product.
   */
  disableErrorMessages: false,

  /**
   * Never echo the submitted value or the DTO instance. This is the setting
   * that actually protects anything: `value: false` keeps a rejected password
   * out of the response body and the logs, and `target: false` keeps the DTO
   * shape out of it.
   */
  validationError: { target: false, value: false },

  /**
   * Rewrites the property names class-validator puts at the front of its
   * default messages into the labels the forms use.
   *
   * Without this, a rejected form shows "hsnCode should not be empty. gstRate
   * must be a number string." beside author-written sentences that begin with a
   * capital — reported by QA as field names starting with a mix of capital and
   * small letters, on every form, because this pipe is global.
   *
   * Here rather than in each DTO for the same reason the bug was everywhere:
   * one pipe produces every validation message in the product. See
   * ./validation-message for what it does and does not touch.
   */
  /**
   * Both shapes on one body.
   *
   * `message` is the array Nest already returned and every existing caller
   * reads — unchanged, so nothing that consumed it has to be touched.
   * `fields` is the same failures keyed by DTO property, which is what lets a
   * form mark the offending control rather than printing a paragraph above it.
   *
   * A client that knows nothing about `fields` simply ignores it.
   */
  exceptionFactory: (errors) =>
    new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: toReadableMessages(errors),
      fields: toFieldMessages(errors),
    }),
};
