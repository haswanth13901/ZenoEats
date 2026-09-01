# ZenoEats — Security & Correctness Audit

Branch `dev`, commit `db95e87`. Findings are ordered by severity; IDs are
referenced by later phases and by commit messages.

## Status

All 15 findings are addressed in code as of `177a4c0`, and the SQL half was
applied to the production project on 2026-09-01 via
`supabase/migrations/0001_harden_rls.sql` (psql, single transaction, exit 0).

| ID | Fixed in | Live now? |
|---|---|---|
| F1 client-side pricing | `d849089` | Yes |
| F2 webhook replay / amount | `d849089` | Yes (Redis dedupe still to come in Phase 4) |
| F3 world-readable orders | `4e933c3` | Yes — applied & verified |
| F4 admin login lockout | `fd6a954` | Yes |
| F5 anon location writes | `4e933c3` | Yes — applied & verified |
| F6 fake `requireAdmin` | `fd6a954` | Yes |
| F7 post-payment 404 | `177a4c0` | Yes |
| F8 mutable `search_path` | `4e933c3` | Yes — applied & verified |
| F9 no input validation | `d849089` | Yes, on `/api/checkout` |
| F10 ignored insert result | `d849089` | Yes |
| F11 unguarded `/driver` | `fd6a954` | Yes |
| F12 unpaid orders in queue | `177a4c0` | Yes |
| F13 no profile bootstrap | `4e933c3` | Yes — applied & verified |
| F14 middleware on the webhook | `fd6a954` | Yes |
| F15 raw error logging | `d849089` | Yes |

Application code is verified by type-check, lint and `next build` only.
Behavioural proof — that a forged price is ignored, that a replayed webhook
event is a no-op — arrives with the Phase 2 test suite.

The RLS changes were verified against the live project by re-running the
attack:

| anon-key request | before | after |
|---|---|---|
| `select * from orders` | 5 rows, 5 phone numbers | 0 rows |
| `select * from order_items` | readable | 0 rows |
| `select * from driver_locations` | readable | 0 rows |
| `insert into driver_locations` | permitted (F5) | HTTP 401 |
| `insert into menu_items` | 401 | 401 |
| `patch orders set paid` | — | 204, 0 rows changed (verified against the table) |

Public reads that the anonymous ordering flow depends on — `menu_items`,
`places`, `restaurants` — still return rows. Row counts were unchanged by the
migration, and one admin profile remains.

The finding text below is left as originally written, describing the code as it
was at `db95e87`.

---

## 1. Auth model as built

| Actor | Mechanism | Enforced where |
|---|---|---|
| Customer | **None** — anonymous | Public-read RLS policies on `restaurants`, `places`, `menu_items` |
| Admin | Supabase Auth email/password, cookie session (`@supabase/ssr`) | `src/middleware.ts` (authenticated?) + `src/app/admin/layout.tsx` (role = admin?) + `is_admin()` RLS |
| Driver | Supabase Auth, same session | **Nowhere.** `/driver` has no guard at all |
| Server → DB (money path) | Service-role key, bypasses RLS entirely | `src/lib/supabase-admin.ts`, used by `/api/checkout` and the Stripe webhook |

Three distinct Supabase clients exist and the split is correct in principle:
browser (anon), server-with-user-cookies (anon + RLS), and admin (service role,
RLS bypassed). The service-role client is only imported by the two API routes —
verified, it does not leak into any client component.

Middleware guards `/admin/*` for *authentication only*; the admin/driver **role**
distinction is made one layer later, in the admin layout, which reads `profiles.role`.

## 2. Data flow: QR → menu → checkout → webhook → order

1. **QR** encodes `{origin}/menu?place={place_id}` (`PlaceQR.tsx`).
2. **Menu** (`/menu` server component) loads the place, its restaurant, and its
   available `menu_items` using the *anon* server client — relies on the three
   `using (true)` public-read policies. No auth needed, correct for the use case.
3. **Cart** lives entirely in client state in `MenuOrder.tsx`.
4. **Checkout** POSTs `{place_id, restaurant_id, phone, items[]}` to
   `/api/checkout`. The route uses the **service-role** client to insert an
   `orders` row (`status: 'placed'`, `paid: false`), then `order_items`, then
   creates a Stripe Checkout Session, then writes `stripe_session_id` back.
   `metadata.order_id` carries the link to Stripe.
5. **Stripe** redirects the customer to `${APP_URL}/track/${order_id}`.
6. **Webhook** `/api/webhooks/stripe` verifies the signature, and on
   `checkout.session.completed` sets `paid = true, status = 'preparing'` and
   fires a Twilio SMS with the tracking link.

## 3. RLS policy inventory

| Table | Policy | Effect |
|---|---|---|
| `restaurants` / `places` / `menu_items` | `select using (true)` | Anyone incl. anon can read. **Intended.** |
| `restaurants` / `places` / `menu_items` | `for all using (is_admin())` | Admin write. Correct. |
| `orders` | `select using (true)` | **Anyone can read every order.** See F3. |
| `orders` | `for all using (is_admin())` | Admin manage. Correct. |
| `orders` | `update using (driver_id = auth.uid())` | Driver updates own deliveries. Correct. |
| `order_items` | `select using (true)` | **World-readable.** See F3. |
| `driver_locations` | `select using (true)` | World-readable (tracking page). Acceptable. |
| `driver_locations` | `for all using (...) with check (true)` | **`with check (true)` lets anyone INSERT.** See F5. |
| `profiles` | `select using (id = auth.uid() or is_admin())` | See F4 — interacts badly with the login page. |

No policy anywhere carries a `to authenticated` clause, so every policy applies to
the `public` role, i.e. the anon key.

---

## Findings

### F1 — CRITICAL: prices are taken from the client
`src/app/api/checkout/route.ts:20-23` and `:55-62`

Both the stored `total_cents` and the Stripe `line_items[].unit_amount` are read
straight out of the request body. A crafted POST with `price_cents: 1` buys any
order for one cent, and the DB records that as the legitimate total. Nothing
re-reads `menu_items.price_cents` server-side.

Also unverified: that each `menu_item_id` exists, belongs to `restaurant_id`, and
is `is_available`; that `place_id` belongs to `restaurant_id`; that `quantity` is
a positive integer.

### F2 — CRITICAL: webhook has no idempotency and no amount check
`src/app/api/webhooks/stripe/route.ts:29-55`

- A replayed event (Stripe retries on any non-2xx, and events are replayable from
  the dashboard) re-runs the update and **re-sends the SMS**.
- `session.amount_total` is never compared against `orders.total_cents`.
- `session.payment_status` is never checked. `checkout.session.completed` fires
  for async payment methods while still `unpaid`, so the order is marked paid
  before money has moved.
- The `orders` update result is discarded — a failed write still returns 200 and
  Stripe never retries.

### F3 — CRITICAL: every order and line item is publicly readable
`supabase/schema.sql:142-153`

`create policy "read orders" on orders for select using (true)` combined with the
anon key (which is public by design, shipped to every browser) means anyone can
`select * from orders` and dump the entire table, including `customer_phone`.
The comment claims the order UUID acts as an unguessable token, but nothing
constrains the query to a single id. Same for `order_items`. This is a PII breach,
not a theoretical one.

### F4 — HIGH: admin login breaks as soon as a second profile exists
`src/app/admin/login/page.tsx:31-34`

```ts
const { data: profile } = await supabase.from("profiles").select("role").single();
```

There is no `.eq("id", user.id)`. The `profiles` select policy is
`id = auth.uid() or is_admin()` — so for an **admin** the policy returns *all*
profile rows, `.single()` errors on multiple rows, `profile` comes back null, and
the admin is signed out with "This account isn't an admin." Works today only
because there is one profile row. Non-admins are unaffected (they see one row).

### F5 — HIGH: anyone can write driver locations
`supabase/schema.sql:159-163`

`for all ... using (...) with check (true)`. For `INSERT`, Postgres evaluates
only `WITH CHECK` — the `USING` clause is not consulted. `with check (true)` on a
policy with no `to` clause therefore lets **anon** insert a `driver_locations` row
for any order, spoofing a driver's position on the customer tracking map.

### F6 — HIGH: `requireAdmin()` does not check for admin
`src/app/admin/actions.ts:8-15`

It checks authentication only. Any logged-in user — including a driver — can
invoke `saveMenuItem`, `deleteMenuItem`, `savePlace`, `deletePlace`. The RLS
`is_admin()` policies do block the write at the database, so this is not currently
exploitable for data change, but:

- every action **discards the Supabase error** (no `if (error)` anywhere), so a
  blocked delete returns a silent success and `revalidatePath` re-renders as if it
  worked. Failures are invisible to admins too.
- the function's name asserts a guarantee it does not provide.

### F7 — HIGH: post-payment redirect and SMS link both 404
`route.ts:64`, `twilio.ts`, `src/app/track/`

`success_url` is `${APP_URL}/track/${order.id}` and the SMS carries the same URL,
but only a static `src/app/track/page.tsx` exists — there is no `track/[id]`
route. Every paying customer lands on a 404 immediately after paying.

### F8 — MEDIUM: `is_admin()` is SECURITY DEFINER without a pinned search_path
`supabase/schema.sql:114-118`

A `security definer` function with a mutable `search_path` is the standard
Postgres privilege-escalation vector: a caller who can create objects in an
earlier schema can shadow `profiles`. Needs
`set search_path = public, pg_temp`, and should be `stable`.

### F9 — MEDIUM: no input validation anywhere
`/api/checkout` accepts whatever JSON is sent. `phone` is unvalidated and flows to
Twilio and the DB. `items` is only checked for `Array.isArray` and non-empty; the
elements are never type-checked, so `quantity: -5` or `price_cents: NaN` reaches
the arithmetic and Stripe. This is Phase 5 work but it is also the delivery
vehicle for F1.

### F10 — MEDIUM: `order_items` insert result is ignored
`route.ts:42-50`

If the line-item insert fails, execution continues, Stripe collects payment, and
the order exists with zero line items — the kitchen sees an order with no food on it.

### F11 — MEDIUM: `/driver` has no auth guard
Middleware only matches `/admin`. The page is a stub today, but the route and the
`driver_locations` write path are the obvious next build, and F5 already exposes it.

### F12 — LOW: unpaid orders pollute the admin queue
The order row is inserted with `status: 'placed'` *before* payment. Abandoned
checkouts leave permanent unpaid `placed` rows, which the overview counts as
"open orders" (`admin/page.tsx:18-22`). A distinct pre-payment status, or a
`paid = true` filter on the queue, is needed.

### F13 — LOW: no `profiles` row is ever created
There is no insert policy and no trigger on `auth.users`. A newly created Supabase
user has no `profiles` row, so `role` is undefined and they can never be admin
without a manual SQL insert. Incomplete rather than insecure.

### F14 — LOW: middleware runs on every request including the webhook
The matcher excludes only static assets, so `supabase.auth.getUser()` — a network
round-trip to Supabase — runs on `/api/webhooks/stripe` and `/api/checkout` too.
Pure latency on the money path.

### F15 — LOW: raw error objects logged
`route.ts:75` `console.error(e)` dumps whatever was thrown. No secret is logged
today, but Stripe error objects carry request context and this is the shape of
mistake that leaks one later.

---

## Not found (checked, clean)

- No secrets are committed. `.env.example` holds placeholders only; `.env.local`
  is untracked and correctly gitignored.
- `supabase-admin.ts` (service role) is not reachable from any client component.
- Stripe signature verification itself is implemented correctly, against the raw
  body (`req.text()`), and returns 400 on failure.
- The `orders` table has no anon INSERT policy — order creation is service-role
  only, which is right.
- `order_items.quantity > 0` and `menu_items.price_cents >= 0` check constraints
  exist at the DB level.
