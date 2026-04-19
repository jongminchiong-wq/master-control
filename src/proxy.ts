import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

// Routes that belong to the (admin) route group
const ADMIN_PATHS = ["/players", "/po-cycle", "/investors", "/entity", "/simulation"]

// Routes that belong to the (player) route group
const PLAYER_PATHS = ["/dashboard", "/simulator"]

// Routes that belong to the (investor) route group
const INVESTOR_PATHS = ["/portfolio", "/returns"]

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

function getDefaultPath(role: string): string {
  if (role === "admin") return "/players"
  if (role === "investor") return "/portfolio"
  return "/dashboard"
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Always call getUser() to refresh the session.
  // Do NOT use getSession() — it reads from cookies without validation.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // ── Not authenticated ──────────────────────────────────────
  if (!user) {
    if (pathname === "/login") {
      return response
    }
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // ── Enforce TOTP challenge completion ──────────────────────
  // If the user enrolled TOTP but hasn't entered the 6-digit code yet,
  // their session is still aal1. Force them back to /login so they can
  // complete the challenge. Users who never enrolled have nextLevel === "aal1"
  // and pass through unchanged.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (
    aal?.nextLevel === "aal2" &&
    aal.currentLevel !== "aal2" &&
    pathname !== "/login"
  ) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("error", "mfa_required")
    return NextResponse.redirect(loginUrl)
  }

  // ── Authenticated — look up role ───────────────────────────
  const { data: userRecord } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()

  const role = userRecord?.role as
    | "admin"
    | "player"
    | "investor"
    | undefined

  // User exists in auth but has no row in users table
  if (!role) {
    if (pathname === "/login") {
      return response
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("error", "no_role")
    return NextResponse.redirect(loginUrl)
  }

  // ── Redirect /login and / to the correct dashboard ─────────
  if (pathname === "/login" || pathname === "/") {
    return NextResponse.redirect(
      new URL(getDefaultPath(role), request.url)
    )
  }

  // ── Enforce route group access ─────────────────────────────
  // Admin trying to access player/investor routes
  if (role === "admin" && (startsWithAny(pathname, PLAYER_PATHS) || startsWithAny(pathname, INVESTOR_PATHS))) {
    return NextResponse.redirect(new URL("/players", request.url))
  }

  // Player trying to access admin or investor routes
  if (role === "player" && (startsWithAny(pathname, ADMIN_PATHS) || startsWithAny(pathname, INVESTOR_PATHS))) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Investor trying to access admin or player routes
  if (role === "investor" && (startsWithAny(pathname, ADMIN_PATHS) || startsWithAny(pathname, PLAYER_PATHS))) {
    return NextResponse.redirect(new URL("/portfolio", request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
