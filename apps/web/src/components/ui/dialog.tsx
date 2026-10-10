import { Dialog as Primitive } from "@base-ui/react/dialog";
import { useEffect, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { play } from "@/lib/sound";

export const Dialog = Primitive.Root;

export const DialogTrigger = Primitive.Trigger;

export const DialogClose = Primitive.Close;

function DialogSound() {
  useEffect(() => {
    play("open");

    return () => play("close");
  }, []);

  return null;
}

export function DialogContent({ className, children, ...props }: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="ui-dialog-backdrop" />
      <Primitive.Popup className={cn("ui-dialog-content", className)} {...props}>
        <DialogSound />
        {children}
      </Primitive.Popup>
    </Primitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: Primitive.Title.Props) {
  return <Primitive.Title className={cn("ui-dialog-title", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: Primitive.Description.Props) {
  return <Primitive.Description className={cn("ui-dialog-description", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-dialog-actions", className)} {...props} />;
}
