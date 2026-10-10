import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Seat / player label: first name only, hard-capped with ellipsis.
 * Keeps table chrome from shifting when Google names are long.
 */
export function formatSeatName(name: string | null | undefined, maxLen = 10): string {
  const raw = (name ?? "").trim();
  const first = raw.split(/\s+/)[0] || "Player";

  if (first.length <= maxLen) return first;

  return `${first.slice(0, Math.max(1, maxLen - 1))}…`;
}
