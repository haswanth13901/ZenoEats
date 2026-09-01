# ZenoEats — Setup & Deployment

## 1. Prerequisites

- Node.js 20+
- Accounts: Supabase, Stripe, Twilio, Google Cloud (Maps Platform), Vercel, GitHub

## 2. Local setup

```bash
npm install
cp .env.example .env.local   # fill in your keys
```

Run the schema: open your Supabase project → SQL Editor → paste `supabase/schema.sql` → Run.

**Existing projects:** `schema.sql` is idempotent, so re-running the whole file
is safe and applies everything. If you would rather review just the security
changes, run `supabase/migrations/0001_harden_rls.sql` instead — it is the
delta only (RLS policies, the definer helpers, the profile trigger), with
verification queries at the bottom.

Create your first admin: sign a user up (via Supabase Auth), then in the SQL
editor promote them:
```sql
update profiles set role = 'admin', full_name = 'Owner'
where id = '<auth-user-uuid>';
```
An `on_auth_user_created` trigger already inserts the `profiles` row for every
new user (defaulting to `driver`), so this is an update, not an insert — an
insert would conflict on the primary key.

### Turn off public sign-ups

By default a Supabase project accepts sign-ups from anyone. Because
`handle_new_user` gives every new account the `driver` role, that means a
stranger can create a signed-in account in your app — they see nothing (RLS
gives a driver with no assigned orders no data at all), but they are past the
front door, and unconfirmed sign-ups still create `profiles` rows.

Turn it off in **Authentication → Sign In / Providers → Email → "Allow new
users to sign up"**.

Verify with:
```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings"   -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```
`disable_signup` must be `true`.

### Adding staff once sign-ups are off

Self-registration is gone, so you create staff accounts yourself:

1. **Authentication → Users → Add user** (tick "Auto Confirm User", or they
   will never be able to sign in without a confirmation email).
2. The `on_auth_user_created` trigger creates their `profiles` row as a
   `driver` — which is all a delivery driver needs.
3. To make someone an admin, promote them:
   ```sql
   update profiles set role = 'admin', full_name = 'Their Name'
   where id = '<auth-user-uuid>';
   ```

Drivers only see an order once an admin assigns it to them on
**/admin/orders** — `driver_id` is what the RLS policies key off, so assigning
is what grants access, not a label.

Start the dev server:
```bash
npm run dev
```

## 3. External service notes

- **Stripe** — use test keys now. Add a webhook endpoint pointing to
  `https://<your-domain>/api/webhooks/stripe` and copy the signing secret into
  `STRIPE_WEBHOOK_SECRET`.

  Subscribe the endpoint to **all three** of these events. Stripe does not send
  event types you have not selected, so an unsubscribed type means that code
  path never runs:

  | Event | What it does |
  |---|---|
  | `checkout.session.completed` | Marks the order paid, sends the tracking SMS |
  | `checkout.session.async_payment_succeeded` | Same, for bank debits that settle later |
  | `checkout.session.expired` | Cancels the abandoned order (~24h after checkout) |

  **Locally you do not need a dashboard endpoint at all.** The Stripe CLI
  forwards every event type, so none of the above applies until you deploy:

  ```bash
  # No `stripe login` needed — authenticate with the test key directly:
  stripe listen --api-key "$STRIPE_SECRET_KEY"     --forward-to localhost:3000/api/webhooks/stripe
  ```

  It prints its own `whsec_...`, **different from the dashboard's**. That is the
  one that goes in `.env.local` while developing — using the dashboard secret
  with CLI forwarding is the usual reason signature verification fails.

  Fire a test event from a second terminal:
  ```bash
  stripe trigger checkout.session.completed --api-key "$STRIPE_SECRET_KEY"
  ```
  Expect `[200]` in the listen output. The triggered fixture has no
  `order_id` metadata, so the webhook correctly refuses it and records a
  `missing_order_metadata` alert — visible at /admin/alerts. That is the
  alerting path working, not a fault.

  One gotcha: in `next dev` the first request to an uncompiled route can arrive
  with an empty body while the route compiles, which surfaces as
  "No webhook payload was provided". Hit the route once, or re-trigger after
  it has compiled.
- **Twilio** — trial mode only sends to verified numbers. For real US business
  SMS you must complete **A2P 10DLC** brand + campaign registration (allow several
  days). Start this early.
- **Google Maps** — enable Maps JavaScript API and Directions API; restrict the
  key to your domain.

## 4. Branch strategy (MNC standard)

| Branch | Role | Deploy |
|--------|------|--------|
| `main` | Production | Vercel production |
| `dev`  | Default / staging | Vercel preview |
| `feature/*` | Feature work → PR into `dev` | PR preview |

Set `dev` as the **default** branch on GitHub, and protect `main` (require PR + passing CI).

## 5. CI/CD

- `.github/workflows/ci.yml` — lint, type-check, build on every PR/push to `dev`/`main`.
- `.github/workflows/deploy.yml` — **manual only** (Actions tab → Deploy → Run
  workflow), targeting staging or production. Auto-deploy on push is
  deliberately off while the app is still being built.

Required GitHub secrets (Repo → Settings → Secrets → Actions):
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

Set per-environment secrets under **Environments** (`staging`, `production`) so
each deploy target gets its own Supabase/Stripe/Twilio keys.

## 6. Going to production checklist

- [ ] Swap Stripe test keys → live keys (after business verification)
- [ ] Complete Twilio A2P 10DLC registration
- [ ] Verify webhook signature secret is set in production env
- [ ] Audit RLS policies against real admin/driver accounts
- [ ] Restrict Google Maps API key to production domain
- [ ] Run `npm audit` — expect 0 vulnerabilities
- [ ] Protect `main`, require CI to pass before merge
