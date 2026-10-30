import { translate, type Locale } from "./core";
import type { MessageKey } from "./locales/en";

type BilingualTextProps = {
  /**
   * Copy that exists in both locale tables; the same key is read twice. Pass an
   * array to join several keys into one sentence — splitting a sentence across
   * spans would put stray spaces between its parts in the accessible name.
   */
  k: MessageKey | readonly MessageKey[];
  vars?: Record<string, string | number>;
};

/**
 * Writes the English and Chinese copy into the same static HTML, so the first
 * paint can already show the visitor's language instead of waiting for
 * hydration to swap it.
 *
 * Both spans are rendered unconditionally — on the server, during hydration and
 * on every later render — which is what keeps the SSR tree and the first client
 * render identical. The choice of language is left entirely to CSS
 * (`html[data-locale]`, written before first paint by `public/locale-init.js`),
 * so a language switch repaints without a React pass and the two trees can never
 * disagree.
 *
 * `display: none` on the inactive span keeps it out of the layout *and* out of
 * the accessibility tree, so headings and buttons are announced once. Each span
 * carries its own `lang` for screen readers and hyphenation.
 *
 * Without JavaScript there is no `data-locale`, and the stylesheet shows English.
 */
export function BilingualText({ k, vars }: BilingualTextProps) {
  const keys = Array.isArray(k) ? k : [k];

  const read = (locale: Locale) =>
    keys.map((key: MessageKey) => translate(locale, key, vars)).join("");

  return (
    <>
      <span lang="en" data-i18n-text="en">
        {read("en")}
      </span>
      <span lang="zh-CN" data-i18n-text="zh">
        {read("zh-CN")}
      </span>
    </>
  );
}
