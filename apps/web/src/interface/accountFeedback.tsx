import { useEffect, useRef, type ReactNode } from "react";
import { play, type SoundName } from "@/lib/sound";

/** Plays a cue when a message appears or changes, but not for messages that
    arrive with the first load (a failed fetch on page open should stay quiet). */
export function useMessageCue(value: string, sound: SoundName) {
  const mounted = useRef(0);
  useEffect(() => {
    mounted.current = performance.now();
  }, []);
  useEffect(() => {
    if (value && performance.now() - mounted.current > 900) play(sound);
  }, [value, sound]);
}

export function StatusMessage({
  children,
  className = "account-saved",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="status" className={`${className} account-message`} data-tone="success">
      {children}
    </p>
  );
}

export function ErrorMessage({
  children,
  className = "account-error",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={`${className} account-message is-shaking`}
      data-tone="danger"
    >
      {children}
    </p>
  );
}
