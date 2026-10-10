export function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;

  return (
    <span className="poke-type-badge" data-type={type.toLowerCase()}>
      {type}
    </span>
  );
}
