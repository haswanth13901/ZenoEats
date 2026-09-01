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
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer;

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

-- Orders: customers can read a single order by id (tracking page uses anon key
-- + the order UUID as an unguessable token). Admins & assigned drivers manage.
drop policy if exists "read orders" on orders;
create policy "read orders" on orders for select using (true);

drop policy if exists "admin manage orders" on orders;
create policy "admin manage orders" on orders for all using (is_admin()) with check (is_admin());

drop policy if exists "driver update assigned orders" on orders;
create policy "driver update assigned orders" on orders for update
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists "read order items" on order_items;
create policy "read order items" on order_items for select using (true);

-- Driver locations: public read (tracking page), driver/admin write.
drop policy if exists "read driver locations" on driver_locations;
create policy "read driver locations" on driver_locations for select using (true);

drop policy if exists "driver write locations" on driver_locations;
create policy "driver write locations" on driver_locations for all
  using (is_admin() or exists (
    select 1 from orders o where o.id = order_id and o.driver_id = auth.uid()
  )) with check (true);

drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select using (id = auth.uid() or is_admin());

-- ============================================================
-- Realtime: broadcast changes on these tables
-- ============================================================
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table driver_locations;
