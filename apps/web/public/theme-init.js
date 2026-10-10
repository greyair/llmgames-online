(() => {
  const apply = (root) => {
    let saved;

    try {
      saved = localStorage.getItem("llmgames-theme");
    } catch {}

    const theme =
      saved === "light" || saved === "dark"
        ? saved
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  };

  apply(document.documentElement);
  document.addEventListener("astro:before-swap", (event) =>
    apply(event.newDocument.documentElement),
  );
})();
