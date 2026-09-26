# Pharma ERP

Multi-tenant SaaS ERP for pharmaceutical manufacturers — batch manufacturing, quality release, and compliance recordkeeping.

This repository currently contains **the foundation plus authentication**: the monorepo, a NestJS API, a Next.js front end with Clerk-backed sign-in / sign-up / company onboarding, role-based access control across the eight roles, and a Postgres schema of `Tenant` / `User` / `AuditLog` with Row-Level Security. There is no domain model beyond those three tables and no business logic yet.

---

## Prerequisites

| Tool           | Version     | Notes                                                                                                                              |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Node.js        | ≥ 20.11     | `node -v`                                                                                                                          |
| pnpm           | ≥ 9         | `npm install -g pnpm` — npm and yarn are not supported here (workspace protocol)                                                   |
| Docker Desktop | any current | Must be **running** before `docker compose up`. Optional — see [Running Postgres without Docker](#running-postgres-without-docker) |
| Git            | any         |                                                                                                                                    |

Verify:

```bash
node -v && pnpm -v && docker -v
```

---

## Quick start

```bash
# 1. Install dependencies for every workspace package
pnpm install

# 2. Create your environment file from the documented contract
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

# 3. Add your Clerk keys to .env — the API will not boot without them.
#    Get them from https://dashboard.clerk.com -> your app -> API keys:
#      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
#      CLERK_SECRET_KEY=sk_test_...

# 4. Start PostgreSQL 16
docker compose up -d

# 5. Apply migrations and generate the Prisma client
pnpm db:migrate

# 6. Start the API and the web app together
pnpm dev
```

Then open <http://localhost:3000> and register:

1. You are redirected to **/sign-up**. Create an account — this is your Clerk identity.
2. You land on **/onboarding**. Name your company; you become its Admin.
3. You arrive at **/dashboard**, which shows your role, what it grants, and a live `/health` read. A green **ok** badge with a database latency confirms all three pieces (web → API → Postgres) are talking.

The API's own health check stays unauthenticated at <http://localhost:4000/health>.

`pnpm --filter @pharma-erp/database db:seed` still creates a demo tenant, but you no longer need it to sign in — it is there for a tenant to test against without registering.

---

## Environment

There is **one** `.env`, at the repository root. Both apps read it:

- The API loads it through `ConfigModule` and validates it with `class-validator` at boot — a missing or malformed variable exits the process with a message naming the variable. It does not start half-configured.
- The web app validates `NEXT_PUBLIC_API_URL` in `apps/web/src/lib/env.ts` at module load, so the failure surfaces during `next build` / `next dev`.
- Prisma commands are wrapped in `dotenv -e ../../.env` because Prisma resolves `.env` relative to its own working directory, which inside a pnpm workspace is `packages/database`.

`.env.example` documents every variable and which of the two database roles it refers to. Read that file before changing connection settings — the two-role split is load-bearing (see below).

---

## Database

### Two roles, on purpose

`docker compose` provisions two Postgres roles, and the distinction is the entire basis of tenant isolation:

| Role         | Used by                                  | Env var                  | Privileges                                     |
| ------------ | ---------------------------------------- | ------------------------ | ---------------------------------------------- |
| `postgres`   | `prisma migrate`, `prisma studio`, seeds | `MIGRATION_DATABASE_URL` | Superuser — **bypasses RLS**                   |
| `pharma_app` | the running API                          | `DATABASE_URL`           | `NOSUPERUSER NOBYPASSRLS`, not the table owner |

PostgreSQL exempts superusers from Row-Level Security unconditionally, and table owners unless the table is marked `FORCE ROW LEVEL SECURITY`. If the API connected as `postgres`, every RLS policy in this repository would be silently inert. It connects as `pharma_app` instead, and the migration marks every tenant-scoped table `FORCE ROW LEVEL SECURITY` to close the owner loophole too.

### Commands

Run from the repository root:

```bash
pnpm db:migrate            # create + apply a migration (development)
pnpm db:migrate:deploy     # apply pending migrations only (CI / production)
pnpm db:generate           # regenerate the Prisma client
pnpm db:studio             # browse data (connects as the superuser — RLS is bypassed)
pnpm db:reset              # DESTRUCTIVE: drop, recreate, re-migrate, re-seed
```

To wipe the container's data entirely (including the provisioned roles, so the init script re-runs):

```bash
docker compose down -v && docker compose up -d && pnpm db:migrate
```

### Migrations

| Migration                                       | Contents                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `20260901000000_init`                           | Tables, enums, indexes, foreign keys for `tenants`, `users`, `audit_logs`                                                             |
| `20260901000100_rls_and_guards`                 | Hand-written: RLS policies, the tenant accessor functions, append-only and no-hard-delete triggers, runtime-role grants               |
| `20260901000200_auth_bootstrap`                 | Hand-written: the narrow policy that lets the API resolve a user before their tenant is known (see [Authentication](#authentication)) |
| `20260901000300_provisioning_without_superuser` | Hand-written: un-FORCEs `tenants` so provisioning works without a superuser (see [Deploying to Render](#deploying-to-render))         |

The last two are hand-written because Prisma's schema language cannot express RLS. Keeping them separate makes the database's security posture reviewable as self-contained files.

---

## Multi-tenancy

Every tenant is a pharma manufacturing company. Isolation is enforced in **two independent layers**, and the outer one is the database:

**Layer 1 — PostgreSQL RLS (the real boundary).** Every tenant-scoped table has a policy comparing its `tenant_id` against `public.current_tenant_id()`, which reads the `app.current_tenant_id` session setting. If that setting is unset the function returns `NULL`, every comparison evaluates to `NULL`, and the row is neither visible nor writable — **fail-closed by construction**.

**Layer 2 — application filters.** Prisma-level `where: { tenantId }` clauses. A defence in depth, never the only defence.

### How the tenant reaches the database

1. `TenantMiddleware` (applied to every route in `AppModule`) resolves the caller's tenant and stores it in an `AsyncLocalStorage` via `TenantContextService`.
2. `PrismaService.scoped` returns a client extended so that **every** operation runs inside a transaction that first executes `SELECT set_config('app.current_tenant_id', $1, true)`.
3. The RLS policies read that setting.

The `true` argument makes it `SET LOCAL` — transaction-scoped, therefore connection-checkout-scoped. This matters: Postgres settings are per-session and Prisma hands out pooled connections, so setting the tenant "once per request" on a bare client would leak it into the next request that borrowed the same connection. There is no window here in which a connection carries the wrong tenant.

The cost is one extra round trip per operation. Where that matters, use `PrismaService.transaction(fn)` and issue several statements inside a single scoped transaction.

### Adding a tenant-scoped table

1. Add `tenantId String @map("tenant_id") @db.Uuid` plus a relation to `Tenant`.
2. Add `deletedAt` if the table is compliance-relevant (no hard deletes).
3. Generate the migration, then **hand-edit it** to append:

```sql
ALTER TABLE "your_table" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "your_table" FORCE ROW LEVEL SECURITY;

CREATE POLICY "your_table_tenant_isolation" ON "your_table"
  FOR ALL
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.require_tenant_id());

CREATE TRIGGER "your_table_no_hard_delete"
  BEFORE DELETE ON "your_table"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
```

The helper functions and triggers already exist; new tables attach them rather than redefining the rule.

---

## Audit logging

`AuditInterceptor` is registered **globally** (`APP_INTERCEPTOR` in `AppModule`). Every successful mutating request (`POST`/`PUT`/`PATCH`/`DELETE`) writes an `AuditLog` row. It is opt-**out**, not opt-in:

```ts
@SkipAudit('Read-only probe; mutates nothing.') // must state a reason
@Controller('health')
export class HealthController {}
```

That inversion is the point: an endpoint nobody thought about is audited, whereas under an opt-in scheme the endpoints nobody thought about are precisely the ones missing from the trail.

- `@Auditable('Batch')` names the entity type; without it the interceptor infers one from the route prefix.
- Sensitive keys (`password`, `token`, `secret`, …) are redacted before being written, since the audit table is broadly readable inside a tenant.
- `AuditService.record()` never throws — a failed audit write must not roll back a business operation that already succeeded. It logs at `error`, which is what alerting should watch.

**Append-only** is enforced three ways: no update/delete surface in the API, no `UPDATE`/`DELETE` privilege for `pharma_app` on `audit_logs`, and a `BEFORE UPDATE OR DELETE` trigger that raises. There is deliberately no `deletedAt` column on `AuditLog` — a row that could be marked deleted would not be an audit trail.

For a real before/after diff, call `AuditService.record()` from the service that already read the prior state; the interceptor can only see the request and the response.

---

## Authentication

**Clerk** is the identity provider; **our Postgres is the source of truth for tenant and role.** Clerk knows only that someone signed in — which company they belong to and what they may do lives in the `users` table. That split is deliberate: a role baked into a JWT stays valid until the token expires, and in a GxP system revoking a Quality Officer's release authority has to take effect on the next request, not in fifteen minutes.

Clerk _Organizations_ are not used. Our `Tenant` already is the organisation, and mirroring it into Clerk would create two sources of truth plus a sync problem.

### Signup: two steps, and roles are never self-selected

1. **`/sign-up`** — Clerk creates the identity (email, password, verification). No role field anywhere on this form.
2. **`/onboarding`** — the person names their company. This creates the `Tenant` and exactly one `User`, whose role is always `ADMIN`.

Everyone else is created by that Admin, who picks their role. If self-service registration let a stranger choose `ADMIN`, tenant isolation would be the only thing standing between them and someone else's data.

Two details worth knowing:

- The email on the new `User` comes from **Clerk**, never from the request body. A caller who could name their own address could claim one they do not control — and email is the identity an Admin later invites against.
- New tenants are created `TRIAL`, not `ACTIVE`. Activation is a commercial decision, and the signup path must not be able to grant it.

### The request pipeline

| Stage       | Component                  | What it does                                                                                                                                                                       |
| ----------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Middleware  | `RequestContextMiddleware` | Opens the AsyncLocalStorage store with a correlation id. Knows nothing about the caller yet.                                                                                       |
| Guard 1     | `ClerkAuthGuard`           | Verifies the bearer token locally against Clerk's JWKS (signature, expiry, authorised party), then resolves the Clerk subject to our `User` — filling in tenant, user id and role. |
| Guard 2     | `RolesGuard`               | Enforces `@Roles(...)` and refuses read-only roles on any mutating verb.                                                                                                           |
| Interceptor | `AuditInterceptor`         | Records the mutation.                                                                                                                                                              |

Both guards are registered globally, so **authentication is the default**. A new controller is protected the moment it is written; exposing one takes an explicit `@Public('reason')`.

```ts
@Public('Load balancers probe this before any user exists.')   // no session at all
@AllowNoTenant()                                              // session, but no company yet
@Roles('ADMIN', 'QUALITY_OFFICER')                            // named roles only
```

`@AllowNoTenant()` exists for exactly one situation — the window between "registered with Clerk" and "created a company" — and only `GET /me` and `POST /onboarding/company` carry it.

### The chicken-and-egg problem, and why there is a third migration

A verified token yields only the Clerk subject. To learn the tenant we must read the `users` row — but every policy on `users` requires `app.current_tenant_id` to already be set, and it cannot be until we have read that row. Under the tenant policy alone the lookup returns nothing and every request 401s.

`20260901000200_auth_bootstrap` adds a second, narrow `SELECT` policy that applies **only** when no tenant is set and the row's `external_auth_id` matches `app.current_external_auth_id` — which the API sets solely from a token it has just cryptographically verified. The most it can expose is the single row belonging to the caller. The migration's header documents the two alternatives that were rejected (a tenant claim in the JWT; a separate lookup table) and why.

### Roles

Eight roles, defined once in `packages/types/src/roles.ts` and mirrored by a Prisma enum, with a compile-time assertion in `packages/database/src/index.ts` that fails the build if the two ever drift.

`ROLE_MODULES` in `packages/types/src/auth.ts` maps each role to the feature areas it may open. The API's guard and the web navigation read that same table, so a user is never shown a menu item they would be refused on. **Hiding a link is usability, not security** — enforcement is `RolesGuard` plus row-level security, both of which hold regardless of what the browser renders.

`MANAGEMENT` is read-only platform-wide: `RolesGuard` refuses it on `POST`/`PUT`/`PATCH`/`DELETE` whatever a route's `@Roles` says. Encoding that once beats trusting every future controller to leave `MANAGEMENT` off every write.

### Where users land

`/post-auth` is the single place that decides. Sign-in, the root path and anything else needing "send them to the right screen" all defer to it rather than each guessing:

- no session → `/sign-in`
- session, no company → `/onboarding`
- disabled account → `/sign-in?reason=disabled`
- otherwise → `ROLE_LANDING_PATH[role]`

The Next.js middleware only answers "is there a Clerk session at all". Whether a user has a company lives in Postgres and needs an authenticated API call — too expensive to do at the edge on every asset request — so each protected page resolves it via `requireSession()`.

### Setting up Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Copy the publishable and secret keys into `.env` (see `.env.example`). Both must come from the same instance — the API refuses to boot on a mismatched pair, because otherwise every token silently fails verification.
3. Enable whichever sign-in methods you want (email + password is enough to start). Clerk's own components pick them up; no code change needed.

No JWT template or custom claims configuration is required.

---

## Repository layout

```
pharma-erp/
├── apps/
│   ├── api/                      # NestJS 11 REST API
│   │   └── src/
│   │       ├── auth/             # Clerk verification, role guard, company onboarding
│   │       ├── common/audit/     # global audit interceptor + service + decorators
│   │       ├── config/           # class-validator environment schema (fail fast)
│   │       ├── health/           # GET /health, /health/live, /health/ready
│   │       ├── prisma/           # PrismaService — exposes tenant-scoped clients
│   │       └── tenant/           # AsyncLocalStorage request context + middleware
│   └── web/                      # Next.js 15 App Router + Tailwind
│       └── src/
│           ├── middleware.ts     # clerkMiddleware; protected by default
│           ├── components/       # role-filtered app shell
│           ├── app/(auth)/       # /sign-in and /sign-up (Clerk components)
│           ├── app/onboarding/   # company setup form + server action
│           ├── app/post-auth/    # the single "where do they belong" decision
│           ├── app/dashboard/    # role-aware dashboard
│           └── lib/              # env validation, API client, session helpers
├── packages/
│   ├── config/                   # shared ESLint + tsconfig presets
│   ├── database/                 # Prisma schema, migrations, tenant-scoped client,
│   │                             #   auth lookup, provisioning client
│   └── types/                    # DTOs, role enum, module map, session contract
├── scripts/verify-rls.mjs        # asserts tenant isolation against a live database
├── scripts/render-bootstrap.sql  # one-time: creates the least-privilege app role
├── render.yaml                   # Render Blueprint: database + api + web
├── docker/postgres/init/         # provisions the least-privilege app role
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

---

## Development

```bash
pnpm dev          # API (:4000) + web (:3000) via Turborepo
pnpm build        # build every package in dependency order
pnpm typecheck    # tsc --noEmit everywhere
pnpm lint         # ESLint, zero warnings tolerated
pnpm format       # Prettier write
```

To run one app alone:

```bash
pnpm --filter @pharma-erp/api dev
pnpm --filter @pharma-erp/web dev
```

### Calling the API directly

Every endpoint except `/health` requires a Clerk session token as a bearer credential:

```bash
curl -H "Authorization: Bearer <clerk-session-token>" http://localhost:4000/api/v1/me
```

The quickest way to get a token while developing is to sign in through the web app and copy it from the browser (Clerk exposes it via `window.Clerk.session.getToken()` in the console). There is deliberately no bypass header — an unauthenticated escape hatch is exactly the thing that gets left switched on in production.

### Conventions

- **Routes** are prefixed `/api/v1`, except the health endpoints, which stay unversioned so probes have a stable URL.
- **Validation** is global: `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, so an unknown field is a 400 rather than a silent drop. Every endpoint needs a `class-validator` DTO.
- **No hard deletes** on compliance-relevant tables. Set `deletedAt`; the database trigger will reject a `DELETE`.
- **Never use** `$queryRawUnsafe` / `$executeRawUnsafe` — ESLint blocks them. Use the tagged-template forms so values are parameterised.

---

## Testing

Three layers, cheapest first.

### 1. Static + unit — no database, no Clerk

```bash
pnpm lint          # ESLint, zero warnings tolerated
pnpm typecheck     # tsc --noEmit across all packages
pnpm test          # unit tests
pnpm build         # full production build of both apps
```

The unit tests cover the two places where a mistake is silent rather than loud: the environment contract (`env.validation.spec.ts` — mismatched Clerk key pairs, test keys in production, missing database URLs) and the role guard (`roles.guard.spec.ts` — every `@Roles` branch, and that `MANAGEMENT` is refused on every mutating verb even when a route explicitly lists it).

### 2. Row-Level Security — needs a migrated database, no Clerk

```bash
pnpm verify:rls
```

**This is the test that matters most.** RLS is enforced by PostgreSQL, so the only way to know it works is to ask PostgreSQL — no unit test can tell you. The harness (`scripts/verify-rls.mjs`) creates two throwaway tenants, asserts 17 properties as the real application role through the real Prisma client, then removes them:

| Group                  | Asserts                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enforcement is on      | RLS enabled **and** forced on every tenant-scoped table; the app role is not a superuser                                                                     |
| Tenant isolation       | a scoped client sees only its own rows; an explicit cross-tenant `where` returns nothing; an unscoped client returns **zero** rows, not all rows             |
| Connection-pool safety | no tenant bleed across interleaved concurrent queries on one pool                                                                                            |
| Write protection       | cross-tenant `INSERT` refused; write with no tenant raises `require_tenant_id`; hard `DELETE` refused by trigger                                             |
| Audit trail            | rows insert; `UPDATE` and `DELETE` refused **even for the superuser**                                                                                        |
| Auth bootstrap         | a verified subject resolves to its user/tenant/role with no tenant set; an unknown subject resolves to null; the policy cannot widen an already-scoped query |

It refuses to run against `NODE_ENV=production`, and refuses if `DATABASE_URL` equals `MIGRATION_DATABASE_URL` — because the app would then be connecting as the superuser, RLS would be bypassed, and every assertion would pass meaninglessly.

### 3. End-to-end signup — needs a database and real Clerk keys

1. `pnpm dev`, then open <http://localhost:3000>.
2. You are redirected to `/sign-up`. Register — this creates the Clerk identity. **There is no role field**; that is the design, not an omission.
3. You land on `/onboarding`. The company identifier checks availability as you type. Submit.
4. You arrive at `/dashboard` as **Admin**, with all nine modules listed.

Worth poking at while you are there:

- **Sign out and revisit `/dashboard`** — 307 to `/sign-in`.
- **Try `/onboarding` again once onboarded** — redirected to `/dashboard`. You cannot create a second company from one account.
- **Change your own role in the database** to `SALES_MANAGER`, then reload. The navigation and the "Your access" panel shrink immediately, with no sign-out — because the role is read from Postgres per request, not from a token claim.
- **Set it to `MANAGEMENT`** — a read-only banner appears, and any mutating API call now 403s.
- **Set `status` to `DISABLED`** — you are bounced to `/sign-in?reason=disabled`.

```sql
-- role changes take effect on the next request; no re-login needed
UPDATE users SET role = 'MANAGEMENT' WHERE email = 'you@example.com';
```

### Testing the API directly

```bash
curl http://localhost:4000/health                     # 200, unauthenticated
curl -i http://localhost:4000/api/v1/me               # 401 "Missing bearer token."
curl -i -H "Authorization: Bearer nonsense"      http://localhost:4000/api/v1/me                  # 401 "Invalid or expired session."
```

For an authenticated call, sign in through the web app and take a token from the browser console with `await window.Clerk.session.getToken()`. There is deliberately no bypass header — an unauthenticated escape hatch is exactly what gets left switched on in production.

### Running Postgres without Docker

Docker is convenient, not required — anything reachable on a connection string works, and the two-role split is the only part that must be right.

**With a native PostgreSQL install** (16 or later; 18 is fine). Run as your superuser:

```bash
createdb pharma_erp
pnpm db:migrate                                      # create the tables first
psql -d pharma_erp -f scripts/render-bootstrap.sql   # after editing app_password at the top
```

`scripts/render-bootstrap.sql` is not Render-specific despite the name — it creates the least-privilege `pharma_app` role and its grants, and it works whether the connection is a superuser or a plain database owner. Run it **after** the migration, so the table grants have tables to grant on.

Then point `.env` at it:

```ini
DATABASE_URL="postgresql://pharma_app:<the password you set>@localhost:5432/pharma_erp?schema=public"
MIGRATION_DATABASE_URL="postgresql://postgres:<your postgres password>@localhost:5432/pharma_erp?schema=public"
```

**On Windows**, the installer usually registers a service. If `pnpm db:migrate` cannot connect, check it is running:

```powershell
Get-Service | Where-Object { $_.Name -match 'postgres' }
Start-Service postgresql-x64-18        # name will match your version
```

If no service exists, start the cluster directly (adjust version and data directory):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "C:\Program Files\PostgreSQL\18\data" -l "$env:TEMP\pg.log" start
```

#### Keeping it running across reboots

A PostgreSQL installed without a Windows service does not restart with the machine, and the failure is confusing rather than obvious: the API validates its database connection at boot and exits, so the web app keeps serving pages while every request that touches data fails. You get a login screen that refuses to log you in.

```powershell
pnpm dev:db          # start it if it is down; no-op if it is already up
```

To stop needing that, register it as a service once from an **Administrator** shell:

```powershell
.scriptsdev-db.ps1 -Register
```

The script refuses without elevation rather than failing halfway through.

`pnpm verify:rls` will tell you whether the setup is correct — in particular whether the app role really is non-superuser, which is the part that silently makes RLS decorative if you get it wrong.

---

## Deploying to Render

`render.yaml` is a [Blueprint](https://render.com/docs/blueprint-spec) that creates two resources: a Postgres database, and one web service running both the API and the web app (see `apps/server`, and `docs/Service-Merge-Plan-Web-API.docx` for why they're merged).

### The one thing that will bite you

**Render's managed Postgres gives you a database owner, not a superuser.** That difference is load-bearing here, and worth understanding before you deploy rather than after:

- PostgreSQL exempts superusers from RLS unconditionally, and the table owner too — unless a table is marked `FORCE ROW LEVEL SECURITY`.
- Migration `20260901000100` marks the tenant tables `FORCE`. Locally that was invisible, because the provisioning connection is the `postgres` superuser.
- On Render there is no superuser, so the owner **is** subject to the policies — and `tenants` had no `INSERT` policy. Company signup failed outright, and the slug-availability check reported every slug as free.

Migration `20260901000300` fixes this by dropping `FORCE` from `tenants` **only**. `FORCE` affects nothing but the table owner, so `pharma_app` — which is not the owner — stays fully constrained and the runtime security posture is unchanged. `users` and `audit_logs` keep `FORCE`, and provisioning inserts the first Admin by setting `app.current_tenant_id` to the tenant it just created, so the existing `WITH CHECK` passes on its own terms rather than by exemption.

This was found by running the migrations against a deliberately non-superuser owner. `pnpm verify:rls` now asserts it in a **Provisioning without a superuser** group, so it cannot regress silently.

### Steps

1. **Push the repo** to GitHub or GitLab.

2. **Render → New → Blueprint**, select the repo. It reads `render.yaml` and shows two resources. Create them. The first deploy will fail — expected, since the secrets are not set yet.

3. **Apply migrations, then run the bootstrap script**, using the _External Database URL_ from the Render dashboard. Edit `app_password` at the top of the script to a long random value first:

   ```bash
   MIGRATION_DATABASE_URL="<external database url>" pnpm db:migrate:deploy
   psql "<external database url>" -f scripts/render-bootstrap.sql
   ```

   If it fails with _permission denied to create role_, Render's user lacks `CREATEROLE` — see the fallback below.

4. **Set the secrets** Render will not accept from a blueprint (marked `sync: false`):

   | Service | Variable                            | Value                                                                                           |
   | ------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
   | api     | `DATABASE_URL`                      | the owner URL with username and password swapped for `pharma_app`'s, keeping `?sslmode=require` |
   | api     | `CLERK_SECRET_KEY`                  | `sk_live_…` from your Clerk production instance                                                 |
   | api     | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…`                                                                                     |
   | web     | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the same `pk_live_…`                                                                            |

   The API refuses to boot on a mismatched test/live pair, and refuses to start in production with test keys at all. Both are deliberate: a mismatch otherwise shows up only as unexplained 401s.

5. **Add the Render URLs to Clerk** — in the Clerk dashboard, add the web service's domain to your production instance and set its sign-in / sign-up paths to `/sign-in` and `/sign-up`.

6. **Deploy**, then verify:

   ```bash
   curl https://<api>.onrender.com/health        # expect status ok, database up
   ```

   And point the harness at the deployed database once, from your machine:

   ```bash
   DATABASE_URL="<pharma_app url>" MIGRATION_DATABASE_URL="<owner url>" node scripts/verify-rls.mjs
   ```

   It creates and removes two throwaway tenants. It is safe by construction, but there is no reason to run it against a database holding real customer data.

### Things worth knowing

- **`NEXT_PUBLIC_*` are baked in at build time**, not read at runtime. Changing one needs a rebuild, not a restart. Render does rebuild on an env var change, so this is handled — but it is why "just restart it" will not pick up a new value.
- **`PORT`** is injected by Render and takes precedence over `API_PORT`. Binding anything else means the deploy never turns healthy, with no error explaining why.
- **`preDeployCommand`** runs migrations before the new instance takes traffic, and requires a paid instance type. On the free tier, remove it and run `pnpm db:migrate:deploy` by hand.
- **The health check** is `/health/ready`, which returns 503 when Postgres is unreachable — so Render will not route traffic to an instance that cannot serve.
- **Keep both resources in one region.** Cross-region database latency is paid on every request.

### Fallback if you cannot create a second role

If Render's user lacks `CREATEROLE`, you can point `DATABASE_URL` at the owner too. Understand what that costs:

- `users` and `audit_logs` stay `FORCE`'d, so tenant isolation still holds for them at the database level.
- But the application would then own its tables, and an owner can run `ALTER TABLE … NO FORCE ROW LEVEL SECURITY`. Isolation would rest on the application never being induced to run that — one SQL-injection bug away from gone.
- `pnpm verify:rls` refuses to run when both URLs match, precisely so this cannot be mistaken for a verified setup.

Treat it as temporary and ask your provider for a second role.

---

## Troubleshooting

| Symptom                                                    | Cause                                                                                                    | Fix                                                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Login page loads but sign-in fails with `fetch failed`     | PostgreSQL is down, so the API exited at boot while the web app kept serving                             | `pnpm dev:db`, then restart `pnpm dev`                                                                                   |
| Dashboard shows "Could not reach the API"                  | API not running, or port mismatch                                                                        | `pnpm dev`; check `NEXT_PUBLIC_API_URL` matches `API_PORT`                                                               |
| `/health` reports database `down`                          | Postgres not up, or migrations not applied                                                               | `docker compose up -d && pnpm db:migrate`                                                                                |
| `password authentication failed for user "pharma_app"`     | The container's data volume predates the init script                                                     | `docker compose down -v && docker compose up -d && pnpm db:migrate`                                                      |
| Queries return zero rows that clearly exist                | No tenant context — RLS is failing closed, as designed                                                   | Use `PrismaService.scoped`, not `unscoped`; check the request went through `RequestContextMiddleware` and the auth guard |
| `app.current_tenant_id is not set for this transaction`    | A write attempted without tenant scope                                                                   | Same as above — this error is the `require_tenant_id()` guard doing its job                                              |
| `Environment variable not found: DATABASE_URL` from Prisma | Prisma invoked directly instead of via a package script                                                  | Use `pnpm db:migrate` etc., which inject the root `.env`                                                                 |
| API exits at boot with "Clerk key mismatch"                | One key is `_test_`, the other `_live_`                                                                  | Take both keys from the same Clerk instance                                                                              |
| Every API call 401s with "Invalid or expired session"      | Web and API are pointed at different Clerk instances, or `CLERK_AUTHORIZED_PARTIES` excludes your origin | Check both keys match; unset `CLERK_AUTHORIZED_PARTIES` locally so it falls back to `WEB_ORIGIN`                         |
| Signed in but stuck on /onboarding                         | The Clerk user has no `users` row yet                                                                    | Expected — complete the company form. If it loops, check `GET /api/v1/me` returns `onboarded: true`                      |
| 403 "No company is associated with this account yet"       | An onboarded-only route was called pre-onboarding                                                        | Correct behaviour; only `/me` and `/onboarding/*` carry `@AllowNoTenant()`                                               |

---

## Not yet built

Deliberately out of scope for this foundation commit:

- **Admin user management.** An Admin cannot yet invite colleagues or change their roles from the UI — the roles, guards and `User` model are all in place, but the screens and the invite endpoint are not.
- **The domain model.** `Item`, `Party`, `Bom`, `Batch`, `PurchaseOrder`, `Grn`, `PurchaseInvoice`, `WorkOrder`, `SalesOrder`, `SalesInvoice`.
- **Business logic**, tests beyond a passing placeholder, and CI.
