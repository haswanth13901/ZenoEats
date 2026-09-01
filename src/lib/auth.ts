import { createServerSupabase } from "@/lib/supabase-server";

export type UserRole = "admin" | "driver";

export interface StaffUser {
  id: string;
  email: string | null;
  role: UserRole | null;
  fullName: string | null;
}

/**
 * Resolve the signed-in user and their role from `profiles`.
 * Returns null when nobody is signed in.
 *
 * The `profiles` select policy is `id = auth.uid() or is_admin()`, so an admin
 * reading this table sees *every* row. The `.eq("id", user.id)` filter is
 * therefore load-bearing, not decorative: without it `.single()` errors as
 * soon as a second profile exists.
 */
export async function getStaffUser(): Promise<StaffUser | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? null,
    role: (profile?.role as UserRole | undefined) ?? null,
    fullName: profile?.full_name ?? null,
  };
}

/**
 * Guard for Server Actions. Throws unless the caller is signed in and holds
 * one of `roles`. RLS is still the last line of defence — this exists so the
 * application layer fails loudly and early instead of relying on a silently
 * rejected write.
 */
export async function requireRole(...roles: UserRole[]): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.role || !roles.includes(user.role)) {
    throw new Error("Not authorised");
  }
  return user;
}
