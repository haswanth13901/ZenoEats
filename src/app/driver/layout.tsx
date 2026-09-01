import { getStaffUser } from "@/lib/auth";
import NoAccess from "@/components/NoAccess";

/**
 * Guards /driver/*. Middleware has already bounced anonymous visitors to the
 * login page; this checks the role. Admins are allowed through so an owner can
 * see what their drivers see.
 */
export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getStaffUser();

  if (!user) {
    // Middleware should have redirected already; this is defence in depth.
    return (
      <NoAccess
        title="Sign in to continue"
        body="The driver view is for signed-in delivery staff."
      />
    );
  }

  if (user.role !== "driver" && user.role !== "admin") {
    return (
      <NoAccess
        title="You don't have driver access"
        body="This account hasn't been granted a role yet. Ask an owner to set you up."
      />
    );
  }

  return <>{children}</>;
}
