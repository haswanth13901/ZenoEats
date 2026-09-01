import Link from "next/link";
import { getStaffUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import SignOutButton from "@/components/SignOutButton";
import NoAccess from "@/components/NoAccess";

/**
 * Wraps all /admin routes. Middleware already redirects unauthenticated users
 * away from every admin page except /admin/login. So here:
 *  - No user  → render children bare (this is the login page).
 *  - Signed in but not an admin → explain, and offer a way out. Bouncing them
 *    back to /admin/login would loop through a login form they are already
 *    past, which reads as a broken app rather than a permissions boundary.
 *  - Admin → render the full console chrome.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getStaffUser();

  if (!user) {
    return <>{children}</>;
  }

  if (user.role !== "admin") {
    return (
      <NoAccess
        title="You don't have admin access"
        body={
          user.role === "driver"
            ? "This account is a driver. Head to the driver view, or ask an owner for admin access."
            : "This account hasn't been granted a role yet. Ask an owner to set you up."
        }
      />
    );
  }

  // A payment anomaly should be impossible to miss, so this banner rides on
  // every admin page rather than living only on a page nobody visits.
  const supabase = await createServerSupabase();
  const { count: openAlerts } = await supabase
    .from("security_alerts")
    .select("id", { count: "exact", head: true })
    .is("acknowledged_at", null);

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
            <a href="/admin/alerts" className="hover:text-brand">Alerts</a>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-500">{user.fullName ?? "Admin"}</span>
          <SignOutButton />
        </div>
      </header>
      {openAlerts != null && openAlerts > 0 && (
        <Link
          href="/admin/alerts"
          className="block border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 transition hover:bg-red-100"
        >
          <strong className="font-semibold">
            {openAlerts} unreviewed payment {openAlerts === 1 ? "alert" : "alerts"}.
          </strong>{" "}
          Something didn&apos;t add up during checkout — review before fulfilling.
        </Link>
      )}
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
