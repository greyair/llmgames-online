import { useState } from "react";
import { Button } from "@/components/ui/button";
import { logout } from "@/services/auth";
import { ErrorMessage } from "./accountFeedback";
import { useT } from "@/i18n";

export function CredentialReauthentication() {
  const t = useT();
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
            setError(t("profile.openSignInFailed"));
            setBusy(false);
          }
        }}
      >
        {t(busy ? "profile.openingSignIn" : "room.signInAgain")}
      </Button>
      {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
    </div>
  );
}
