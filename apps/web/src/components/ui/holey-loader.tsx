import type { CSSProperties } from "react";
import { BilingualText, type MessageKey } from "@/i18n";

/**
 * A 3x3 pixel grid that lights in Bayer order. Kept under its original export name for call sites.
 *
 * `labelKey` replaces `label` with copy that ships in both locales, for the
 * loader baked into the static HTML: it must read correctly before hydration.
 */
export function HoleyLoader({
  label,
  labelKey,
  size = 24,
  compact = false,
  showLabel = false,
  color,
}: {
  label?: string;
  labelKey?: MessageKey;
  size?: number;
  compact?: boolean;
  showLabel?: boolean;
  color?: string;
}) {
  const loaderStyle: CSSProperties = { "--loader-size": `${size}px` };

  if (color) loaderStyle["--loader-color"] = color;

  const text = labelKey ? <BilingualText k={labelKey} /> : label;

  return (
    <div
      className={compact ? "ui-loader ui-loader-compact" : "ui-loader"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="ui-loader-mark" aria-hidden="true" style={loaderStyle}>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className={compact && !showLabel ? "sr-only" : "ui-loader-label"}>{text}</span>
    </div>
  );
}
