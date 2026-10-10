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
import "./signout.css";

export function SignOutConfirmation({
  trigger,
  onConfirm,
  disabled = false,
  allBrowsers = false,
  description = "You'll need to sign in again to play or manage your account.",
}: {
  trigger: ReactElement;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  allBrowsers?: boolean;
  description?: string;
}) {
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
            <DialogTitle>{allBrowsers ? "Sign out of all browsers?" : "Sign out?"}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </div>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: "secondary" })}>Cancel</DialogClose>
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
            {allBrowsers ? "Sign out of all browsers" : "Sign out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
