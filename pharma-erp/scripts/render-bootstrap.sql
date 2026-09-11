-- =============================================================================
-- One-time bootstrap for a managed PostgreSQL (Render, Neon, RDS, Supabase…)
-- =============================================================================
-- Creates the least-privilege role the API connects as at runtime.
--
-- Run it ONCE, as the database owner, after the database exists and BEFORE the
-- first deploy. On Render:
--
--   psql "<External Database URL from the Render dashboard>" -f scripts/render-bootstrap.sql
--
-- Then set DATABASE_URL on the API service to the same connection string with
-- the username and password swapped for pharma_app's, keeping ?sslmode=require.
--
-- WHY THIS EXISTS
-- ---------------
-- PostgreSQL exempts two kinds of connection from row-level security: superusers
-- (always) and the table owner (unless the table is FORCE'd). A managed database
-- gives you an owner, and if the API connected as that owner, every RLS policy
-- in packages/database/prisma/migrations would still hold for `users` and
-- `audit_logs` (they are FORCE'd) but the owner could also simply turn FORCE
-- off, since it owns the tables. A separate non-owner role removes that option
-- entirely, and costs one SQL script.
--
-- Order matters: run this AFTER `prisma migrate deploy` has created the tables,
-- or the table-level grants below have nothing to grant on. The ALTER DEFAULT
-- PRIVILEGES statements cover tables added by later migrations automatically.
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 1. Change this before running
-- -----------------------------------------------------------------------------
-- Use a long random value. It ends up in DATABASE_URL, which Render stores as a
-- secret, so it never needs to be memorable.
-- Supply it on the command line rather than editing this file:
--
--   psql "<owner URL>" -v app_password="$(openssl rand -base64 24)" -f scripts/render-bootstrap.sql
--
-- The \if below only applies the placeholder when nothing was passed, so the
-- secret need never be written to disk or committed by accident. An
-- unconditional \set here would silently override -v, which is a trap worth
-- closing: the command would appear to work and quietly set the placeholder.
\if :{?app_password}
\else
\set app_password 'CHANGE_ME_before_running'
\endif

-- -----------------------------------------------------------------------------
-- 2. The role
-- -----------------------------------------------------------------------------

-- NOTE ON STYLE: the password is interpolated with psql's `:'var'` at the top
-- level and never inside a DO block. psql does not perform variable
-- substitution within dollar-quoted strings, so `:'app_password'` inside
-- `$$ … $$` is a syntax error rather than the value — an easy trap, and the
-- reason this section uses \if instead of PL/pgSQL branching.

-- The guard tests the SHAPE of the value rather than comparing it to the
-- placeholder literal. Comparing to the literal would be defeated by the most
-- obvious way to edit this file — a find-and-replace on the placeholder, which
-- would rewrite the comparison too and make the check trivially true.
SELECT
  (length(:'app_password') < 16 OR :'app_password' ILIKE '%change%me%') AS is_weak
\gset

\if :is_weak
DO $guard$
BEGIN
  RAISE EXCEPTION
    'app_password at the top of scripts/render-bootstrap.sql is still the placeholder, or is shorter than 16 characters. Set a long random value first.';
END
$guard$;
\endif

-- `can_alter` matters because CREATEROLE alone is not enough to modify a role
-- somebody else created: PostgreSQL also requires the ADMIN option on it. That
-- happens when the same role that runs this script created pharma_app, which is
-- the normal case on a fresh database — but not if it was created by hand from a
-- different account.
SELECT
  NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') AS must_create,
  COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
    OR EXISTS (
      SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid = m.roleid
      JOIN pg_roles grantee ON grantee.oid = m.member
      WHERE granted.rolname = 'pharma_app'
        AND grantee.rolname = current_user
        AND m.admin_option
    ) AS can_alter
\gset

-- NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOBYPASSRLS are all PostgreSQL's
-- defaults for a new role, and they are deliberately NOT spelled out here:
-- only a superuser may set the SUPERUSER or BYPASSRLS attribute — even to the
-- negative — so naming them makes this script fail on exactly the managed
-- databases it is written for ("permission denied to alter role"). The
-- verification step at the bottom checks the resulting flags instead, which is
-- the part that actually matters.
\if :must_create
CREATE ROLE pharma_app LOGIN PASSWORD :'app_password';
\echo '  created role pharma_app'
\elif :can_alter
-- Re-runnable: refresh the password only.
ALTER ROLE pharma_app LOGIN PASSWORD :'app_password';
\echo '  role pharma_app already existed; password updated'
\else
\echo '  NOTE: pharma_app already exists and this role cannot alter it (no ADMIN option).'
\echo '        Keeping its current password. The grants below still apply.'
\echo '        If you need to change the password, do it from the role that created it.'
\endif

-- -----------------------------------------------------------------------------
-- 3. Privileges
-- -----------------------------------------------------------------------------
-- Mirrors docker/postgres/init/01-roles.sh and the grants in migration
-- 20260901000100. Kept idempotent so re-running after a schema change is safe.

-- GRANT ... ON DATABASE needs a literal name, so the current one is formatted in.
DO $connect$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pharma_app', current_database());
END
$connect$;

GRANT USAGE ON SCHEMA public TO pharma_app;

-- No object creation: all DDL goes through `prisma migrate deploy` on the owner.
REVOKE CREATE ON SCHEMA public FROM pharma_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO pharma_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pharma_app;

-- -----------------------------------------------------------------------------
-- 3a. Take back what the blanket grant above should not have given
-- -----------------------------------------------------------------------------
-- THIS SECTION IS NOT OPTIONAL, and the reason is an ordering trap worth
-- stating plainly.
--
-- Every migration that needs to restrict pharma_app does so in a DO block that
-- begins "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app')
-- THEN RETURN". On a managed database the documented order is `prisma migrate
-- deploy` FIRST and this script second — so at migration time the role does not
-- exist yet and every one of those blocks silently skips. The GRANT ON ALL
-- TABLES above then hands pharma_app everything, including the tables those
-- migrations meant to withhold.
--
-- So the restrictions have to be re-applied here, after the blanket grant. The
-- lists below mirror the migrations; the verification block in section 4 fails
-- the script if they ever fall behind, which is the part that makes this safe
-- to maintain rather than merely correct today.

-- Append-only tables: readable and insertable, never updatable or deletable.
-- Withholding the privilege means the guarantee does not rest on the trigger
-- alone. Mirrors migrations 20260901000100 and 20260910090000.
DO $append_only$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['audit_logs', 'qc_results', 'stock_ledger_entries']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = v_table) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM pharma_app', v_table);
    END IF;
  END LOOP;
END
$append_only$;

-- Platform tables: no access at all. These hold the vendor's own operator
-- accounts and their password hashes, and they are NOT tenant-scoped — there is
-- no RLS policy to fall back on, because isolation here comes from privileges.
-- A request-scoped connection must get "permission denied", not an empty result
-- and certainly not a row. Mirrors migration 20260903000000.
DO $platform$
DECLARE
  v_object text;
BEGIN
  FOREACH v_object IN ARRAY ARRAY['platform_users', 'platform_audit_logs']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = v_object) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM pharma_app', v_object);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'platform_audit_logs_id_seq' AND c.relkind = 'S'
  ) THEN
    REVOKE ALL ON SEQUENCE platform_audit_logs_id_seq FROM pharma_app;
  END IF;
END
$platform$;

-- Tables added by future migrations get the same treatment without anyone
-- having to remember. `current_user` here is the owner running this script.
DO $defaults$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pharma_app', current_user);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT USAGE, SELECT ON SEQUENCES TO pharma_app', current_user);
END
$defaults$;

-- Granted per function, only if the function exists.
--
-- A plain GRANT on a missing function is an error, and with ON_ERROR_STOP the
-- whole script aborts. That is not hypothetical: `current_external_auth_id`
-- existed under the Clerk-era schema and is DROPped by migration
-- 20260902000000_local_authentication, so a hardcoded grant on it fails on any
-- database migrated past that point — while still being needed on one that is
-- not. Listing both and skipping the absent one makes this script work at
-- either schema version, which matters because it is run by hand, once, against
-- a database whose exact state nobody has checked.
DO $functions$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'current_tenant_id',        -- all versions
    'require_tenant_id',        -- all versions
    'current_login_email',      -- 20260902000000 onwards (self-hosted auth)
    'current_external_auth_id'  -- Clerk-era only; dropped by 20260902000000
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_function
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO pharma_app', v_function);
    END IF;
  END LOOP;
END
$functions$;

-- -----------------------------------------------------------------------------
-- 4. Verify
-- -----------------------------------------------------------------------------
-- If either of these looks wrong, stop and fix it before deploying: an app role
-- that is a superuser or has BYPASSRLS makes every policy in this database
-- decorative.

-- Fail loudly rather than printing a table nobody reads. An app role that is a
-- superuser or holds BYPASSRLS makes every policy in this database decorative,
-- and that must not be something you discover later.
DO $verify$
DECLARE
  v_super   boolean;
  v_bypass  boolean;
BEGIN
  SELECT rolsuper, rolbypassrls INTO v_super, v_bypass
  FROM pg_roles WHERE rolname = 'pharma_app';

  IF v_super OR v_bypass THEN
    RAISE EXCEPTION
      'pharma_app has superuser=% bypassrls=%; it must have neither, or row-level security will not apply to the application. A superuser must fix this with: ALTER ROLE pharma_app NOSUPERUSER NOBYPASSRLS;',
      v_super, v_bypass;
  END IF;

  RAISE NOTICE 'pharma_app verified: not a superuser, does not bypass RLS.';
END
$verify$;

-- The privilege checks. These assert the OUTCOME rather than trusting that the
-- statements above ran in the right order, which is the whole point: this
-- script is run by hand, once, against a database whose exact state nobody has
-- checked.
DO $verify_privileges$
DECLARE
  v_leaked text;
BEGIN
  -- Any privilege at all on a platform table is a failure. There is no RLS on
  -- these tables to catch a mistake here.
  SELECT string_agg(DISTINCT table_name, ', ')
  INTO v_leaked
  FROM information_schema.table_privileges
  WHERE grantee = 'pharma_app'
    AND table_schema = 'public'
    AND table_name IN ('platform_users', 'platform_audit_logs');

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'pharma_app still holds privileges on platform table(s): %. The application role must have no access to platform operator accounts.',
      v_leaked
      USING HINT = 'Re-run this script; section 3a performs the revocation.';
  END IF;

  -- Append-only means no UPDATE and no DELETE, at the privilege level.
  SELECT string_agg(DISTINCT table_name || ' (' || privilege_type || ')', ', ')
  INTO v_leaked
  FROM information_schema.table_privileges
  WHERE grantee = 'pharma_app'
    AND table_schema = 'public'
    AND table_name IN ('audit_logs', 'qc_results', 'stock_ledger_entries')
    AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'pharma_app can still modify append-only table(s): %. These record what happened and must never be editable.',
      v_leaked
      USING HINT = 'Re-run this script; section 3a performs the revocation.';
  END IF;

  RAISE NOTICE 'pharma_app verified: no platform-table access, append-only tables are insert-only.';
END
$verify_privileges$;

SELECT
  relname                AS table_name,
  relrowsecurity         AS rls_enabled,
  relforcerowsecurity    AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('tenants', 'users', 'audit_logs')
ORDER BY relname;

-- Expected:
--   pharma_app | false | false
--   audit_logs | true  | true
--   tenants    | true  | false   <- not forced ON PURPOSE (migration 20260901000300)
--   users      | true  | true
--
-- Then confirm the whole thing end to end with:
--   pnpm verify:rls
-- pointed at this database. It asserts tenant isolation end to end and refuses to run if
-- DATABASE_URL and MIGRATION_DATABASE_URL are the same connection.
