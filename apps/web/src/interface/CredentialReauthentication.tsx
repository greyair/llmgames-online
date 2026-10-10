import { useState } from "react";
import { Button } from "@/components/ui/button";
import { logout } from "@/services/auth";
import { ErrorMessage } from "./accountFeedback";

export function CredentialReauthentication() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="account-reauth">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");

          try {
            await logout("/login?return_to=%2Fprofile");
          } catch {
            setError("Could not start sign-in. Please try again.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening sign-in…" : "Sign in again"}
      </Button>
      {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
    </div>
  );
}
