/**
 * Resets a platform operator's password, and clears any lockout.
 *
 * The recovery path for the one account that has none. A Super User cannot
 * reset their own password from the console (that needs the current one), there
 * is no email reset by design, and `create-super-user` refuses an address that
 * already exists — so without this script an operator who loses their password
 * is locked out of the platform permanently.
 *
 * Run it:
 *   pnpm reset-super-user --email ops@yourcompany.com [--password "..."]
 *   pnpm reset-super-user --email ops@yourcompany.com --unlock-only
 *
 * With no --password, a strong one is generated and printed once.
 *
 * --unlock-only clears the lockout and leaves the password alone. Use it when
 * you still have the password but the account is locked: the lockout counter is
 * only reset by a *successful* sign-in, so an expired lockout still leaves
 * failedLoginAttempts at the threshold and the next wrong attempt re-locks
 * immediately.
 *
 * Connects on MIGRATION_DATABASE_URL: `platform_users` is REVOKEd from the
 * runtime role entirely, so only the table owner can write it.
 */
import { randomBytes } from 'node:crypto';

import { Algorithm, hash } from '@node-rs/argon2';
import { createProvisioningClient } from '@pharma-erp/database';

// Must match apps/api/src/auth/password.service.ts, so a CLI-set password costs
// the same to verify as an application-set one.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// Mirrors PASSWORD_MIN_LENGTH in @pharma-erp/types. Hardcoded rather than
// imported for the same reason create-super-user.mjs does it: this script must
// run from a bare checkout, before the TypeScript packages are built.
const PASSWORD_MIN_LENGTH = 12;

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** Unambiguous alphabet: no I/l/1/O/0, because this gets read aloud or retyped. */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(64);
  let out = '';

  for (const byte of bytes) {
    if (out.length === 20) break;
    // Rejection sampling: a plain modulo would bias toward the alphabet's start.
    if (byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
  }

  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  Reset a platform operator's password and clear any lockout.

    --email        Sign-in address                              (required)
    --password     New password; generated if omitted
    --unlock-only  Clear the lockout only; leave the password unchanged
    --no-change    Do not require a password change on next sign-in
`);
  process.exit(0);
}

const { MIGRATION_DATABASE_URL } = process.env;

if (!MIGRATION_DATABASE_URL) {
  fail(
    'MIGRATION_DATABASE_URL is not set.\n  Run this via `pnpm reset-super-user` from the repo root so the root .env is loaded.',
  );
}

const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';

if (!email) fail('--email is required. Use --help for usage.');

const unlockOnly = args['unlock-only'] === true;

if (unlockOnly && typeof args.password === 'string') {
  fail('--unlock-only and --password contradict each other. Pick one.');
}

const generated = !unlockOnly && typeof args.password !== 'string';
const password = unlockOnly ? null : generated ? generatePassword() : args.password;

if (password !== null && password.length < PASSWORD_MIN_LENGTH) {
  fail(`--password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
}

const prisma = createProvisioningClient(MIGRATION_DATABASE_URL);

// Tracked so the summary can distinguish "reset succeeded, audit write failed"
// from "nothing happened" — see the catch below.
let operator = null;

try {
  // Looked up first so a wrong address fails before anything is written, and so
  // the summary can report what the lockout actually was.
  operator = await prisma.platformUser.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      status: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  if (!operator) {
    fail(
      `No platform user with the address "${email}".\n` +
        '  Check the spelling, or run `pnpm create-super-user` if the account was never created.',
    );
  }

  const wasLocked = operator.lockedUntil !== null && operator.lockedUntil.getTime() > Date.now();

  // Always cleared, whether or not the password changes: an operator who has to
  // wait out a lockout after an admin reset has not really been unlocked.
  const data = { failedLoginAttempts: 0, lockedUntil: null };

  if (!unlockOnly) {
    data.passwordHash = await hash(password, ARGON2_OPTIONS);
    data.passwordSetAt = new Date();
    // Whoever ran this script knows the password, so it is a shared secret until
    // the operator replaces it. --no-change opts out when they set it themselves.
    data.mustChangePassword = args['no-change'] !== true;
  }

  await prisma.platformUser.update({ where: { id: operator.id }, data });

  await prisma.platformAuditLog.create({
    data: {
      // Null actor: the CLI has no session. Honest attribution beats inventing
      // one in what is meant to be an audit record.
      platformUserId: null,
      action: unlockOnly ? 'PLATFORM_USER_UNLOCKED_VIA_CLI' : 'PLATFORM_PASSWORD_RESET_VIA_CLI',
      entityType: 'PlatformUser',
      entityId: operator.id,
      // Never the password or the hash.
      detailsJson: {
        email: operator.email,
        wasLocked,
        clearedFailedAttempts: operator.failedLoginAttempts,
      },
    },
  });

  const line = '-'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  ${unlockOnly ? 'Account unlocked' : 'Password reset'}: ${operator.fullName}`);
  console.log(line);
  console.log(`  Email    : ${operator.email}`);
  if (!unlockOnly) console.log(`  Password : ${password}`);
  console.log(`  Status   : ${operator.status}`);
  console.log(`  Lockout  : ${wasLocked ? 'was locked, now cleared' : 'was not locked'}`);
  console.log(
    `  Attempts : ${operator.failedLoginAttempts} -> 0${
      operator.failedLoginAttempts >= 5
        ? '  (was at the lockout threshold; one wrong password would have re-locked it)'
        : ''
    }`,
  );
  console.log(line);

  if (generated) {
    console.log('\n  This password is shown once and is not stored in readable form.');
  }

  if (operator.status === 'DISABLED') {
    console.log(
      '\n  WARNING: this account is DISABLED, so sign-in will still be refused even with\n' +
        '  the new password. Re-enable it before trying.',
    );
  }

  console.log('\n  Sign in at /platform/login.\n');
} catch (error) {
  // The update and the audit write are separate statements, so an error here
  // does not by itself mean the reset was rolled back. Saying "failed" without
  // that caveat is what sends someone off to re-run a script that already
  // worked.
  console.error(
    `\n  Failed while ${operator ? 'resetting' : 'looking up'} the platform user:\n`,
    error,
  );

  if (operator) {
    console.error(
      '\n  The password may already have been changed. Re-run with --unlock-only to\n' +
        '  check the account state before assuming nothing happened.\n',
    );
  }

  process.exit(1);
} finally {
  await prisma.$disconnect();
}
