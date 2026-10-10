import type { Turnstile } from "@/interface/Account";

declare global {
  interface Window {
    llmgamesNavigate?: (href: string, options?: { history: "push" | "replace" }) => void;
    turnstile?: Turnstile;
  }

  interface History {
    llmgamesPatched?: boolean;
  }
}

export {};
