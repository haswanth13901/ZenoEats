import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key.
 * NEVER import this into a client component.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
