import { useLocale } from "@/i18n";
import { typeName } from "./pokemonZh";

export function TypeBadge({ type }: { type?: string }) {
  const locale = useLocale();

  if (!type) return null;

  return (
    <span className="poke-type-badge" data-type={type.toLowerCase()}>
      {typeName(type, locale)}
    </span>
  );
}
