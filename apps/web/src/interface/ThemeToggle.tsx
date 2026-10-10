import { Icon } from "@/components/ui/icon";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === "dark");
    sync();
    setReady(true);
    window.addEventListener("llmgames-theme-change", sync);
    const media = matchMedia("(prefers-color-scheme: dark)");

    const system = () => {
      let saved;

      try {
        saved = localStorage.getItem("llmgames-theme");
      } catch {
        /* Use the system preference when storage is unavailable. */
      }

      if (!saved) {
        document.documentElement.dataset.theme = media.matches ? "dark" : "light";
        document.documentElement.style.colorScheme = media.matches ? "dark" : "light";
        sync();
      }
    };

    system();
    media.addEventListener("change", system);

    return () => {
      window.removeEventListener("llmgames-theme-change", sync);
      media.removeEventListener("change", system);
    };
  }, []);

  return (
    <Button
      disabled={!ready}
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;

        try {
          localStorage.setItem("llmgames-theme", next);
        } catch {
          /* Use the system preference when storage is unavailable. */
        }

        setDark(!dark);
        window.dispatchEvent(new Event("llmgames-theme-change"));
      }}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </Button>
  );
}
