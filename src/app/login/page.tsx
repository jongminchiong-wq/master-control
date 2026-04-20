"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Stage =
  | { kind: "password" }
  | { kind: "challenge"; factorId: string }

export default function LoginPage() {
  const [stage, setStage] = useState<Stage>({ kind: "password" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Show error from proxy redirect (e.g. authenticated but no role in users table)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("error") === "no_role") {
      setError(
        "Your account exists but has no role assigned. Insert a row into the users table with your auth user ID and role."
      )
    } else if (params.get("error") === "mfa_required") {
      setError("Please complete two-factor authentication to continue.")
    }
  }, [])

  async function redirectToDashboard() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError("Session lost. Please sign in again.")
      setLoading(false)
      return
    }
    const { data: userRecord } = await supabase
      .from("users")
      .select()
      .eq("id", user.id)
      .single()

    if (!userRecord?.role) {
      setError(
        "Your account exists but has no role assigned. Insert a row into the users table with your auth user ID and role."
      )
      setLoading(false)
      return
    }

    const path = userRecord.role === "admin" ? "/players" : "/dashboard"
    window.location.href = path
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const supabase = createClient()
    const result = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
      return
    }

    // If the user has enrolled TOTP, the session will be aal1 with nextLevel aal2.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const verified = factors?.totp.find((f) => f.status === "verified")
      if (verified) {
        setStage({ kind: "challenge", factorId: verified.id })
        setLoading(false)
        return
      }
    }

    await redirectToDashboard()
  }

  async function handleChallengeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (stage.kind !== "challenge") return
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.")
      return
    }
    setError("")
    setLoading(true)

    const supabase = createClient()
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: stage.factorId })
    if (challengeError || !challenge) {
      setError(challengeError?.message ?? "Could not start challenge.")
      setLoading(false)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: stage.factorId,
      challengeId: challenge.id,
      code,
    })
    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    await redirectToDashboard()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="flex justify-center">
              <span className="text-2xl font-semibold tracking-tight text-brand-600">
                BridgeConnect
              </span>
            </CardTitle>
            <CardDescription>
              {stage.kind === "password"
                ? "Sign in to your account"
                : "Enter the 6-digit code from your authenticator app"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stage.kind === "password" ? (
              <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-gray-600"
                  >
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-gray-600"
                  >
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <p className="text-sm text-danger-600">{error}</p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-600 text-white hover:bg-brand-800 disabled:opacity-50"
                  size="lg"
                >
                  {loading ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleChallengeSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="code"
                    className="text-sm font-medium text-gray-600"
                  >
                    Authentication code
                  </label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="font-mono tracking-widest"
                    autoFocus
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-danger-600">{error}</p>
                )}

                <Button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full bg-brand-600 text-white hover:bg-brand-800 disabled:opacity-50"
                  size="lg"
                >
                  {loading ? "Verifying..." : "Verify"}
                </Button>

                <button
                  type="button"
                  onClick={async () => {
                    const supabase = createClient()
                    await supabase.auth.signOut()
                    setStage({ kind: "password" })
                    setCode("")
                    setError("")
                  }}
                  className="text-center text-xs text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Cancel and sign in with a different account
                </button>
              </form>
            )}

            <p className="mt-4 text-center text-xs leading-relaxed text-gray-500">
              By signing in, you agree to our{" "}
              <Link
                href="/legal/privacy"
                className="text-brand-600 hover:underline"
              >
                Privacy Notice
              </Link>
              {" "}and{" "}
              <Link
                href="/legal/disclosures"
                className="text-brand-600 hover:underline"
              >
                Disclosures
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
