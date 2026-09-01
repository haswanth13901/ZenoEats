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

Create your first admin: sign a user up (via Supabase Auth), then in the SQL editor:
```sql
insert into profiles (id, role, full_name)
values ('<auth-user-uuid>', 'admin', 'Owner');
```

Start the dev server:
```bash
npm run dev
```

## 3. External service notes

- **Stripe** — use test keys now. Add a webhook endpoint pointing to
  `https://<your-domain>/api/webhooks/stripe` for the `checkout.session.completed`
  event, and copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
  For local testing use the Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
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
- `.github/workflows/deploy.yml` — deploys `dev` → staging, `main` → production.

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
