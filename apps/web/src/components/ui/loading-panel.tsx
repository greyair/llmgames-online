import { Children, type ReactNode } from "react";
import { HoleyLoader } from "./holey-loader";

/** A page-level wait with one status message and optional recovery controls. */
export function LoadingPanel({ label, children }: { label: string; children?: ReactNode }) {
  const actions = Children.toArray(children);

  return (
    <div className="ui-loading-panel enter" data-slot="card">
      <HoleyLoader label={label} showLabel size={30} />
      {actions.length > 0 && <div className="ui-loading-actions">{actions}</div>}
    </div>
  );
}
