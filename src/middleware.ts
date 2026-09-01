import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Areas that require a signed-in user. Role checks happen in each layout. */
const PROTECTED_PREFIXES = ["/admin", "/driver"];
const LOGIN_PATH = "/admin/login";

/**
 * On every page request: refresh the Supabase session cookie, and guard the
 * staff areas. Unauthenticated hits to /admin/* (except the login page) and
 * /driver/* are redirected to login. Whether that user is an *admin* or a
 * *driver* is decided in the respective layout, which can read `profiles`.
 *
 * API routes are excluded from the matcher: they authenticate themselves, and
 * running an auth round-trip on the Stripe webhook only adds latency to the
 * money path.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLoginPage = pathname === LOGIN_PATH;

  if (isProtected && !isLoginPage && !user) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
