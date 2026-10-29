import { Button } from "@/components/ui/button";
import { setLocale, useLocale, useT } from "@/i18n";
import { useEffect, useState } from "react";

/**
 * One button that flips between the two shipped languages.
 *
 * The label shows the language in use, so it reads the same in both locales
 * ("EN" / "中"); the accessible name spells out what a press will do.
 */
export function LocaleSwitch() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const locale = useLocale();
  const t = useT();

  const next = locale === "en" ? "zh-CN" : "en";
  const currentName = t(locale === "en" ? "common.english" : "common.chinese");
  const nextName = t(next === "en" ? "common.english" : "common.chinese");

  return (
    <Button
      variant="ghost"
      size="sm"
      className="locale-switch"
      lang={locale}
      data-testid="locale-switch"
      aria-label={`${t("common.language")}: ${currentName} → ${nextName}`}
      title={nextName}
      disabled={!ready}
      onClick={() => setLocale(next)}
    >
      <span aria-hidden="true">{locale === "en" ? "EN" : "中"}</span>
    </Button>
  );
}
