-- =============================================================================
-- Resolve a signed-in identity in ONE round trip
-- =============================================================================
-- Every authenticated request re-reads the account from Postgres. That is a
-- deliberate security property, not an oversight: the token's claims are frozen
-- at issue, so role, status and the must-change-password flag have to come from
-- the database if disabling a user is to take effect on their very next
-- request. None of that is in question here.
--
-- What is in question is the COST. The lookup ran as a Prisma interactive
-- transaction:
--
--     BEGIN                                     -- round trip 1
--     SELECT set_config('app.current_tenant_id', $1, true)   -- round trip 2
--     SELECT ... FROM users JOIN tenants ...    -- round trip 3
--     COMMIT                                    -- round trip 4
--
-- Four round trips before the handler has run a single query of its own. On a
-- developer machine that is 4 ms and invisible. Against the hosted database in
-- Oregon it is measured at 1.2-1.9 SECONDS per request, and a screen that reads
-- three things pays it three times — which is the whole of the "why is changing
-- tabs so slow" complaint.
--
-- This function collapses the four into one. A single statement is its own
-- implicit transaction, so `set_config(..., is_local := true)` is scoped to
-- exactly this call and the tenant setting cannot leak onto the next request
-- that borrows the same pooled connection. That is strictly SAFER than the
-- explicit transaction it replaces, not merely faster.
--
-- SECURITY INVOKER (the default, stated anyway) is the point of the whole
-- design: row-level security still evaluates as the runtime role, and
-- current_tenant_id() returns the value set on the line above. The explicit
-- tenant_id predicate stays too — the token naming another company's user id
-- must not resolve even if a policy were ever loosened.
--
-- VOLATILE, not STABLE: it calls set_config, which changes transaction state.
-- Marking it STABLE would invite the planner to cache or reorder a call that
-- has a side effect the rest of the query depends on.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_identity(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (
  user_id              uuid,
  tenant_id            uuid,
  email                varchar,
  full_name            varchar,
  role                 text,
  status               text,
  must_change_password boolean,
  tenant_name          varchar,
  tenant_slug          varchar,
  tenant_status        text
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  -- Local to this statement's implicit transaction. Every RLS policy below
  -- reads it through public.current_tenant_id().
  PERFORM set_config('app.current_tenant_id', p_tenant_id::text, true);

  RETURN QUERY
  SELECT
    u.id,
    u.tenant_id,
    u.email,
    u.full_name,
    u.role::text,
    u.status::text,
    u.must_change_password,
    t.name,
    t.slug,
    t.status::text
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.id = p_user_id
    AND u.tenant_id = p_tenant_id
    AND u.deleted_at IS NULL
    AND t.deleted_at IS NULL;
END;
$fn$;

COMMENT ON FUNCTION public.resolve_identity(uuid, uuid) IS
  'The per-request identity lookup, in one round trip. Sets the tenant for the duration of this statement, then reads the account under row-level security as the calling role. Returns no rows for a deleted account or a deleted company.';

-- The runtime role has to be able to call it. Guarded the same way as the other
-- grant blocks: a database built without the least-privilege role (a developer
-- machine running everything as the owner) simply skips this.
DO $grants$
DECLARE
  v_role text := 'pharma_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping the execute grant.', v_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT EXECUTE ON FUNCTION public.resolve_identity(uuid, uuid) TO %I', v_role);
END
$grants$;
