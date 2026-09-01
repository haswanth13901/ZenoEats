-- ============================================================
-- 0001 — RLS hardening
--
-- Applies findings F3, F5, F8 and F13 from docs/AUDIT.md to a project that
-- already has the schema. This is the delta only: no table DDL, nothing
-- destructive to data. Safe to re-run.
--
-- Equivalent to re-running the whole of supabase/schema.sql, which is also
-- idempotent — this file exists so the change can be reviewed on its own.
--
-- Run in: Supabase dashboard → SQL Editor → paste → Run.
-- Verification queries are at the bottom, commented out.
-- ============================================================

begin;

-- ---------- F8: pin search_path on the definer helper ----------
-- A security-definer function with a mutable search_path can be hijacked by
-- shadowing `profiles` in an earlier schema.
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer set search_path = public, pg_temp;

create or replace function is_order_driver(target_order uuid) returns boolean as $$
  select exists (
    select 1 from orders o where o.id = target_order and o.driver_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public, pg_temp;

-- ---------- F3: no public reads of orders, items or locations ----------
-- RLS filters rows, not query shape. `using (true)` meant the anon key —
-- which ships to every browser — could select the entire orders table,
-- customer phone numbers included. The tracking page now reads its single
-- order server-side with the service-role key instead.
drop policy if exists "read orders" on orders;
drop policy if exists "read order items" on order_items;
drop policy if exists "read driver locations" on driver_locations;

drop policy if exists "admin manage orders" on orders;
create policy "admin manage orders" on orders for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "driver read assigned orders" on orders;
create policy "driver read assigned orders" on orders for select
  to authenticated using (driver_id = auth.uid());

drop policy if exists "driver update assigned orders" on orders;
create policy "driver update assigned orders" on orders for update
  to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists "admin read order items" on order_items;
create policy "admin read order items" on order_items for select
  to authenticated using (is_admin() or is_order_driver(order_id));

drop policy if exists "staff read driver locations" on driver_locations;
create policy "staff read driver locations" on driver_locations for select
  to authenticated using (is_admin() or is_order_driver(order_id));

-- ---------- F5: constrain the location write policy ----------
-- The old policy had `with check (true)`. INSERT consults only WITH CHECK,
-- never USING, so the driver guard did not apply to the one command that
-- mattered: anyone could insert a position for any order.
drop policy if exists "driver write locations" on driver_locations;
create policy "driver write locations" on driver_locations for all
  to authenticated
  using (is_admin() or is_order_driver(order_id))
  with check (is_admin() or is_order_driver(order_id));

-- ---------- profiles ----------
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select
  to authenticated using (id = auth.uid() or is_admin());

drop policy if exists "admin manage profiles" on profiles;
create policy "admin manage profiles" on profiles for all
  to authenticated using (is_admin()) with check (is_admin());

-- ---------- F13: every auth user gets a profile row ----------
-- Without this a new user has no row, so `role` is null and they can never be
-- granted access without a manual INSERT. New users land as 'driver' (the
-- column default); promotion to admin stays deliberate.
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill: the trigger only fires for new users. Anyone who signed up before
-- this migration still has no profile row.
insert into public.profiles (id, full_name)
select u.id, u.raw_user_meta_data->>'full_name'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

commit;

-- ============================================================
-- Verification — run these separately after the migration.
-- ============================================================

-- 1. No policy should grant anon (or public) SELECT on these tables.
--    Expect: zero rows.
--
-- select tablename, policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('orders', 'order_items', 'driver_locations')
--   and cmd in ('SELECT', 'ALL')
--   and ('anon' = any(roles) or 'public' = any(roles));

-- 2. Every auth user now has a profile. Expect: zero rows.
--
-- select u.id, u.email
-- from auth.users u
-- left join public.profiles p on p.id = u.id
-- where p.id is null;

-- 3. Confirm you still have exactly the admin(s) you expect.
--
-- select p.id, u.email, p.role from profiles p join auth.users u on u.id = p.id;

-- 4. The real test: from a client holding ONLY the anon key, run
--    `select * from orders`. Before this migration it returned every row;
--    after, it must return none.
