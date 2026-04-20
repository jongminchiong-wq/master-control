"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Loader2, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Stage =
  | { kind: "loading" }
  | { kind: "idle" }
  | {
      kind: "enrolling";
      factorId: string;
      qrCode: string;
      secret: string;
    }
  | { kind: "enrolled"; factorId: string }
  | { kind: "disabling"; factorId: string };

export function SecurityPanel({
  canDisable = true,
  onEnrollmentChange,
}: {
  canDisable?: boolean;
  onEnrollmentChange?: (enrolled: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      setStage({ kind: "idle" });
      return;
    }
    const verified = data.totp[0];
    if (verified) {
      setStage({ kind: "enrolled", factorId: verified.id });
      onEnrollmentChange?.(true);
      return;
    }
    // Clean up any abandoned unverified TOTP factors so enroll doesn't fail
    const unverified = data.all.filter(
      (f) => f.factor_type === "totp" && f.status === "unverified"
    );
    for (const f of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    setStage({ kind: "idle" });
    onEnrollmentChange?.(false);
  }, [onEnrollmentChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function startEnrollment() {
    setError("");
    setBusy(true);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Google Authenticator",
      issuer: "BridgeConnect",
    });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Failed to start enrollment.");
      return;
    }
    setStage({
      kind: "enrolling",
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setCode("");
  }

  async function verifyEnrollment() {
    if (stage.kind !== "enrolling") return;
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError("");
    setBusy(true);
    const supabase = createClient();
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: stage.factorId });
    if (challengeError || !challenge) {
      setBusy(false);
      setError(challengeError?.message ?? "Could not start challenge.");
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: stage.factorId,
      challengeId: challenge.id,
      code,
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setCode("");
    await refresh();
  }

  async function cancelEnrollment() {
    if (stage.kind !== "enrolling") return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.mfa.unenroll({ factorId: stage.factorId });
    setBusy(false);
    setCode("");
    setError("");
    setStage({ kind: "idle" });
  }

  async function disableMfa() {
    if (stage.kind !== "enrolled") return;
    const confirmed = window.confirm(
      "Turn off two-factor authentication? You will only need your password to sign in."
    );
    if (!confirmed) return;
    setBusy(true);
    const supabase = createClient();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({
      factorId: stage.factorId,
    });
    setBusy(false);
    if (unenrollError) {
      setError(unenrollError.message);
      return;
    }
    await refresh();
  }

  function copySecret() {
    if (stage.kind !== "enrolling") return;
    navigator.clipboard.writeText(stage.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto w-full max-w-xl py-6">
      <div className="mb-6">
        <h1 className="text-xl font-medium">Security</h1>
        <p className="text-sm text-gray-500">
          Add a second step to your login with a mobile authenticator app.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {stage.kind === "enrolled" ? (
              <ShieldCheck className="size-5 text-success-600" strokeWidth={1.6} />
            ) : (
              <ShieldOff className="size-5 text-gray-400" strokeWidth={1.6} />
            )}
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            {stage.kind === "enrolled"
              ? "A 6-digit code from your authenticator app is required at login."
              : "Works with Google Authenticator, Authy, 1Password, Microsoft Authenticator, and any other TOTP app."}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pb-4">
          {stage.kind === "loading" && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.6} />
              Loading…
            </div>
          )}

          {stage.kind === "idle" && (
            <Button
              type="button"
              disabled={busy}
              onClick={startEnrollment}
              className="w-fit bg-brand-600 text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? "Preparing…" : "Enable two-factor authentication"}
            </Button>
          )}

          {stage.kind === "enrolling" && (
            <div className="flex flex-col gap-4">
              <ol className="flex flex-col gap-2 text-sm text-gray-600">
                <li>
                  <span className="font-medium text-gray-800">1.</span> Open
                  your authenticator app and scan this QR code.
                </li>
              </ol>

              <div className="flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stage.qrCode}
                  alt="Scan this with your authenticator app"
                  width={192}
                  height={192}
                />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs uppercase tracking-wider text-gray-500">
                    Or enter this secret manually
                  </span>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 font-mono text-xs text-gray-700 hover:bg-gray-200"
                  >
                    {stage.secret}
                    {copied ? (
                      <Check className="size-3 text-success-600" strokeWidth={2} />
                    ) : (
                      <Copy className="size-3 text-gray-500" strokeWidth={1.6} />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="totp-code" className="text-sm font-medium text-gray-800">
                  2. Enter the 6-digit code shown in the app
                </label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="font-mono tracking-widest"
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={busy || code.length !== 6}
                  onClick={verifyEnrollment}
                  className="bg-brand-600 text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  {busy ? "Verifying…" : "Confirm and enable"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={cancelEnrollment}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {stage.kind === "enrolled" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-800">
                {canDisable
                  ? "Two-factor authentication is on for your account."
                  : "Two-factor authentication is on and required for your account."}
              </div>
              {canDisable && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={disableMfa}
                  className="w-fit border-danger-200 text-danger-600 hover:bg-danger-50"
                >
                  {busy ? "Turning off…" : "Turn off two-factor authentication"}
                </Button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        If you lose access to your authenticator app, contact an administrator
        to reset your two-factor authentication.
      </p>
    </div>
  );
}
