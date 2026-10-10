import { Dithering, type DitheringProps } from "@paper-design/shaders-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Inks = { back: string; front: string };

function readInks(element: HTMLElement, front: string): Inks {
  const style = getComputedStyle(element);

  return {
    back: style.getPropertyValue("--field-back").trim(),
    front: style.getPropertyValue(front).trim(),
  };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);

    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** Paper's ordered-dither shader as an ambient backdrop. Colors come from the
    theme tokens, the shader stops while offscreen or hidden, and reduced motion
    renders one still frame. A CSS Bayer plate shows until WebGL paints. */
export function DitherField({
  className,
  "shape": silhouette = "warp",
  type = "4x4",
  size = 2,
  speed = 0.22,
  scale = 1,
  ink = "--field-front",
  frame = 0,
  children,
}: {
  className?: string;
  "shape"?: DitheringProps["shape"];
  type?: DitheringProps["type"];
  size?: number;
  speed?: number;
  scale?: number;
  ink?: `--${string}`;
  frame?: number;
  children?: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [inks, setInks] = useState<Inks | null>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = host.current;

    if (!element) return;
    const sync = () => setInks(readInks(element, ink));
    sync();
    const theme = new MutationObserver(sync);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("llmgames-theme-change", sync);

    const seen = new IntersectionObserver(([entry]) =>
      setVisible(Boolean(entry?.isIntersecting) && document.visibilityState === "visible"),
    );

    seen.observe(element);

    const page = () =>
      setVisible(
        document.visibilityState === "visible" && element.getBoundingClientRect().bottom > 0,
      );

    document.addEventListener("visibilitychange", page);

    return () => {
      theme.disconnect();
      seen.disconnect();
      window.removeEventListener("llmgames-theme-change", sync);
      document.removeEventListener("visibilitychange", page);
    };
  }, [ink]);

  return (
    <div ref={host} className={cn("dither-field", className)} aria-hidden="true">
      {inks && inks.back && inks.front && (
        <Dithering
          className="dither-field-canvas"
          colorBack={inks.back}
          colorFront={inks.front}
          {...{ "shape": silhouette }}
          type={type}
          size={size}
          scale={scale}
          speed={reduced || !visible ? 0 : speed}
          frame={frame}
          maxPixelCount={1600 * 1000}
          minPixelRatio={1}
        />
      )}
      {children}
    </div>
  );
}
