import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Refusals that name the field they are about.
 *
 * WHY THIS EXISTS. The ValidationPipe already tells a form which control
 * failed, because class-validator reports the DTO property alongside each
 * constraint. Everything a SERVICE refuses — a duplicate code, a DPCO flag
 * with no price, a pack variant already specified — carries no such link, so
 * those messages could only ever be printed above the whole form while the
 * control they are about sat there looking fine.
 *
 * These build the same body shape the pipe produces, so one client rule covers
 * both: `fields` marks the control, `message` is the sentence.
 *
 * Use them only where the message really is about ONE field a form shows. A
 * refusal about the state of a document — "material has already been issued
 * against this order" — belongs above the form, because there is no control to
 * point at and pretending otherwise puts a red ring around something the
 * person cannot fix.
 */

/** The property name as the DTO spells it, so the form can match it. */
type Field = string;

function body(field: Field, message: string, statusCode: number, error: string) {
  return {
    statusCode,
    error,
    // An array, matching the ValidationPipe: a client that reads `message`
    // without knowing about `fields` sees exactly what it saw before.
    message: [message],
    fields: [{ field, message }],
  };
}

/** 409 — the value is well-formed but collides with a record that exists. */
export function fieldConflict(field: Field, message: string): ConflictException {
  return new ConflictException(body(field, message, 409, 'Conflict'));
}

/** 400 — the value itself cannot be accepted. */
export function fieldBadRequest(field: Field, message: string): BadRequestException {
  return new BadRequestException(body(field, message, 400, 'Bad Request'));
}
