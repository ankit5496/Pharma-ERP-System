# Pharma Manufacturing ERP — project reference

**Purpose of this file.** A complete, self-contained description of what exists in
this repository: every table and column, every API endpoint, every screen, every
piece of automation, and — just as importantly — what is _not_ built. It is
written so that someone (or some model) with no prior exposure to the codebase
can answer questions about it without reading the source.

**Read the "Not built" sections.** The most common mistake when picking this
project up is assuming a module exists because its navigation tab does. Four
workflow tabs are visible in the UI; two of them are entirely placeholder.

Last verified against the code on **15 September 2026**. The table and enum
appendix is generated from `schema.prisma`, so it cannot drift by being
hand-typed; the prose sections are hand-written and were checked against the
code on that date.

---

## 1. What the system is

A multi-tenant ERP for Indian pharmaceutical contract manufacturing. One
deployment serves many companies ("tenants"); a company's data is isolated by
PostgreSQL row-level security, not by application filtering.

The domain runs in four workflows, which are the four top-level tabs:

| Workflow                  | Status                                        |
| ------------------------- | --------------------------------------------- |
| Procure-to-Pay            | Built, 7 of 7 steps                           |
| Production & Quality Gate | Built, 5 of 5 shown steps                     |
| Order-to-Cash             | **Not built** — 0 of 7 steps, navigation only |
| Job Work                  | **Not built** — 0 of 7 steps, navigation only |

Alongside the workflows there is a **Master Data** area (6 registers), a
**dashboard**, a **user administration** screen, and a separate **platform
console** for the vendor who operates the deployment.

---

## 2. Repository layout

A pnpm + Turborepo monorepo. The application root is `pharma-erp/`.

```
pharma-erp/
├─ apps/
│  ├─ api/        NestJS 11 — all business logic and the only database client
│  └─ web/        Next.js 15.5 (App Router) / React 19 — server components
├─ packages/
│  ├─ database/   Prisma 6.19 schema, migrations, and the tenant-scoped client
│  ├─ types/      Wire types and registries SHARED by api and web
│  └─ config/     eslint / tsconfig / prettier base configs
├─ scripts/       Provisioning and demo seeding (plain .mjs, run with dotenv)
└─ docs/          This file
```

**`packages/types` is the contract.** Both the API and the web app import from
it. If a shape appears in both, it is declared once there — the navigation
registries, the status enums, the display labels and every request/response
interface. Changing a type there is a change to both sides at once.

**The web app never talks to the database.** It calls the API over HTTP from
server components, forwarding the user's session token as a bearer header.

### Key commands

| Command                                      | What it does                                        |
| -------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                   | Runs api (:4000) and web (:3000) together via turbo |
| `pnpm typecheck` / `pnpm lint`               | Verification that does not touch `.next`            |
| `pnpm db:migrate:deploy`                     | Applies pending migrations                          |
| `pnpm create-tenant --slug <s> --name "<n>"` | Provisions a company                                |
| `pnpm seed:production --tenant <slug>`       | Demo data for the Production walkthrough            |
| `pnpm verify:rls`                            | Proves tenant isolation actually holds              |

Environment comes from `.env.local` first, then `.env` — **`.env.local` wins**,
which is how the API ends up pointed at the hosted database rather than a local
one. This trips people up; check it before diagnosing anything performance- or
data-related.

---

## 3. The three rules that explain most of the code

Almost every unusual-looking decision in this repository follows from one of
these three. Understanding them first will save re-deriving them later.

### 3.1 Tenant isolation is enforced by the database

Every tenant-owned table has a `tenant_id` column, `ENABLE ROW LEVEL SECURITY`
and `FORCE ROW LEVEL SECURITY`. Policies compare `tenant_id` against
`public.current_tenant_id()`, which reads the `app.current_tenant_id` setting.

Consequences worth knowing:

- **The table owner does not bypass it.** `FORCE` applies to the owner too. Only
  a superuser bypasses, which is why `pnpm verify:rls` must run as the
  least-privilege role or it proves nothing.
- Runtime connects as **`pharma_app`** (least privilege). Migrations connect as
  the **owner** on a separate URL (`MIGRATION_DATABASE_URL`).
- A query with no tenant set returns **zero rows**, never an error. Failing
  closed is deliberate.
- `prisma.scoped` is an extended Prisma client that sets the tenant for each
  call. It is the default client for request handling; the raw client is used
  only where a tenant genuinely is not yet known (sign-in).

### 3.2 Compliance records are never hard-deleted

Tables that a regulator could ask about carry a `deleted_at` column and a
`prevent_hard_delete()` trigger. `DELETE` is refused _by PostgreSQL_ — not by a
service that could be bypassed. "Delete" in the UI means stamping `deleted_at`.

Append-only tables go further: `audit_logs`, `platform_audit_logs`, `qc_results`
and `stock_ledger_entries` have an `enforce_append_only()` trigger that refuses
`UPDATE` as well as `DELETE`.

### 3.3 Quantities and money cross the wire as strings

Columns are `Decimal`. JSON has only IEEE-754 doubles, so serialising a decimal
as a number silently rounds it — `0.1` becomes `0.09999999999999999`. Every
quantity, rate and amount is therefore a **string** in every API response and
every TypeScript interface, and the UI formats it for display without ever doing
arithmetic on it.

If you see `quantityAvailable: string` and think it is a bug, it is not.

---

## 4. Roles and permissions

`UserRole` — `ADMIN`, `PURCHASE_MANAGER`, `STORE_OFFICER`, `PRODUCTION_OFFICER`,
`QUALITY_OFFICER`, `SALES_MANAGER`, `ACCOUNTANT`, `MANAGEMENT`.

Authentication is a **global guard**: a new controller is protected the moment
it is written, and exposing one requires an explicit `@Public('reason')`.

The identity is **re-read from the database on every request** — the token's
claims are frozen at issue, so role, status and the must-change-password flag
come from Postgres. Disabling a user takes effect on their next request.

Separations that are enforced rather than advisory:

| Rule                                                                   | Where                                    |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| Only `QUALITY_OFFICER` may decide a batch release — **not even ADMIN** | `POST /production/batches/:id/release`   |
| Licence records are visible only to `ADMIN` and `QUALITY_OFFICER`      | controller-level `@Roles` on `/licences` |
| User administration is `ADMIN` only                                    | controller-level `@Roles` on `/users`    |
| Job-work agreements: `ADMIN` + `SALES_MANAGER` write, anyone reads     | `/job-work/agreements`                   |
| Packaging specs: `ADMIN` + `PRODUCTION_OFFICER` write, anyone reads    | `/packaging/requirements`                |

Reads are generally open to any signed-in role, deliberately: the people who need
to know what a pack consumes are the packing line and the buyer, not only whoever
wrote the spec.

**Platform users are a separate identity space.** `platform_users` are the vendor's
own operators who create and suspend companies. They are not tenant users, their
tokens carry `scope: 'platform'`, and the tenant guard refuses those tokens
outright.

---

## 5. Screens — what the UI actually shows

### 5.1 Route map

| Route                              | What it is                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `/login`                           | Tenant sign-in                                                                               |
| `/change-password`                 | Forced on first sign-in (`must_change_password`)                                             |
| `/dashboard`                       | Landing page, role-aware                                                                     |
| `/master-data`                     | The six master-data registers (tabbed)                                                       |
| `/master-data/[form]`              | One register                                                                                 |
| `/workflows/procure-to-pay/[step]` | The 7 built P2P steps (static routes)                                                        |
| `/workflows/[workflow]/[step]`     | Production & Quality Gate, and the placeholders                                              |
| `/admin/users`                     | User administration                                                                          |
| `/data`, `/data/[table]`           | Record browser — one route per dataset, with per-dataset read permissions (`mayReadDataset`) |
| `/platform`, `/platform/companies` | Vendor console — separate login                                                              |

Routing note: `procure-to-pay` is a **static** segment and `[workflow]` is
dynamic, so P2P has its own layout and does **not** inherit the `[workflow]`
one. That is why there is no duplicated app shell.

### 5.2 Master Data — six registers

| Register              | Story    | Backing tables                                          |
| --------------------- | -------- | ------------------------------------------------------- |
| Item / Product        | US-MD-01 | `items`                                                 |
| Party                 | US-MD-02 | `parties`                                               |
| BOM / Formulation     | US-MD-03 | `boms`, `bom_lines`                                     |
| Licence & Compliance  | US-MD-04 | `licences`, `tenants.licence_alert_lead_days`           |
| Principal & Job-Work  | US-MD-05 | `job_work_agreements`, `job_work_product_mappings`      |
| Packaging Requirement | US-MD-06 | `packaging_requirements`, `packaging_requirement_lines` |

Fields shown on each form are the columns listed in Appendix A for those tables.
Two form behaviours are worth knowing because they were bug fixes:

- **Validation messages always name the field with a capital first letter.**
  Done centrally in `apps/api/src/config/validation-message.ts`, which rewrites
  class-validator's raw property names (`hsnCode` → "HSN code") through the
  pipe's `exceptionFactory`. Do not add per-DTO message strings for this.
- **A refused save keeps what the user typed.** React 19 resets uncontrolled
  forms after an action resolves, and `<select>` does not re-read
  `defaultValue`, so every select in the master-data forms is controlled.
- **Phone numbers are one combined widget** — an ISO country-code select (`IN`,
  `KE`, …) joined to the number input, sharing one border. The dial codes live
  in `packages/types/src/parties.ts` (`COUNTRY_DIAL_CODES`, `splitPhoneNumber`,
  `joinPhoneNumber`). Country flags are deliberately not rendered: Windows
  Chrome has no flag glyphs and shows the letters instead.

### 5.3 Procure-to-Pay — 7 steps, all built

Low stock → Purchase requisitions → Purchase orders → GRN → Incoming QC →
Purchase invoices → Vendor payments.

The chain that matters: a **goods receipt creates a `stock_lots` row in
QUARANTINE**, and **incoming QC is what moves it to USABLE**. A GRN does not
make material usable. Production can only consume USABLE lots, so this gate is
load-bearing for the whole manufacturing side.

### 5.4 Production & Quality Gate — 5 steps

| Step                | Status | What the screen does                                                                  |
| ------------------- | ------ | ------------------------------------------------------------------------------------- |
| 1 Formulations      | Built  | Lists BOMs with version, active/superseded, and lines                                 |
| 2 Production orders | Built  | Raise a work order; live material-requirement grid with Pass/Fail before you can save |
| 3 Material issue    | Built  | FEFO plan, dispense, lot-override with a reason, stock on hand                        |
| 4 Batch record      | Built  | Record yield; packing record with rejects, pack variant, component consumption        |
| 5 Batch release     | Built  | Quality Officer releases or blocks; released batches become finished-goods stock      |

### 5.5 Dashboard

Role-aware. Sections include company statistics, recent activity, a **licence
renewal alert** and a **packaging shortage alert**. Both alerts call the same
services as their registers, so the alert and the register cannot disagree about
what counts as expiring or short.

---

## 6. Automation — what happens without anyone clicking

This is the part most likely to be missed by reading the schema alone.

### 6.1 In the database

| Mechanism                                     | Effect                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `current_tenant_id()` / `require_tenant_id()` | Read the tenant for RLS. The second raises instead of returning NULL, used in `WITH CHECK`                                                                                                                                                                                                                         |
| `resolve_identity(tenant, user)`              | The per-request identity lookup, in one round trip. Sets the tenant then reads the account under RLS                                                                                                                                                                                                               |
| `prevent_hard_delete()`                       | Refuses `DELETE` on: tenants, users, items, parties, boms, licences, job_work_agreements, packaging_requirements, purchase_requisitions, purchase_orders, goods_receipts, purchase_invoices, vendor_payments, production_plans, platform_users                                                                     |
| `enforce_append_only()`                       | Refuses `UPDATE` **and** `DELETE` on: audit_logs, platform_audit_logs, qc_results, stock_ledger_entries                                                                                                                                                                                                            |
| CHECK constraints                             | 47 of them. Notable: `parties_active_customer_is_licensed` (a customer cannot be ACTIVE without a drug licence number and validity date), `material_issue_lines_override_has_reason` (a FEFO override cannot be stored without a reason), `batches_expiry_after_manufacture`, `job_work_agreements_rate_has_basis` |

### 6.2 In the application

| Automation                       | Where                       | What it does                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FEFO allocation**              | `material-issue.service.ts` | Picks the nearest-expiry USABLE lot first, splitting across lots when one is short. Lots with **no expiry** (cartons, leaflets) sort **last**, not excluded — they cannot expire, so they are the safest to leave on the shelf |
| **Work-order availability gate** | `production.service.ts`     | Refuses to raise a work order when any BOM material is short, naming the material and the shortfall. Previewed live on the form before Save                                                                                    |
| **Packaging availability check** | `packaging.service.ts`      | Same gate for packaging components, scaled to batch size                                                                                                                                                                       |
| **Batch numbering**              | `batch.service.ts`          | `<tenant prefix>-YYMM-NNN`, allocated atomically from `document_sequences` so two concurrent batches cannot collide                                                                                                            |
| **Document numbering**           | `numbering.service.ts`      | Same mechanism for requisition / PO / GRN / invoice numbers                                                                                                                                                                    |
| **Batch expiry**                 | `batch.service.ts`          | Computed from manufacturing date + the item's `shelf_life_months`                                                                                                                                                              |
| **Yield reconciliation**         | `batch.service.ts`          | Packed + rejected may not exceed the manufactured quantity                                                                                                                                                                     |
| **Release closes the order**     | `batch.service.ts`          | Only a `RELEASED` decision closes the production order; `BLOCKED` leaves it open                                                                                                                                               |
| **Reorder check**                | `reorder.service.ts`        | Compares stock against `items.reorder_level` and raises requisitions (gated by `tenants.auto_requisition_enabled`, read via `SettingsService.autoCreationEnabled()`)                                                           |
| **Shelf-life on arrival**        | `goods-receipts.service.ts` | Refuses a receipt whose remaining shelf life is below the item's requirement                                                                                                                                                   |
| **Licence expiry alert**         | `licences.service.ts`       | Fires `tenants.licence_alert_lead_days` (default 60) before expiry                                                                                                                                                             |
| **Packaging shortage sweep**     | `packaging.service.ts`      | Surfaces shortages on the dashboard before the batch is due                                                                                                                                                                    |
| **Audit logging**                | `AuditInterceptor`          | Every mutating request is recorded **unless** the handler carries `@SkipAudit('reason')`. Opt-out, never opt-in                                                                                                                |

---

## 7. API surface

Base path `/api/v1`. All routes require a bearer token except `/health` and the
platform login.

### Authentication

```
POST   /auth/login                POST /auth/logout
GET    /auth/me                   POST /auth/change-password
```

### Master data

```
GET    /parties                   POST /parties            (ADMIN, PURCHASE_MANAGER, SALES_MANAGER)
PATCH  /parties/:id               DELETE /parties/:id      (ADMIN)

GET    /licences                  POST /licences           entire controller: ADMIN, QUALITY_OFFICER
PATCH  /licences/alert            PATCH /licences/:id      DELETE /licences/:id

GET    /job-work/agreements       POST /job-work/agreements   (ADMIN, SALES_MANAGER)
PATCH  /job-work/agreements/:id   DELETE /job-work/agreements/:id (ADMIN)

GET    /packaging/requirements                POST /packaging/requirements (ADMIN, PRODUCTION_OFFICER)
GET    /packaging/requirements/:id/availability?batchQuantity=
PATCH  /packaging/requirements/:id            DELETE /packaging/requirements/:id (ADMIN)
```

### Production & Quality Gate

```
GET    /production/items          POST /production/items     (ADMIN, PRODUCTION_OFFICER, QUALITY_OFFICER)
PATCH  /production/items/:id      DELETE /production/items/:id (ADMIN)
GET    /production/stock-lots     GET  /production/boms
POST   /production/boms           (ADMIN, PRODUCTION_OFFICER, QUALITY_OFFICER)
GET    /production/orders         GET  /production/orders/feasibility?productId=&batchQuantity=
POST   /production/orders         (ADMIN, PRODUCTION_OFFICER)
GET    /production/orders/:id/issue-plan        GET /production/orders/:id/issues
POST   /production/orders/:id/issue             (ADMIN, STORE_OFFICER, PRODUCTION_OFFICER)
GET    /production/batches        GET  /production/batches/:id
POST   /production/batches        POST /production/batches/:id/packing  (ADMIN, PRODUCTION_OFFICER)
POST   /production/batches/:id/release          (QUALITY_OFFICER only)
GET    /production/finished-goods
```

### Procure-to-Pay

```
GET    /procurement/summary | /low-stock | /stock | /stock/ledger | /settings
PATCH  /procurement/settings
GET/POST  /procurement/items | /parties | /boms | /production-plans
POST   /procurement/stock/consume | /reorder-check
GET/POST  /procurement/requisitions        GET /procurement/requisitions/:id
PATCH  /procurement/requisitions/:id       POST /procurement/requisitions/:id/status | /convert
GET/POST  /procurement/purchase-orders     GET /procurement/purchase-orders/receivable | /invoiceable | /:id
PATCH  /procurement/purchase-orders/:id    POST /procurement/purchase-orders/:id/status
GET/POST  /procurement/goods-receipts      GET /procurement/goods-receipts/:id
GET    /procurement/qc/lots | /qc/lots/:id POST /procurement/qc/lots/:id/decision
GET/POST  /procurement/invoices            GET /procurement/invoices/:id
POST   /procurement/invoices/:id/status
GET    /procurement/payables | /payables/report    POST /procurement/payments
```

### Other

```
GET    /dashboard
GET/POST/PATCH/DELETE /users, /users/:id, /users/:id/reset-password   (ADMIN only)
GET    /health, /health/ready                                          (public)
POST   /platform/auth/login  GET /platform/auth/me  POST /platform/auth/change-password
GET/POST/PATCH /platform/companies   GET /platform/dashboard
```

---

## 8. What is NOT built

Please read this section before assuming a feature exists.

### Whole workflows with navigation but no implementation

- **Order-to-Cash** — all 7 steps are `state: 'planned'`. No customers, sales
  orders, allocation, dispatch, sales invoices, receipts or returns. There is
  no sales or dispatch module in the API at all.
- **Job Work** — all 7 steps are `state: 'planned'`. The _master data_ for it
  exists (`job_work_agreements`), but no job-work order, inward material,
  outward dispatch or billing flow.
- **In-process checks and finished-goods testing.** These were tabs 5 and 6 of
  Production until 15 September 2026, when they were removed from the
  navigation — a tab that only ever said "not built yet" read as a broken
  screen rather than as a gap. **Removing the tabs did not close the gap.**
  There is no product specification master, no test-results table, and no
  check at release: a Quality Officer can release a batch with no recorded
  test results at all. The decision records who, when and why — it records no
  evidence. See the comment in `packages/types/src/workflows.ts` for what
  restoring them requires.

### Known open defects

1. **`PATCH /production/items` can clear HSN and GST.** Both columns are
   nullable and the update DTO accepts `null`, so a value required at creation
   can be removed afterwards. Contradicts US-MD-01.
2. **US-MD-05's billing-model freeze is not enforced.** The criterion says the
   billing model cannot change on an agreement whose orders are in production.
   `production_orders` carries no reference to a job-work agreement, so the
   question cannot be asked. Needs a foreign key, then a guard. (This was
   deferred when the Production module did not exist; it does now, so it is
   unblocked.)
3. **The licence reference unique index is not partial**, so a retired licence's
   number cannot be reused.
4. **`items.schedule_classification` drives nothing downstream.** It is stored
   and validated, but the Sales and Compliance checks it is meant to gate do not
   exist yet.
5. **US-MD-06's Sales Dispatch half has nothing to hook into** — "every Sales
   Dispatch triggers a packaging availability check" needs Order-to-Cash.

### Environment caveats

- The **local** database is several migrations behind the hosted one and is
  missing the Procure-to-Pay tables. The hosted database is the only complete
  environment.
- A migration `20260915000000_order_to_cash_customer_register` (creating
  `customer_licences`) exists **on the hosted database but in no git branch** —
  applied from a teammate's working copy and not yet pushed.

---

## 9. Gotchas that cost real time

- **Never run `pnpm build` in `apps/web` while `pnpm dev` is running.** Both use
  the same `.next`, and it corrupts the running server. Use `typecheck` and
  `lint` to verify instead.
- **A build error naming a file that `grep` cannot find in `src` is a stale
  `.next` cache**, usually after merging a branch that deleted a component. Stop
  dev, delete `apps/web/.next`, restart.
- **`nest --watch` does not watch workspace packages.** Editing
  `packages/database` or `packages/types` requires rebuilding that package _and_
  restarting the API — the API loads them from compiled `dist`.
- **`prisma generate` fails with `EPERM` on the Windows query engine DLL while
  the API is running.** It still writes the TypeScript client, so this is
  usually harmless.
- **Prisma attributes cannot span multiple lines** in `schema.prisma`.
- **Never edit an applied migration.** Checksums are recorded in
  `_prisma_migrations`; changing a file breaks the next deploy everywhere.
- **Prisma cannot name a partial unique index in its error** — it reports
  "Unique constraint failed on the (not available)". Pre-check instead.
- Against the hosted database, each query in an interactive transaction is a
  separate network round trip. `prisma.scoped` wraps individual queries in their
  own transaction, so a handler making several reads pays several round trips
  each. This is the largest remaining performance cost in the system.

---

The appendix — every table, every column, and every enumeration — is in
[PROJECT-REFERENCE-appendix.md](./PROJECT-REFERENCE-appendix.md), generated
directly from the Prisma schema.
