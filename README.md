# ZenoEats 🍽️

QR-based restaurant ordering and live delivery tracking platform.

Customers scan a QR code at a delivery location, browse the menu, pay via Stripe, receive an SMS with a tracking link, and watch their order's live status and driver location in real time.

## Features

- **Admin dashboard** — add your restaurant, menu items, and delivery places; generate a QR code per place; manage incoming orders.
- **QR ordering** — each delivery place has a unique QR encoding its `place_id`; scanning opens the menu with the destination pre-set.
- **Stripe Checkout** — hosted payment, webhook-driven order confirmation.
- **SMS notifications** — Twilio sends the tracking link on successful payment.
- **Live tracking** — order status (`placed → preparing → ready → out_for_delivery → delivered`) plus live driver location on a Google Map, streamed over Supabase Realtime.
- **Driver view** — drivers update status and stream GPS location.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router) + React |
| Styling | Tailwind CSS |
| Database / Auth / Realtime / Storage | Supabase (PostgreSQL) |
| Payments | Stripe Checkout + webhooks |
| SMS | Twilio |
| Maps | Google Maps Platform |
| QR generation | `qrcode` |
| Hosting | Vercel |
| CI/CD | GitHub Actions → Vercel |

## Branch Strategy (MNC standard)

| Branch | Role | Deploys to |
|--------|------|------------|
| `main` | Production | Vercel production |
| `dev`  | Default / integration | Vercel preview (staging) |
| `feature/*` | Feature work | PR preview builds |

- `dev` is the **default** branch — all feature branches merge into `dev` via PR.
- `main` is **protected** — only release PRs from `dev` merge into it, triggering production deploy.
- CI (lint + type-check + build) runs on every PR to `dev` and `main`.

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your keys
cp .env.example .env.local

# 3. Set up the database
#    Run supabase/schema.sql in your Supabase project SQL editor

# 4. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

See [`.env.example`](./.env.example) for the full list. You'll need accounts with Supabase, Stripe, Twilio, and Google Maps Platform.

## Project Structure

```
src/
  app/
    admin/     Admin dashboard (protected)
    api/       API routes (webhooks, orders, sms)
    menu/      Customer ordering flow
    track/     Live order tracking page
    driver/    Driver location + status view
  components/   Shared UI components
  lib/          Clients (supabase, stripe, twilio) + helpers
  types/        Shared TypeScript types
supabase/
  schema.sql   Database schema + RLS policies
```

## License

[MIT](./LICENSE) © 2026 ZenoEats
