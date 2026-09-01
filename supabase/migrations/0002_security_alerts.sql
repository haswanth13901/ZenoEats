-- ============================================================
-- 0002 — security alerts
--
-- Gives the Stripe webhook somewhere durable to report anomalies. Previously
-- an amount mismatch — the signal that a checkout session was not created by
-- this app — was a console.error and an HTTP 200: correct for Stripe's retry
-- behaviour, invisible to the operator.
--
-- Written by the webhook using the service-role key, which bypasses RLS, so
-- this table needs read/update policies only. Nothing anonymous touches it.
--
-- Run in: Supabase dashboard → SQL Editor, or psql -f.
-- ============================================================

begin;

create table if not exists security_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,               -- e.g. 'amount_mismatch', 'order_not_found'
  order_id uuid,                    -- deliberately no FK: the order may not exist
  stripe_event_id text,
  detail jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- The dashboard query is "unacknowledged, newest first".
create index if not exists security_alerts_open_idx
  on security_alerts (created_at desc)
  where acknowledged_at is null;

-- One alert per (event, kind): Stripe retries a failed webhook, and a replayed
-- tampering attempt should not become fifty identical rows.
create unique index if not exists security_alerts_event_kind_idx
  on security_alerts (stripe_event_id, kind)
  where stripe_event_id is not null;

alter table security_alerts enable row level security;

drop policy if exists "admin read alerts" on security_alerts;
create policy "admin read alerts" on security_alerts for select
  to authenticated using (is_admin());

drop policy if exists "admin ack alerts" on security_alerts;
create policy "admin ack alerts" on security_alerts for update
  to authenticated using (is_admin()) with check (is_admin());

commit;

-- ============================================================
-- Verification
-- ============================================================
-- select tablename, policyname, roles::text, cmd
-- from pg_policies where tablename = 'security_alerts';
--
-- Anon must see nothing:
--   curl "$URL/rest/v1/security_alerts?select=id" -H "apikey: $ANON" → []
