import { useState, type ReactElement } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n";
import "./signout.css";

export function SignOutConfirmation({
  trigger,
  onConfirm,
  disabled = false,
  allBrowsers = false,
  description,
}: {
  trigger: ReactElement;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  allBrowsers?: boolean;
  description?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="signout-dialog">
        <div className="signout-dialog-head">
          <span className="signout-dialog-mark" aria-hidden="true">
            <Icon name="signout" size={27} />
          </span>
          <div>
            <DialogTitle>{t(allBrowsers ? "profile.signOutAllQuestion" : "profile.signOutQuestion")}</DialogTitle>
            <DialogDescription>{description ?? t("profile.signOutHelp")}</DialogDescription>
          </div>
        </div>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: "secondary" })}>{t("profile.cancel")}</DialogClose>
          <Button
            variant="destructive"
            className="signout-dialog-confirm"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              void onConfirm();
            }}
          >
            <Icon name="signout" size={18} />
            {t(allBrowsers ? "profile.signOutAll" : "site.signOut")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
