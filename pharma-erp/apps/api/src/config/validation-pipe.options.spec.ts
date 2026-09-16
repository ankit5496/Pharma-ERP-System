import { ValidationPipe } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';

import { VALIDATION_PIPE_OPTIONS } from './validation-pipe.options';

class SampleDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  password!: string;
}

const metadata = { type: 'body' as const, metatype: SampleDto };

interface ValidationResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
}

/**
 * Runs the pipe and returns the HTTP response body it would produce.
 *
 * Asserting on `error.message` is the wrong thing here, and quietly so: Nest
 * builds the exception with the constraint list as its *payload*, leaving
 * `message` as the plain status text "Bad Request". The payload is what reaches
 * the browser, and readErrorMessage in the web app joins its `message` array —
 * so that is what these tests check.
 */
async function responseFor(pipe: ValidationPipe, body: unknown): Promise<ValidationResponse> {
  try {
    await pipe.transform(body, metadata);
  } catch (error) {
    const candidate = error as { getResponse?: () => unknown };

    if (typeof candidate.getResponse !== 'function') throw error;

    return candidate.getResponse() as ValidationResponse;
  }

  throw new Error('expected the pipe to reject this body');
}

/** The constraint messages, however Nest chose to shape them. */
const messagesOf = (response: ValidationResponse): string[] =>
  Array.isArray(response.message) ? response.message : [response.message];

describe('VALIDATION_PIPE_OPTIONS', () => {
  it('keeps validation messages, so a rejected form can explain itself', () => {
    // The regression this guards: with disableErrorMessages on, Nest replaces
    // every constraint list with the bare status text, and the deployed app
    // answered a mistyped address with one unexplained word — "Bad Request".
    expect(VALIDATION_PIPE_OPTIONS.disableErrorMessages).toBe(false);
  });

  it('never echoes the submitted value or the DTO instance', () => {
    // This is the setting that actually protects something: without it a
    // rejected password comes back in the response body and the logs.
    expect(VALIDATION_PIPE_OPTIONS.validationError).toEqual({ target: false, value: false });
  });

  it('rejects unknown properties rather than silently dropping them', () => {
    expect(VALIDATION_PIPE_OPTIONS.whitelist).toBe(true);
    expect(VALIDATION_PIPE_OPTIONS.forbidNonWhitelisted).toBe(true);
  });

  describe('behaviour of a pipe built from them', () => {
    const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

    it('surfaces the DTO’s own message for a bad email', async () => {
      // Exactly the reported case: one trailing dot.
      const response = await responseFor(pipe, {
        email: 'kamal12@gmail.com.',
        password: 'whatever',
      });

      expect(response.statusCode).toBe(400);
      // With the terminating full stop toReadableMessages adds, so that the
      // web app can join several messages into prose rather than a run-on.
      expect(messagesOf(response)).toContain('Enter a valid email address.');
    });

    it('accepts the same address without the trailing dot', async () => {
      await expect(
        pipe.transform({ email: 'kamal12@gmail.com', password: 'whatever' }, metadata),
      ).resolves.toMatchObject({ email: 'kamal12@gmail.com' });
    });

    it('reports every failed constraint, not just the first', async () => {
      const messages = messagesOf(await responseFor(pipe, { email: 'nope', password: '' }));

      expect(messages).toContain('Enter a valid email address.');
      expect(messages).toContain('Enter your password.');
    });

    it('does not put the submitted password in the response', async () => {
      const secret = 'sup3r-secret-value';
      const response = await responseFor(pipe, { email: 'nope', password: secret });

      expect(JSON.stringify(response)).not.toContain(secret);
    });

    it('names an unknown property so a typo’d field is findable', async () => {
      const messages = messagesOf(
        await responseFor(pipe, { email: 'a@b.com', password: 'whatever', isAdmin: true }),
      );

      expect(messages.join(' ')).toMatch(/isAdmin/);
    });
  });
});
