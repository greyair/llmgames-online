import { z } from "zod";

const statusSchema = z.object({
  available: z.boolean(),
  connected: z.boolean(),
  trialAvailable: z.boolean(),
  verifiedAt: z.number().nullable(),
  dailyLimit: z.number(),
  callsToday: z.number(),
});

const errorSchema = z.object({ error: z.string().optional(), code: z.string().optional() });

import { CredentialReauthentication } from "./CredentialReauthentication";
import { Icon } from "@/components/ui/icon";
import { CredentialRequestError } from "@/services/credentialError";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JevLogo } from "@/game-ui/GamePlayerAvatar";
import { ErrorMessage, StatusMessage, useMessageCue } from "./accountFeedback";
import { useLocale, useT } from "@/i18n";

type Status = {
  available: boolean;
  connected: boolean;
  trialAvailable: boolean;
  verifiedAt: number | null;
  dailyLimit: number;
  callsToday: number;
};

const endpoint = "/api/v1/auth/users/me/typesafe";

function FieldLabel({
  id,
  label,
  description,
  keyLink = false,
}: {
  id: string;
  label: string;
  description: string;
  keyLink?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="typesafe-field-label">
      <label htmlFor={id}>{label}</label>
      <span
        className="typesafe-help"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          className="typesafe-help-button"
          aria-label={t("typesafe.about", { label })}
          aria-describedby={`${id}-help`}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              e.stopPropagation();
            }
          }}
        >
          <Icon name="info" size={18} />
        </button>
        <span id={`${id}-help`} role="tooltip" className="typesafe-tooltip" hidden={!open}>
          {description}
        </span>
      </span>
      {keyLink && (
        <a
          className="typesafe-key-link"
          href="https://console.typesafe.ai/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("typesafe.getKey")}
        </a>
      )}
    </div>
  );
}

interface TypeSafeWrite {
  apiKey: string;
  dailyLimit: number;
  consent: boolean;
}

const connectionChangeSchema = z.object({
  connected: z.boolean(),
  verifiedAt: z.number().optional(),
});

function request(): Promise<Status>;
function request(
  method: string,
  body?: TypeSafeWrite,
): Promise<z.output<typeof connectionChangeSchema>>;
async function request(
  method = "GET",
  body?: TypeSafeWrite,
): Promise<Status | z.output<typeof connectionChangeSchema>> {
  const response = await fetch(endpoint, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  const failure = errorSchema.safeParse(data).data;

  if (!response.ok)
    throw new CredentialRequestError(
      failure?.error || "Could not load your TypeSafe connection.",
      failure?.code,
    );

  return method === "GET" ? statusSchema.parse(data) : connectionChangeSchema.parse(data);
}

export function TypeSafeSettings() {
  const t = useT();
  const locale = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [dailyLimit, setDailyLimit] = useState("10000");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requiresReauthentication, setRequiresReauthentication] = useState(false);
  const [message, setMessage] = useState("");
  useMessageCue(error, "error");
  useMessageCue(message, "success");
  const parsedDailyLimit = Number(dailyLimit);

  const dailyLimitIsValid =
    dailyLimit.trim() !== "" &&
    Number.isInteger(parsedDailyLimit) &&
    parsedDailyLimit >= 1 &&
    parsedDailyLimit <= 100000;

  async function refresh() {
    const data: Status = await request();
    setStatus(data);
    setDailyLimit(String(data.dailyLimit));
  }

  useEffect(() => {
    let active = true;
    request()
      .then((data: Status) => {
        if (active) {
          setStatus(data);
          setDailyLimit(String(data.dailyLimit));
        }
      })
      .catch(() => {
        if (active) setError(t("typesafe.loadFailed"));
      });

    return () => {
      active = false;
    };
  }, []);

  async function save(remove = false) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await request(
        remove ? "DELETE" : "PUT",
        remove ? undefined : { apiKey, dailyLimit: parsedDailyLimit, consent },
      );
      setApiKey("");
      setConsent(false);
      setEditing(false);
      setMessage(
        remove
          ? t("typesafe.disconnected")
          : t("typesafe.saved"),
      );
      await refresh();
    } catch (e) {
      setRequiresReauthentication(
        e instanceof CredentialRequestError && e.requiresReauthentication,
      );
      setError(locale === "zh-CN" && e instanceof CredentialRequestError && e.requiresReauthentication ? t("profile.reauthenticationRequired") : e instanceof Error ? e.message : t("typesafe.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="jev-settings" className="typesafe-settings" aria-labelledby="typesafe-heading">
      <header>
        <div className="typesafe-title">
          <JevLogo size={40} />
          <h2 id="typesafe-heading">{t("typesafe.title")}</h2>
        </div>
        <span
          className="typesafe-status"
          data-state={status ? (status.connected ? "connected" : "disconnected") : "checking"}
        >
          {t(status ? (status.connected ? "typesafe.connected" : "typesafe.notConnected") : "typesafe.checking")}
        </span>
      </header>
      <p>
        {t("typesafe.lead")}
      </p>
      {status?.connected && (
        <div className="typesafe-usage">
          <strong>
            {status.callsToday.toLocaleString()} / {status.dailyLimit.toLocaleString()}
          </strong>
          <div className="typesafe-meter" aria-hidden="true">
            <i
              style={{
                width: `${Math.min(100, Math.max(2, (status.callsToday / Math.max(1, status.dailyLimit)) * 100))}%`,
              }}
            />
          </div>
          <span>{t("typesafe.usage")}</span>
          <small className="mono">
            {t("typesafe.verified", { date: new Date(status.verifiedAt!).toLocaleDateString() })}
          </small>
        </div>
      )}
      {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
      {requiresReauthentication && <CredentialReauthentication />}
      {message && <StatusMessage key={message}>{message}</StatusMessage>}
      {!status && error && (
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            void refresh().catch(() => setError(t("typesafe.loadFailed")));
          }}
        >
          {t("common.retry")}
        </Button>
      )}
      {status && !status.available && <p>{t("typesafe.unavailable")}</p>}
      {status?.available && (!status.connected || editing) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FieldLabel
            id="typesafe-key"
            label={t("typesafe.key")}
            description={t("typesafe.keyHelp")}
            keyLink
          />
          <Input
            id="typesafe-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            autoCapitalize="none"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            minLength={10}
            maxLength={512}
            required
            disabled={busy}
            aria-describedby="typesafe-key-help"
            placeholder={t("typesafe.keyPlaceholder")}
          />
          <FieldLabel
            id="typesafe-limit"
            label={t("typesafe.limit")}
            description={t("typesafe.limitHelp")}
          />
          <Input
            id="typesafe-limit"
            type="number"
            min={1}
            max={100000}
            step={1}
            required
            disabled={busy}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            aria-describedby="typesafe-limit-help"
          />
          <label className="typesafe-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
              disabled={busy}
            />
            <span>
              {t("typesafe.consent")}
            </span>
          </label>
          {editing && (
            <small>
              {t("typesafe.replaceHelp")}
            </small>
          )}
          <div className="typesafe-actions">
            <Button
              type="submit"
              disabled={busy || !consent || !apiKey.trim() || !dailyLimitIsValid}
            >
              {t(busy ? "typesafe.verifying" : editing ? "typesafe.replace" : "typesafe.connect")}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                  setConsent(false);
                }}
              >
                {t("profile.cancel")}
              </Button>
            )}
          </div>
        </form>
      )}
      {status?.connected && !editing && (
        <div className="typesafe-actions">
          {status.available && (
            <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              {t("typesafe.replaceLimit")}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
            {t(busy ? "typesafe.disconnecting" : "typesafe.disconnect")}
          </Button>
        </div>
      )}
    </section>
  );
}
