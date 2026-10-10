import { TypeSafeSettings } from "./TypeSafeSettings";
import { AgentWebhookSettings } from "./AgentWebhookSettings";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCurrentUser,
  forgetCurrentUser,
  peekCurrentUser,
  login,
  logout,
  requestEmailCode,
  verifyEmailCode,
  completeOnboarding,
  type User,
} from "@/services/auth";
import { go } from "@/lib/navigate";
import { Chrome } from "./Chrome";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { LoadingPanel } from "@/components/ui/loading-panel";
import { SignOutConfirmation } from "./SignOutConfirmation";
import { ErrorMessage, useMessageCue } from "./accountFeedback";
import "./account.css";

export function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/play";

  try {
    const url = new URL(value, location.origin);

    return url.origin === location.origin && !["/login", "/onboarding"].includes(url.pathname)
      ? url.pathname + url.search + url.hash
      : "/play";
  } catch {
    return "/play";
  }
}

function message<T>(error: T) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function AccountFrame({ children }: { children: ReactNode }) {
  return (
    <Chrome
      active="account"
      authenticated={false}
      actions={
        <ButtonLink href="/play" variant="outline" size="sm">
          Browse games
        </ButtonLink>
      }
    >
      <div className="account-wrap">
        <div className="account-card reveal">{children}</div>
      </div>
    </Chrome>
  );
}

export type Turnstile = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      theme: "light" | "dark";
      size: "flexible";
      appearance: "interaction-only";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
      "before-interactive-callback": () => void;
      "unsupported-callback": () => void;
    },
  ) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

function pageTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Cloudflare's always-pass test key keeps local dev on the real verification flow without a provisioned key.
const turnstileSiteKey: string =
  import.meta.env.VITE_TURNSTILE_SITE_KEY ||
  (import.meta.env.DEV ? "1x00000000000000000000AA" : "");

function VerifyingMark() {
  return (
    <span className="signin-verifying-mark" aria-hidden="true">
      <HoleyLoader compact label="Verifying…" size={18} color="currentColor" />
    </span>
  );
}

function Verification({
  onToken,
  onInteractive,
}: {
  onToken: (token: string) => void;
  onInteractive: (value: boolean) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let widget: string | undefined;
    let disposed = false;
    const api = () => window.turnstile;

    const showChallenge = (value: boolean) => {
      setInteractive(value);
      onInteractive(value);
    };

    function render() {
      if (disposed || !element.current || !api()) return;

      if (timeout) clearTimeout(timeout);

      if (widget) {
        try {
          api()!.remove(widget);
        } catch {
          /* already gone */
        }

        widget = undefined;
        element.current.innerHTML = "";
      }

      onToken("");
      showChallenge(false);
      widget = api()!.render(element.current, {
        sitekey: turnstileSiteKey,
        theme: pageTheme(),
        size: "flexible",
        appearance: "interaction-only",
        callback: (token) => {
          setError(false);
          showChallenge(false);
          onToken(token);
        },
        "expired-callback": () => {
          onToken("");

          if (widget) api()?.reset(widget);
        },
        "error-callback": () => {
          onToken("");
          showChallenge(true);
        },
        "timeout-callback": () => {
          onToken("");
          showChallenge(true);
        },
        "before-interactive-callback": () => showChallenge(true),
        "unsupported-callback": () => {
          onToken("");
          setError(true);
          showChallenge(true);
        },
      });
    }

    let script = document.querySelector<HTMLScriptElement>("script[data-login-verification]");

    if (script?.dataset.failed) {
      script.remove();
      script = null;
    }

    const failed = () => {
      if (script) script.dataset.failed = "true";
      setError(true);
      showChallenge(true);
    };

    const timeout = setTimeout(() => {
      if (!disposed && !widget) failed();
    }, 8000);

    if (api()) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.dataset.loginVerification = "true";
        document.head.append(script);
      }

      script.addEventListener("load", render);
      script.addEventListener("error", failed);
    }

    const theme = new MutationObserver(() => render());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      disposed = true;
      clearTimeout(timeout);
      theme.disconnect();
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", failed);

      if (widget) api()?.remove(widget);
    };
  }, [onToken, onInteractive, attempt]);

  if (!turnstileSiteKey) return null;

  return (
    <div
      className="signin-verification"
      data-visible={interactive || error ? "true" : "false"}
      aria-live="polite"
    >
      {error && (
        <div role="alert">
          Verification could not load.{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(false);
              setAttempt((n) => n + 1);
            }}
          >
            Retry verification
          </Button>
        </div>
      )}
      <div ref={element} className="signin-verification-widget" />
    </div>
  );
}

/** One real input laid over six display slots, so autofill, paste and screen readers see a normal field. */
function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="signin-code">
      <div className="signin-code-slots" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            data-filled={index < value.length || undefined}
            data-active={index === Math.min(value.length, 5) || undefined}
          >
            {value[index] ?? ""}
          </span>
        ))}
      </div>
      <Input
        id="code"
        className="signin-code-input"
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );
}

function SignIn({ returnTo, previewState }: { returnTo: string; previewState?: string }) {
  const [email, setEmail] = useState(previewState ? "alex@example.test" : "");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(previewState === "auth-code" ? "preview-code" : "");
  const [token, setToken] = useState("");
  const [verificationKey, setVerificationKey] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useMessageCue(error, "error");
  const verified = Boolean(previewState) || Boolean(token);
  const verifying = !verified && !interactive && !busy;
  const emailAction = busy ? "Connecting…" : verifying ? "Verifying…" : "Send sign-in code";
  const googleAction = busy ? "Connecting…" : verifying ? "Verifying…" : "Continue with Google";

  const googleMark = (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-8.8 6-15.1Z"
      />
      <path
        fill="#34a853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.2c-1.8 1.2-4.1 1.9-6.8 1.9-5.3 0-9.8-3.6-11.4-8.4H5.7v5.4A20.4 20.4 0 0 0 24 44Z"
      />
      <path
        fill="#fbbc05"
        d="M12.6 27.4a12.2 12.2 0 0 1 0-7.8v-5.4H5.7a20 20 0 0 0 0 18.6l6.9-5.4Z"
      />
      <path
        fill="#ea4335"
        d="M24 11.2c3 0 5.7 1 7.8 3.1l5.8-5.8A19.6 19.6 0 0 0 24 3a20.4 20.4 0 0 0-18.3 11.2l6.9 5.4C14.2 14.8 18.7 11.2 24 11.2Z"
      />
    </svg>
  );

  async function submit(operation: "google" | "email" | "verify") {
    if (operation !== "verify" && !verified) return;
    setBusy(true);
    setError("");

    try {
      if (operation === "google") await login(token, returnTo);
      else if (operation === "verify") {
        const redirectUrl = await verifyEmailCode(challenge, code);
        forgetCurrentUser();
        await getCurrentUser().catch(() => {});
        go(redirectUrl);
      } else {
        setChallenge(await requestEmailCode(email.trim(), token, returnTo));
        setCode("");
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);

      if (operation !== "verify") {
        setToken("");
        setInteractive(false);
        setVerificationKey((n) => n + 1);
      }
    }
  }

  const content = (
    <section
      className="signin-page"
      aria-labelledby="signin-title"
      data-step={challenge ? "code" : "email"}
    >
      <header className="signin-head" key={challenge ? "code" : "email"}>
        <h1
          id="signin-title"
          className="reveal"
          style={
            { "--i": 1 } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
        >
          {challenge ? "Check your inbox" : "Sign in"}
        </h1>
        <p
          className="reveal"
          style={
            { "--i": 2 } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
        >
          {challenge ? (
            `Enter the six-digit code sent to ${email}.`
          ) : (
            <>
              Your next game starts here.
              <br /> Sign in to play with friends and connect your agents.
            </>
          )}
        </p>
      </header>
      <div
        className="signin-card reveal"
        style={
          { "--i": 3 } satisfies CSSProperties & {
            [property: `--${string}`]: string | number | undefined;
          }
        }
      >
        {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
        {challenge ? (
          <form
            className="signin-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("verify");
            }}
          >
            <label className="ui-label" htmlFor="code">
              Sign-in code
            </label>
            <CodeField value={code} onChange={setCode} />
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Checking code…" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="signin-back"
              disabled={busy}
              onClick={() => {
                setChallenge("");
                setError("");
              }}
            >
              Use another email or request a new code
            </Button>
          </form>
        ) : (
          <>
            <Button
              className="account-google"
              size="lg"
              variant="outline"
              disabled={busy || !verified}
              aria-busy={verifying || undefined}
              onClick={() => void submit("google")}
            >
              {verifying ? <VerifyingMark /> : googleMark}
              {googleAction}
            </Button>
            <div className="signin-divider" aria-hidden="true">
              <span>or</span>
            </div>
            <form
              className="signin-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit("email");
              }}
            >
              <label className="ui-label" htmlFor="email">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {!previewState && (
                <Verification
                  key={verificationKey}
                  onToken={setToken}
                  onInteractive={setInteractive}
                />
              )}
              <Button
                type="submit"
                size="lg"
                disabled={busy || !verified}
                aria-busy={verifying || undefined}
              >
                {verifying ? <VerifyingMark /> : null}
                {emailAction}
              </Button>
            </form>
          </>
        )}
      </div>
      <p className="account-footnote">
        By continuing, you agree to our <a href="/terms">Terms of Service</a> and acknowledge our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </section>
  );

  return returnTo.startsWith("/api/v1/oauth/") ? (
    <main className="oauth-page">{content}</main>
  ) : (
    <Chrome active="account" authenticated={false}>
      {content}
    </Chrome>
  );
}

function Onboarding({
  busy,
  error,
  name,
  setName,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  name: string;
  setName: (value: string) => void;
  onSubmit: () => void;
}) {
  const shown = name.trim();

  return (
    <AccountFrame>
      <div className="onboarding">
        <h1>Choose your player name</h1>
        <p className="account-lead">
          This name appears at the table
          <br /> and on your agents.
        </p>
        <div className="onboarding-preview" aria-hidden="true" data-empty={!shown || undefined}>
          <div className="onboarding-seat" data-kind="human">
            <PlayerAvatar
              key={shown}
              name={`human:${shown || "player"}`}
              size={44}
              label="Avatar preview"
            />
            <div>
              <strong>{shown || "YourName"}</strong>
              <small>At the table</small>
            </div>
            <span className="onboarding-tag">You</span>
          </div>
          <div className="onboarding-seat" data-kind="agent">
            <PlayerAvatar name="agent:SwiftAnchor" size={44} label="Agent preview" />
            <div>
              <strong className="mono">SwiftAnchor</strong>
              <small className="mono">{shown || "YourName"} · Claude</small>
            </div>
            <span className="onboarding-tag">Agent</span>
          </div>
        </div>
        {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
        <form
          className="signin-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <label className="ui-label" htmlFor="gamertag">
            Player name
          </label>
          <Input
            id="gamertag"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]"
            aria-describedby="name-help"
            autoComplete="nickname"
          />
          <small id="name-help" className="ui-hint">
            3–20 letters, numbers or underscores. Start and end with a letter or number. Choose
            carefully, this name is permanent.
          </small>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Saving…" : "Let’s play"}
          </Button>
        </form>
      </div>
    </AccountFrame>
  );
}

function Profile({ user, returnTo }: { user: User; returnTo: string }) {
  const current = user;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useMessageCue(error, "error");
  const onboarding = current.gamertag_selected !== 1;

  async function save() {
    setBusy(true);
    setError("");

    try {
      await completeOnboarding(name.trim());
      go(returnTo);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (onboarding)
    return (
      <Onboarding
        busy={busy}
        error={error}
        name={name}
        setName={setName}
        onSubmit={() => void save()}
      />
    );

  return (
    <Chrome
      active="account"
      authenticated
      user={current}
      actions={
        <ButtonLink href="/play" variant="outline" size="sm">
          Browse games
        </ButtonLink>
      }
    >
      <div className="account-profile">
        <header className="profile-identity">
          <span className="profile-avatar reveal-pop">
            <PlayerAvatar
              name={`human:${current.gamertag}`}
              size={80}
              label={`${current.gamertag} avatar`}
            />
          </span>
          <div className="profile-name">
            <h1
              className="reveal"
              style={
                { "--i": 2 } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
            >
              {current.gamertag}
            </h1>
            <p
              className="profile-email mono reveal"
              style={
                { "--i": 3 } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
            >
              {current.email}
            </p>
          </div>
        </header>
        <div className="profile-grid">
          <div
            className="panel profile-jev-panel reveal"
            style={
              { "--i": 3 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            <TypeSafeSettings />
          </div>
          <div
            className="panel profile-webhooks-panel reveal"
            style={
              { "--i": 4 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            <AgentWebhookSettings />
          </div>
          <section
            className="panel profile-settings-panel reveal"
            style={
              { "--i": 5 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
            aria-labelledby="profile-session-title"
          >
            {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
            <div className="profile-session">
              <div>
                <h2 id="profile-session-title" className="panel-title">
                  Sessions
                </h2>
                <p>Sign out here, or end every browser session at once.</p>
              </div>
              <div className="profile-session-actions">
                <SignOutConfirmation
                  disabled={busy}
                  onConfirm={async () => {
                    setBusy(true);
                    setError("");

                    try {
                      await logout(
                        returnTo.startsWith("/design-preview")
                          ? "/design-preview/library?state=signed-out"
                          : "/",
                      );
                    } catch (e) {
                      setError(message(e));
                      setBusy(false);
                    }
                  }}
                  trigger={
                    <Button variant="destructive" className="profile-signout" disabled={busy}>
                      Sign out
                    </Button>
                  }
                />
                <SignOutConfirmation
                  allBrowsers
                  disabled={busy}
                  description="End every browser session for your account. Your connected MCP agents stay signed in."
                  onConfirm={async () => {
                    setBusy(true);
                    setError("");

                    try {
                      await logout("/", true);
                    } catch (e) {
                      setError(message(e));
                      setBusy(false);
                    }
                  }}
                  trigger={
                    <Button variant="outline" disabled={busy}>
                      Sign out of all browsers
                    </Button>
                  }
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Chrome>
  );
}

function AccountError({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <AccountFrame>
      <div className="account-problem">
        <span className="account-problem-mark" aria-hidden="true">
          !
        </span>
        <h1>Could not check your account</h1>
        <p role="alert">{detail}</p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </AccountFrame>
  );
}

export function Account() {
  const [user, setUser] = useState<User | null | undefined>(() => peekCurrentUser());
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const returnTo = safeReturnTo(
    new URLSearchParams(location.search).get("returnTo") ??
      new URLSearchParams(location.search).get("return_to"),
  );

  useEffect(() => {
    let active = true;
    const cached = peekCurrentUser();

    if (cached?.gamertag_selected === 1 && ["/login", "/onboarding"].includes(location.pathname)) {
      go(returnTo, "replace");
    } else if (cached && cached.gamertag_selected !== 1 && location.pathname === "/login") {
      go("/onboarding?returnTo=" + encodeURIComponent(returnTo), "replace");
    }

    getCurrentUser()
      .then((value) => {
        if (!active) return;

        if (
          value?.gamertag_selected === 1 &&
          ["/login", "/onboarding"].includes(location.pathname)
        ) {
          go(returnTo, "replace");

          return;
        }

        if (value && value.gamertag_selected !== 1 && location.pathname === "/login") {
          go("/onboarding?returnTo=" + encodeURIComponent(returnTo), "replace");

          return;
        }

        setUser(value);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });

    return () => {
      active = false;
    };
  }, [attempt, returnTo]);

  if (error)
    return (
      <AccountError
        detail={error}
        onRetry={() => {
          forgetCurrentUser();
          setError("");
          setAttempt((n) => n + 1);
        }}
      />
    );

  if (user === undefined)
    return (
      <Chrome active="account">
        <LoadingPanel label="Checking your account…" />
      </Chrome>
    );

  return user ? (
    <Profile user={user} returnTo={returnTo} />
  ) : (
    <SignIn returnTo={location.pathname === "/profile" ? "/profile" : returnTo} />
  );
}

/** Seeded presentation entry point; the dev route provides an isolated API adapter. */
export function AccountPreview({ state, user }: { state: string; user: User }) {
  if (state === "auth-loading")
    return (
      <Chrome active="account">
        <LoadingPanel label="Checking your account…" />
      </Chrome>
    );

  if (state === "auth-error")
    return (
      <AccountError
        detail="The connection was interrupted. Please try again."
        onRetry={() => go("/design-preview/library?state=signed-out")}
      />
    );

  if (state === "profile" || state.startsWith("jev-") || state === "auth-onboarding")
    return (
      <Profile
        user={{ ...user, gamertag_selected: state === "auth-onboarding" ? 0 : 1 }}
        returnTo="/design-preview/library"
      />
    );

  return <SignIn returnTo="/design-preview/library" previewState={state} />;
}
