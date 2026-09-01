import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import SignOutButton from "@/components/SignOutButton";

/**
 * Wraps all /admin routes. Middleware already redirects unauthenticated
 * users away from every admin page except /admin/login. So here:
 *  - No user  → render children bare (this is the login page).
 *  - User but not admin → bounce to login (they lack access).
 *  - Admin → render the full console chrome.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated: the only reachable admin page is login. Render it
  // without the console shell.
  if (!user) {
    return <>{children}</>;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-neutral-900">ZenoEats</span>
          <nav className="flex gap-4 text-sm text-neutral-600">
            <a href="/admin" className="hover:text-brand">Overview</a>
            <a href="/admin/menu" className="hover:text-brand">Menu</a>
            <a href="/admin/places" className="hover:text-brand">Places</a>
            <a href="/admin/orders" className="hover:text-brand">Orders</a>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-500">{profile?.full_name ?? "Admin"}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
