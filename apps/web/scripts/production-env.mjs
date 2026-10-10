export function validateProductionEnv(env) {
  const key = env.VITE_TURNSTILE_SITE_KEY?.trim();

  if (!key || key === "replace-with-your-turnstile-site-key" || /^[123]x0{5}/.test(key)) {
    throw new Error(
      "Production build requires a real VITE_TURNSTILE_SITE_KEY. Check apps/web/.env.production or the build environment.",
    );
  }
}
