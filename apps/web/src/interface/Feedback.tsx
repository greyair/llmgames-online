import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { isMuted, onMutedChange, play, setMuted, unlockAudio, parseSoundName } from "@/lib/sound";
import { useT } from "@/i18n";
import { installDitherTouch } from "@/lib/ditherTouch";

export { play as playSound, type SoundName } from "@/lib/sound";

export type GameSound = "shot" | "hit" | "miss" | "bomb" | "radar" | "torpedo" | "mine" | "sunk";

export function playGameSound(kind: GameSound) {
  play(kind);
}

export async function playTurnStart() {
  play("turn");
}

export function playTurnTick(urgent = true) {
  play(urgent ? "tickUrgent" : "tick");
}

export type CardSound = "deal" | "fold" | "chips" | "reveal";

export function playCardSound(kind: CardSound) {
  play(kind);
}

/** Called from a user gesture; creates no sound by itself. */
export function unlockCardAudio() {
  unlockAudio();
}

const INTERACTIVE =
  "button,a[href],summary,[role=button],[role=tab],[role=switch],[role=option],input[type=checkbox],input[type=radio],select,label[for]";

function soundTarget(event: Event) {
  const el =
    event.target instanceof Element ? event.target.closest<HTMLElement>(INTERACTIVE) : null;

  if (!el || el.closest("[data-silent],[data-sound=none]")) return null;

  if (
    (el instanceof HTMLButtonElement && el.disabled) ||
    el.getAttribute("aria-disabled") === "true"
  )
    return null;

  return el;
}

/** Site-wide interface feedback: a faint tick on hover, a soft tap on press,
    and the dither patch from lib/ditherTouch.
    Elements can override the press cue with data-sound="success" etc. */
export function InteractionFeedback() {
  useEffect(() => {
    let lastHover: Element | null = null;

    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const el = soundTarget(event);

      if (!el || el === lastHover) return;
      lastHover = el;
      play("hover");
    };

    const out = (event: PointerEvent) => {
      if (soundTarget(event) === lastHover) lastHover = null;
    };

    const down = (event: PointerEvent) => {
      unlockAudio();
      const el = soundTarget(event);

      if (!el) return;
      const custom = parseSoundName(el.dataset.sound);

      if (el.matches("[role=switch]"))
        play(el.getAttribute("aria-checked") === "true" ? "toggleOff" : "toggleOn");
      else play(custom ?? "tap");
    };

    const key = (event: KeyboardEvent) => {
      unlockAudio();
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (!target || target.closest("[data-silent]")) return;

      if (
        target.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea") &&
        event.key.length === 1
      )
        play("type");
      else if ((event.key === "Enter" || event.key === " ") && soundTarget(event)) play("tap");
    };

    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("keydown", key, { passive: true });
    const stopDither = installDitherTouch();
    const nav = () => play("nav");
    document.addEventListener("astro:after-swap", nav);

    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      document.removeEventListener("astro:after-swap", nav);
      stopDither();
    };
  }, []);

  return null;
}

export function SoundControl() {
  const t = useT();
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    setEnabled(!isMuted());

    return onMutedChange((m) => setEnabled(!m));
  }, []);

  return (
    <Button
      data-silent
      variant="ghost"
      size="icon"
      aria-label={t(enabled ? "match.muteSound" : "match.enableSound")}
      title={t(enabled ? "match.soundOn" : "match.soundOff")}
      onClick={() => {
        unlockAudio();
        setMuted(enabled);

        if (!enabled) setTimeout(() => play("toggleOn"), 10);
      }}
    >
      <Icon name={enabled ? "sound" : "muted"} size={18} />
    </Button>
  );
}
