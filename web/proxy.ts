import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * `proxy.ts`, not `middleware.ts` - the `middleware.js` file convention
 * was renamed to `proxy.js` in this Next.js version (confirmed against
 * the bundled docs, not assumed - see the "This is NOT the Next.js you
 * know" note in AGENTS.md). Behavior is unchanged from what "middleware"
 * meant before; only the file and export names moved.
 *
 * Refreshes the Supabase session on every request that touches `(app)`
 * routes and redirects to `/login` when there's no session
 * (SYSTEM-DESIGN-NEXTJS.md §17: middleware-protected (app) routes).
 * This is also what makes server-side cookie writes from Server
 * Components (which can't set cookies themselves) safe to no-op - the
 * proxy is what actually persists a refreshed session.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isPublicTestFixture = pathname.startsWith("/test-fixtures");

  if (!user && !isAuthRoute && !isPublicTestFixture) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/runs", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Every path except static assets, image optimization, and the
    // favicon - deliberately a negative match so auth logic never blocks
    // CSS/JS/images from loading (per the proxy.js docs' own warning).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
