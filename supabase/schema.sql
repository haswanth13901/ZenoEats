-- ============================================================
-- ZenoEats database schema
-- Run in Supabase SQL editor. Idempotent where practical.
-- ============================================================

-- ---------- Enums ----------
do $$ begin
  create type order_status as enum (
    'placed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('admin', 'driver');
exception when duplicate_object then null; end $$;

-- ---------- Profiles (roles for admins/drivers) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'driver',
  full_name text,
  created_at timestamptz not null default now()
);

-- ---------- Restaurants ----------
create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  logo_url text,
  origin_lat double precision,   -- kitchen location, route start
  origin_lng double precision,
  created_at timestamptz not null default now()
);

-- ---------- Places (delivery destinations; each gets a QR) ----------
create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,           -- e.g. "Building C Lobby", "Room 204"
  address text,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

-- ---------- Menu items ----------
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  photo_url text,
  category text,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Orders ----------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  place_id uuid not null references places(id),
  driver_id uuid references profiles(id),
  status order_status not null default 'placed',
  customer_phone text,
  total_cents integer not null default 0,
  stripe_session_id text,
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Order line items ----------
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id),
  name text not null,           -- snapshot at order time
  price_cents integer not null,
  quantity integer not null check (quantity > 0)
);

-- ---------- Live driver locations ----------
create table if not exists driver_locations (
  order_id uuid primary key references orders(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

-- ---------- updated_at trigger for orders ----------
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table restaurants     enable row level security;
alter table places          enable row level security;
alter table menu_items      enable row level security;
alter table orders          enable row level security;
alter table order_items     enable row level security;
alter table driver_locations enable row level security;
alter table profiles        enable row level security;

-- Helper: is the current user an admin?
-- security definer so it can read profiles regardless of the caller's own
-- policies. search_path is pinned: a definer function with a mutable
-- search_path can be hijacked by shadowing `profiles` in an earlier schema.
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer set search_path = public, pg_temp;

-- Helper: is the current user the driver assigned to this order?
create or replace function is_order_driver(target_order uuid) returns boolean as $$
  select exists (
    select 1 from orders o where o.id = target_order and o.driver_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public, pg_temp;

-- Public read: menu, restaurants, places (customers aren't logged in).
drop policy if exists "public read restaurants" on restaurants;
create policy "public read restaurants" on restaurants for select using (true);

drop policy if exists "public read places" on places;
create policy "public read places" on places for select using (true);

drop policy if exists "public read menu" on menu_items;
create policy "public read menu" on menu_items for select using (true);

-- Admin full control on core tables.
drop policy if exists "admin manage restaurants" on restaurants;
create policy "admin manage restaurants" on restaurants for all using (is_admin()) with check (is_admin());

drop policy if exists "admin manage places" on places;
create policy "admin manage places" on places for all using (is_admin()) with check (is_admin());

drop policy if exists "admin manage menu" on menu_items;
create policy "admin manage menu" on menu_items for all using (is_admin()) with check (is_admin());

-- Orders.
--
-- There is deliberately NO public select policy. The previous
-- `using (true)` was justified as "the order UUID is an unguessable token",
-- but RLS filters rows, not query shape: with the anon key (which ships to
-- every browser) `select * from orders` returned the whole table, customer
-- phone numbers included. A row-level policy cannot express "only if you
-- already know the id".
--
-- The customer tracking page therefore reads a single order server-side with
-- the service-role key, keyed by the UUID in the URL. If anon Realtime on
-- orders is needed later, add a per-order signed token or a security-definer
-- RPC that takes the order id — do not restore a blanket select policy.
drop policy if exists "read orders" on orders;

drop policy if exists "admin manage orders" on orders;
create policy "admin manage orders" on orders for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "driver read assigned orders" on orders;
create policy "driver read assigned orders" on orders for select
  to authenticated using (driver_id = auth.uid());

drop policy if exists "driver update assigned orders" on orders;
create policy "driver update assigned orders" on orders for update
  to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- Order items follow their order: no public read, same reasoning as above.
drop policy if exists "read order items" on order_items;

drop policy if exists "admin read order items" on order_items;
create policy "admin read order items" on order_items for select
  to authenticated using (is_admin() or is_order_driver(order_id));

-- Driver locations. Public read is gone for the same reason: it exposed live
-- courier positions for every active order. The tracking page reads these
-- server-side alongside the order.
drop policy if exists "read driver locations" on driver_locations;

drop policy if exists "staff read driver locations" on driver_locations;
create policy "staff read driver locations" on driver_locations for select
  to authenticated using (is_admin() or is_order_driver(order_id));

-- `with check (true)` on the old policy let ANYONE insert a location for any
-- order: INSERT consults only WITH CHECK, never USING, so the guard did not
-- apply to the one command that mattered. Both clauses are constrained now.
drop policy if exists "driver write locations" on driver_locations;
create policy "driver write locations" on driver_locations for all
  to authenticated
  using (is_admin() or is_order_driver(order_id))
  with check (is_admin() or is_order_driver(order_id));

drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select
  to authenticated using (id = auth.uid() or is_admin());

drop policy if exists "admin manage profiles" on profiles;
create policy "admin manage profiles" on profiles for all
  to authenticated using (is_admin()) with check (is_admin());

-- ---------- Profile bootstrap ----------
-- Without this, a newly created auth user has no profiles row, so `role` is
-- null and they can never be granted access without a manual INSERT. New
-- users land as 'driver' (the column default); promoting to admin stays a
-- deliberate act. Public signups should be disabled in Supabase Auth unless
-- you actually want self-serve driver accounts.
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

-- ============================================================
-- Realtime: broadcast changes on these tables
-- ============================================================
-- Realtime still respects RLS, so these now reach admins and the assigned
-- driver only. Anonymous customers get their updates from the server-rendered
-- tracking page rather than a direct subscription.
do $$ begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table driver_locations;
exception when duplicate_object then null; end $$;
