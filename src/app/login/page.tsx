"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Command } from "lucide-react"
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

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Show error from proxy redirect (e.g. authenticated but no role in users table)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("error") === "no_role") {
      setError(
        "Your account exists but has no role assigned. Insert a row into the users table with your auth user ID and role."
      )
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
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

    const userId = result.data.user.id

    // Look up role from users table to determine redirect target
    const { data: userRecord } = await supabase
      .from("users")
      .select()
      .eq("id", userId)
      .single()

    if (!userRecord?.role) {
      setError(
        "Your account exists but has no role assigned. Insert a row into the users table with your auth user ID and role."
      )
      setLoading(false)
      return
    }

    // Redirect directly based on role — no dependency on proxy for initial redirect
    const path = userRecord.role === "admin" ? "/players" : "/dashboard"
    window.location.href = path
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="flex justify-center">
              <Command
                className="text-brand-600"
                size={36}
                strokeWidth={1.5}
                aria-label="BridgeConnect"
              />
            </CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
