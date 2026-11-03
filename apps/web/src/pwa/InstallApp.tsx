import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useT, type MessageKey } from "@/i18n";
import { offersInstall, promptInstall, type InstallPlatform } from "./install";
import { useInstallState } from "./useInstallState";
import "./pwa.css";

/**
 * The install entry (PWA.0).
 *
 * One button, three behaviours: Chromium gets the native prompt, iOS and macOS
 * Safari get instructions for the menu that actually exists on that platform,
 * and unsupported browsers get nothing at all rather than a dead control.
 */
export function InstallApp() {
  const t = useT();
  const state = useInstallState();
  const [open, setOpen] = useState(false);

  if (state.installed || state.standalone) return null;

  if (!offersInstall(state.platform)) return null;

  return (
    <>
      <Button
        className="site-install"
        variant="ghost"
        size="sm"
        onClick={() => {
          if (!state.canPrompt) {
            setOpen(true);

            return;
          }

          void promptInstall().then((outcome) => {
            // A dismissed prompt means the user said "not now"; only the
            // instruction path needs the dialog afterwards.
            if (outcome === "unavailable") setOpen(true);
          });
        }}
      >
        <Icon name="download" size={16} />
        <span className="site-install-label">{t("pwa.install")}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="pwa-install-dialog">
          <DialogTitle>{t("pwa.howToTitle")}</DialogTitle>
          <DialogDescription>{t("pwa.howToLead")}</DialogDescription>
          <InstallSteps platform={state.platform} />
          <p className="pwa-install-note">{t("pwa.installNote")}</p>
          <DialogClose className={buttonVariants({ variant: "secondary" })}>
            {t("pwa.close")}
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

const steps: Record<InstallPlatform, readonly MessageKey[]> = {
  ios: ["pwa.iosStepShare", "pwa.iosStepAdd", "pwa.iosStepConfirm"],
  "macos-safari": ["pwa.macStepFile", "pwa.macStepDock", "pwa.macStepConfirm"],
  chromium: ["pwa.chromiumStepBar", "pwa.chromiumStepMenu", "pwa.chromiumStepConfirm"],
  unsupported: [],
};

const titles: Record<InstallPlatform, MessageKey> = {
  ios: "pwa.iosTitle",
  "macos-safari": "pwa.macTitle",
  chromium: "pwa.chromiumTitle",
  unsupported: "pwa.unsupportedTitle",
};

function InstallSteps({ platform }: { platform: InstallPlatform }) {
  const t = useT();

  return (
    <section className="pwa-install-steps">
      <h3>{t(titles[platform])}</h3>
      <ol>
        {steps[platform].map((key, index) => (
          <li key={key}>
            <span aria-hidden="true">{index + 1}</span>
            {t(key)}
          </li>
        ))}
      </ol>
    </section>
  );
}
