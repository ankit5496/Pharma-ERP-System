/**
 * Creates a platform operator — a Super User.
 *
 * This is the bootstrap: the first Super User cannot be created from the console
 * because signing in to the console requires already being one. After that,
 * companies are created from the web console rather than the CLI.
 *
 * Run it:
 *   pnpm create-super-user --email ops@yourcompany.com --name "Your Name" [--password "..."]
 *
 * With no --password, a strong one is generated and printed once.
 *
 * Connects on MIGRATION_DATABASE_URL: `platform_users` is REVOKEd from the
 * runtime role entirely, so only the table owner can write it.
 */
import { randomBytes } from 'node:crypto';

import { Algorithm, hash } from '@node-rs/argon2';
import { createProvisioningClient } from '@pharma-erp/database';

// Must match apps/api/src/auth/password.service.ts, so a CLI-created password
// costs the same to verify as an application-created one.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

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
  Create a platform operator (Super User).

    --email     Sign-in address                     (required)
    --name      Full name                           (required)
    --password  Password; generated if omitted
`);
  process.exit(0);
}

const { MIGRATION_DATABASE_URL } = process.env;

if (!MIGRATION_DATABASE_URL) {
  fail(
    'MIGRATION_DATABASE_URL is not set.\n  Run this via `pnpm create-super-user` from the repo root so the root .env is loaded.',
  );
}

const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
const fullName = typeof args.name === 'string' ? args.name.trim() : '';

if (!email) fail('--email is required. Use --help for usage.');
if (!fullName) fail('--name is required.');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail(`--email does not look like an email address: ${email}`);
}

const generated = typeof args.password !== 'string';
const password = generated ? generatePassword() : args.password;

if (password.length < PASSWORD_MIN_LENGTH) {
  fail(`--password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
}

const prisma = createProvisioningClient(MIGRATION_DATABASE_URL);

try {
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const operator = await prisma.platformUser.create({
    data: {
      email,
      fullName,
      status: 'ACTIVE',
      passwordHash,
      passwordSetAt: new Date(),
      // Whoever ran this script knows the password, so it is a shared secret
      // until the operator replaces it on first sign-in.
      mustChangePassword: true,
    },
    select: { id: true, email: true, fullName: true },
  });

  await prisma.platformAuditLog.create({
    data: {
      // Null actor: the CLI has no session. Honest attribution beats inventing
      // one in what is meant to be an audit record.
      platformUserId: null,
      action: 'PLATFORM_USER_CREATED_VIA_CLI',
      entityType: 'PlatformUser',
      entityId: operator.id,
      detailsJson: { email: operator.email, fullName: operator.fullName },
    },
  });

  const line = '-'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  Super User created: ${operator.fullName}`);
  console.log(`${line}`);
  console.log(`  Email    : ${operator.email}`);
  console.log(`  Password : ${password}`);
  console.log(`${line}`);

  if (generated) {
    console.log('\n  This password is shown once and is not stored in readable form.');
  }

  console.log(`
  Sign in at /platform/login. You will be asked to set your own password
  before you can do anything else, and can then create companies.
`);
} catch (error) {
  if (error?.code === 'P2002') {
    fail(`A platform user with the address "${email}" already exists.`);
  }

  console.error('\n  Failed to create the platform user:\n', error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
