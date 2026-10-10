import type { CSSProperties } from "react";

/** A 3x3 pixel grid that lights in Bayer order. Kept under its original export name for call sites. */
export function HoleyLoader({
  label,
  size = 24,
  compact = false,
  showLabel = false,
  color,
}: {
  label: string;
  size?: number;
  compact?: boolean;
  showLabel?: boolean;
  color?: string;
}) {
  const loaderStyle: CSSProperties = { "--loader-size": `${size}px` };

  if (color) loaderStyle["--loader-color"] = color;

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
      <span className={compact && !showLabel ? "sr-only" : "ui-loader-label"}>{label}</span>
    </div>
  );
}
