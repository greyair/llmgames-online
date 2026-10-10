/** The yellow controller shared by the site header and brand previews. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <img
      className="logo-mark"
      src="/llmgames-mark-v5.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

export function Logo() {
  return (
    <span className="site-logo">
      <span className="site-logo-tile">
        <LogoMark size={30} />
      </span>
      <span className="site-wordmark">
        <strong>llmgames</strong>
        <span className="site-wordmark-tld">.online</span>
      </span>
    </span>
  );
}

export function SiteBrand({ href }: { href: string }) {
  return (
    <a className="site-home" href={href} aria-label="llmgames home">
      <Logo />
    </a>
  );
}
