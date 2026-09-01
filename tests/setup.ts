/**
 * Test environment defaults.
 *
 * These are deliberately fake. No test in this suite may reach Stripe, Twilio
 * or Supabase over the network — the external clients are mocked per-file, and
 * these values exist only so modules that read process.env at import time
 * don't throw.
 *
 * The one exception is tests/rls/, which talks to a real Supabase project on
 * purpose (RLS cannot be meaningfully faked). Those tests load real values
 * from .env.local themselves and skip entirely when it isn't present.
 */
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";

// Real signature verification runs against this in the webhook tests: the
// suite signs its own payloads, so the value only has to be consistent.
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_secret_for_signing_only";

// Left unset on purpose. sendTrackingSms returns null when Twilio isn't
// configured, which is the behaviour the webhook tests rely on.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_PHONE_NUMBER;
