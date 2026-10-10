import type { ReactNode } from "react";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/interface/ThemeToggle";
import { SoundControl } from "@/interface/Feedback";
import { SignOutConfirmation } from "@/interface/SignOutConfirmation";

export function SiteTools() {
  return (
    <div className="site-tools">
      <SoundControl />
      <ThemeToggle />
    </div>
  );
}

type SiteAccountProps = {
  status: "in" | "out" | "pending";
  gamertag?: string;
  profileCurrent: boolean;
  actions?: ReactNode;
  signingOut: boolean;
  onSignOut: () => void;
};

export function SiteAccount({
  status,
  gamertag,
  profileCurrent,
  actions,
  signingOut,
  onSignOut,
}: SiteAccountProps) {
  if (status === "pending")
    return (
      <span className="site-account-pending">
        <HoleyLoader compact label="Checking your account" size={20} />
      </span>
    );

  if (status === "out")
    return (
      actions ?? (
        <ButtonLink href="/login" size="sm" className="site-signin">
          <span>Sign in</span>
          <Icon name="arrow" size={18} />
        </ButtonLink>
      )
    );

  return (
    <div className="site-account">
      <a
        href="/profile"
        aria-label="Profile"
        aria-current={profileCurrent ? "page" : undefined}
        className="site-profile"
      >
        <PlayerAvatar name={`human:${gamertag || "player"}`} size={24} label="" />
        <span className="site-profile-label">Profile</span>
      </a>
      <SignOutConfirmation
        disabled={signingOut}
        onConfirm={onSignOut}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="site-signout"
            aria-label={signingOut ? "Signing out…" : "Sign out"}
            title="Sign out"
            disabled={signingOut}
          >
            <Icon name="signout" size={16} />
          </Button>
        }
      />
    </div>
  );
}
