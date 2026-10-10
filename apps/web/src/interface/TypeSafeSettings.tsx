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
          aria-label={`About ${label}`}
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
          Get a key
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
        if (active) setError("Could not load your TypeSafe connection.");
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
          ? "Disconnected. New requests from existing Jev seats will stop. Requests already sent may still finish."
          : "Connected. Your key will be used when you next add Jev to a room.",
      );
      await refresh();
    } catch (e) {
      setRequiresReauthentication(
        e instanceof CredentialRequestError && e.requiresReauthentication,
      );
      setError(e instanceof Error ? e.message : "Could not save your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="jev-settings" className="typesafe-settings" aria-labelledby="typesafe-heading">
      <header>
        <div className="typesafe-title">
          <JevLogo size={40} />
          <h2 id="typesafe-heading">Play with Jev</h2>
        </div>
        <span
          className="typesafe-status"
          data-state={status ? (status.connected ? "connected" : "disconnected") : "checking"}
        >
          {status ? (status.connected ? "Connected" : "Not connected") : "Checking connection"}
        </span>
      </header>
      <p>
        Connect your TypeSafe account to keep playing with Jev using your own credits. TypeSafe
        charges your account for each AI request.
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
          <span>requests today · resets at midnight UTC</span>
          <small className="mono">
            Key verified {new Date(status.verifiedAt!).toLocaleDateString()}
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
            void refresh().catch(() => setError("Could not load your TypeSafe connection."));
          }}
        >
          Try again
        </Button>
      )}
      {status && !status.available && <p>New connections are temporarily unavailable.</p>}
      {status?.available && (!status.connected || editing) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FieldLabel
            id="typesafe-key"
            label="TypeSafe API key"
            description="Your key is encrypted when saved and used only by our server."
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
            placeholder="Paste your API key"
          />
          <FieldLabel
            id="typesafe-limit"
            label="Daily request limit"
            description="This limits API requests, not dollars or games. One move can use several requests. Provider balance and rate limits still apply."
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
              I allow LLM Games to use my key for Jev in rooms I host. Jev's game view is sent to
              TypeSafe, and usage is billed to my TypeSafe account.
            </span>
          </label>
          {editing && (
            <small>
              Replacing your key stops new requests from existing Jev seats. Add Jev again in a new
              lobby to use the replacement.
            </small>
          )}
          <div className="typesafe-actions">
            <Button
              type="submit"
              disabled={busy || !consent || !apiKey.trim() || !dailyLimitIsValid}
            >
              {busy ? "Verifying key…" : editing ? "Replace key" : "Connect TypeSafe"}
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
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {status?.connected && !editing && (
        <div className="typesafe-actions">
          {status.available && (
            <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Replace key or limit
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      )}
    </section>
  );
}
