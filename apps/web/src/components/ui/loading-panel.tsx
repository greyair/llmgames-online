import { Children, type ReactNode } from "react";
import type { MessageKey } from "@/i18n";
import { HoleyLoader } from "./holey-loader";

/**
 * A page-level wait with one status message and optional recovery controls.
 *
 * Pass `labelKey` instead of `label` when the panel is part of the static HTML:
 * both locales then ship in the markup, so the wait reads in the visitor's
 * language on first paint instead of after hydration.
 */
export function LoadingPanel({
  label,
  labelKey,
  children,
}: {
  label?: string;
  labelKey?: MessageKey;
  children?: ReactNode;
}) {
  const actions = Children.toArray(children);

  return (
    <div className="ui-loading-panel enter" data-slot="card">
      <HoleyLoader label={label} labelKey={labelKey} showLabel size={30} />
      {actions.length > 0 && <div className="ui-loading-actions">{actions}</div>}
    </div>
  );
}
