import type { ReactNode } from "react";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/interface/ThemeToggle";
import { SoundControl } from "@/interface/Feedback";
import { SignOutConfirmation } from "@/interface/SignOutConfirmation";
import { useT } from "@/i18n";
import { LocaleSwitch } from "./LocaleSwitch";

export function SiteTools() {
  return (
    <div className="site-tools">
      <LocaleSwitch />
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
  const t = useT();

  if (status === "pending")
    return (
      <span className="site-account-pending">
        <HoleyLoader compact label={t("site.checkingAccount")} size={20} />
      </span>
    );

  if (status === "out")
    return (
      actions ?? (
        <ButtonLink href="/login" size="sm" className="site-signin">
          <span>{t("site.signIn")}</span>
          <Icon name="arrow" size={18} />
        </ButtonLink>
      )
    );

  return (
    <div className="site-account">
      <a
        href="/profile"
        aria-label={t("site.profile")}
        aria-current={profileCurrent ? "page" : undefined}
        className="site-profile"
      >
        <PlayerAvatar name={`human:${gamertag || "player"}`} size={24} label="" />
        <span className="site-profile-label">{t("site.profile")}</span>
      </a>
      <SignOutConfirmation
        disabled={signingOut}
        onConfirm={onSignOut}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="site-signout"
            aria-label={signingOut ? t("site.signingOut") : t("site.signOut")}
            title={t("site.signOut")}
            disabled={signingOut}
          >
            <Icon name="signout" size={16} />
          </Button>
        }
      />
    </div>
  );
}
