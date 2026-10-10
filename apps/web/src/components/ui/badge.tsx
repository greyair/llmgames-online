import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: "neutral" | "live" | "warning" | "danger" | "game" }) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn("ui-badge", `badge-${tone}`, className)}
      {...props}
    />
  );
}
