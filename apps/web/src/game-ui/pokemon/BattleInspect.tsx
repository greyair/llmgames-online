import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

/** Inspect with hover/focus, or hold on touch. A hold never submits the wrapped action. */
export function BattleInspect({
  title,
  description,
  children,
  content,
  className,
  clickToOpen = false,
  disabled = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  content: ReactNode;
  className?: string;
  clickToOpen?: boolean;
  disabled?: boolean;
}) {
  const t = useT();

  const anchor = useRef<HTMLDivElement>(null),
    hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    consumed = useRef(false),
    start = useRef({ x: 0, y: 0 }),
    touch = useRef(false);

  const [open, setOpen] = useState(false),
    [position, setPosition] = useState<{ left: number; bottom: number; width: number } | null>(
      null,
    );

  const id = useId();
  const cancelHold = () => clearTimeout(hold.current);

  const closeTooltip = () => {
    clearTimeout(hide.current);
    setPosition(null);
  };

  const inspect = () => {
    cancelHold();
    window.dispatchEvent(new Event("pokemon-inspect"));
    closeTooltip();
    setOpen(true);
  };

  const show = () => {
    if (open || touch.current) return;
    window.dispatchEvent(new Event("pokemon-inspect"));
    clearTimeout(hide.current);
    const box = anchor.current?.getBoundingClientRect();

    if (!box) return;
    const width = Math.min(320, window.innerWidth - 24);
    setPosition({
      width,
      left: Math.max(
        12,
        Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 12),
      ),
      bottom: Math.max(
        12,
        Math.min(
          window.innerHeight - box.top + 8,
          window.innerHeight - Math.min(380, window.innerHeight * 0.7) - 12,
        ),
      ),
    });
  };

  const later = () => {
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setPosition(null), 120);
  };

  useEffect(() => {
    const dismiss = () => {
      setPosition(null);
      clearTimeout(hold.current);
    };

    window.addEventListener("pokemon-inspect", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);

    return () => {
      clearTimeout(hold.current);
      clearTimeout(hide.current);
      window.removeEventListener("pokemon-inspect", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);

  return (
    <div
      ref={anchor}
      className={className}
      tabIndex={disabled ? 0 : -1}
      aria-describedby={position ? id : undefined}
      onMouseEnter={() => {
        touch.current = false;
        show();
      }}
      onMouseLeave={later}
      onFocus={(event) => {
        if (event.currentTarget.contains(event.target)) show();
      }}
      onBlur={later}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeTooltip();

        if (event.key === "Enter" && event.altKey) {
          event.preventDefault();
          inspect();
        }
      }}
      onPointerDown={(event) => {
        if (!(event.target instanceof Node && event.currentTarget.contains(event.target))) return;
        consumed.current = false;
        touch.current = event.pointerType === "touch";

        if (!touch.current) return;
        closeTooltip();
        start.current = { x: event.clientX, y: event.clientY };
        hold.current = setTimeout(() => {
          consumed.current = true;
          inspect();
        }, 500);
      }}
      onPointerMove={(event) => {
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10)
          cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(event) => {
        if (touch.current) {
          event.preventDefault();
        }
      }}
      onClickCapture={(event) => {
        if (!(event.target instanceof Node && event.currentTarget.contains(event.target))) return;

        if (consumed.current) {
          event.preventDefault();
          event.stopPropagation();
          consumed.current = false;
        }
      }}
      onClick={(event) => {
        if (
          clickToOpen &&
          event.target instanceof Element &&
          event.target.closest(".poke-inspect-roster")
        ) {
          event.stopPropagation();
          inspect();
        }
      }}
    >
      {children}
      {position &&
        !open &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="poke-move-tooltip poke-inspect-tooltip"
            style={position}
            onMouseEnter={() => clearTimeout(hide.current)}
            onMouseLeave={later}
          >
            <strong>{title}</strong>
            {description && <span>{description}</span>}
            {content}
          </div>,
          document.body,
        )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          closeTooltip();
        }}
      >
        <DialogContent className="poke-detail-dialog" finalFocus={anchor}>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          {content}
          <DialogClose render={<Button variant="outline" />}>{t("board.pokemon.close")}</DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
