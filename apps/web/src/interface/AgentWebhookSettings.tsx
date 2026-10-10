import { CredentialReauthentication } from "./CredentialReauthentication";
import { CredentialRequestError } from "@/services/credentialError";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { ErrorMessage, StatusMessage, useMessageCue } from "./accountFeedback";
import {
  agentWebhookInstructions,
  webhookRequest,
  agentWebhookListSchema,
  type AgentWebhook,
  type AgentWebhookList,
} from "@/services/agentWebhooks";

export function AgentWebhookSettings() {
  const [status, setStatus] = useState<AgentWebhookList | null>(null);
  const [editing, setEditing] = useState<AgentWebhook | "new" | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [clearAuth, setClearAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requiresReauthentication, setRequiresReauthentication] = useState(false);
  const [notice, setNotice] = useState("");
  useMessageCue(error, "error");
  useMessageCue(notice, "success");

  async function refresh() {
    setStatus(await webhookRequest("", "GET", undefined, agentWebhookListSchema));
  }

  useEffect(() => {
    let active = true;
    webhookRequest("", "GET", undefined, agentWebhookListSchema)
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch(() => {
        if (active) setError("Could not load agent webhooks.");
      });

    return () => {
      active = false;
    };
  }, []);

  function edit(row: AgentWebhook | "new" | null) {
    setEditing(row);
    setName(row && row !== "new" ? row.name : "");
    setHeaderName(row && row !== "new" ? row.headerName : "Authorization");
    setUrl("");
    setHeaderValue("");
    setClearAuth(false);
    setError("");
    setNotice("");
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      interface WebhookWrite {
        name: string;
        headerName: string;
        url?: string;
        headerValue?: string;
      }

      const body: WebhookWrite = {
        name,
        headerName,
      };

      if (url.trim()) body.url = url.trim();

      if (clearAuth) body.headerValue = "";
      else if (headerValue.trim() || editing === "new") body.headerValue = headerValue.trim();
      await webhookRequest(
        editing === "new" ? "" : `/${editing.id}`,
        editing === "new" ? "POST" : "PUT",
        { ...body },
      );

      edit(null);
      setNotice("Webhook saved. Invite this agent from a room you host.");
      await refresh();
    } catch (e) {
      setRequiresReauthentication(
        e instanceof CredentialRequestError && e.requiresReauthentication,
      );
      setError(e instanceof Error ? e.message : "Could not save webhook.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AgentWebhook) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await webhookRequest(`/${row.id}`, "DELETE");

      if (editing !== "new" && editing?.id === row.id) edit(null);
      setNotice("Webhook removed.");
      await refresh();
    } catch (e) {
      setRequiresReauthentication(
        e instanceof CredentialRequestError && e.requiresReauthentication,
      );
      setError(e instanceof Error ? e.message : "Could not remove webhook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="agent-webhooks"
      className="agent-webhook-settings"
      aria-labelledby="agent-webhooks-heading"
    >
      <header className="webhook-heading">
        <div>
          <div className="webhook-title">
            <h2 id="agent-webhooks-heading">Agent webhooks</h2>
            {status && (
              <span
                className="typesafe-status"
                data-state={status.webhooks.length ? "connected" : undefined}
              >
                {status.webhooks.length} / 10 saved
              </span>
            )}
          </div>
          <p>Save your agents here. Invite them from any lobby you host.</p>
        </div>
        {status?.available && !editing && (
          <Button
            size="sm"
            disabled={busy || status.webhooks.length >= 10}
            data-sound="open"
            onClick={() => edit("new")}
          >
            Add webhook
          </Button>
        )}
      </header>
      {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
      {requiresReauthentication && <CredentialReauthentication />}
      {notice && <StatusMessage key={notice}>{notice}</StatusMessage>}
      {!status && !error && <p className="webhook-loading">Loading webhooks…</p>}
      {!status && error && (
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            void refresh().catch(() => setError("Could not load agent webhooks."));
          }}
        >
          Try again
        </Button>
      )}
      {status && !status.available && <p>Webhook storage is temporarily unavailable.</p>}
      {status && (
        <div className="webhook-layout">
          {status.webhooks.length > 0 && (
            <ul className="webhook-list" aria-label="Saved webhooks">
              {status.webhooks.map((row, index) => (
                <li
                  className="webhook-saved"
                  key={row.id}
                  style={
                    { "--i": index } satisfies CSSProperties & {
                      [property: `--${string}`]: string | number | undefined;
                    }
                  }
                  data-editing={editing !== "new" && editing?.id === row.id}
                >
                  <PlayerAvatar name={`agent:${row.name}`} size={36} label={`${row.name} avatar`} />
                  <div className="webhook-identity">
                    <strong>{row.name}</strong>
                    <small>{row.hostname}</small>
                  </div>
                  <div className="webhook-row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !status.available}
                      onClick={() => edit(row)}
                      aria-label={`Edit ${row.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      data-sound="close"
                      onClick={() => void remove(row)}
                      aria-label={`Remove ${row.name}`}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!editing && status.webhooks.length === 0 && (
            <p className="webhook-empty">
              No webhooks yet. Add the URL from your agent's automation settings.
            </p>
          )}
          {editing && (
            <form
              className="webhook-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <h3>{editing === "new" ? "New webhook" : "Edit webhook"}</h3>
              <div className="webhook-fields">
                <div className="webhook-field">
                  <label htmlFor="webhook-name">Agent name</label>
                  <Input
                    id="webhook-name"
                    required
                    maxLength={60}
                    value={name}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My agent"
                  />
                </div>
                <div className="webhook-field">
                  <label htmlFor="webhook-url">Webhook URL</label>
                  <Input
                    id="webhook-url"
                    type="url"
                    required={editing === "new"}
                    maxLength={2048}
                    value={url}
                    disabled={busy}
                    onChange={(e) => setUrl(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={editing === "new" ? "https://…" : "Keep saved URL"}
                    aria-describedby="webhook-url-help"
                  />
                  <small id="webhook-url-help">
                    {editing === "new"
                      ? "Invites are sent as a JSON POST."
                      : "Leave blank to keep your saved URL."}
                  </small>
                </div>
                <div className="webhook-field">
                  <label htmlFor="webhook-header">Header name</label>
                  <Input
                    id="webhook-header"
                    required
                    maxLength={80}
                    value={headerName}
                    disabled={busy}
                    onChange={(e) => setHeaderName(e.target.value)}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Authorization"
                  />
                </div>
                <div className="webhook-field">
                  <label htmlFor="webhook-value">Header value</label>
                  <Input
                    id="webhook-value"
                    type="password"
                    maxLength={2048}
                    value={headerValue}
                    disabled={busy || clearAuth}
                    onChange={(e) => setHeaderValue(e.target.value)}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={editing === "new" ? "Bearer your-token" : "Keep saved value"}
                    aria-describedby="webhook-value-help"
                  />
                  <small id="webhook-value-help">
                    {editing === "new"
                      ? "Include Bearer if required. For X-API-Key, use just the token."
                      : "Enter a new value when changing the URL or header name, or choose no authentication below."}
                  </small>
                </div>
              </div>
              {editing !== "new" && (
                <label className="webhook-clear-auth">
                  <input
                    type="checkbox"
                    checked={clearAuth}
                    disabled={busy}
                    onChange={(e) => setClearAuth(e.target.checked)}
                  />
                  Send without an authentication header
                </label>
              )}
              <footer className="webhook-editor-footer">
                <small>
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                    <path
                      d="M8 11V8a4 4 0 0 1 8 0v3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                    />
                  </svg>
                  Your URL and header value are encrypted.
                </small>
                <div className="webhook-form-actions">
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => edit(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save webhook"}
                  </Button>
                </div>
              </footer>
            </form>
          )}
        </div>
      )}
      <details className="webhook-instructions disclosure">
        <summary>Instructions for your agent</summary>
        <div>
          <p>
            Connect your agent to LLM Games MCP, then paste these instructions into its webhook
            automation.
          </p>
          <pre>{agentWebhookInstructions}</pre>
          <Button
            size="sm"
            variant="outline"
            data-sound="copy"
            onClick={() => {
              void navigator.clipboard
                .writeText(agentWebhookInstructions)
                .then(() => setNotice("Agent instructions copied."))
                .catch(() =>
                  setError("Could not copy. Select the instructions and copy them manually."),
                );
            }}
          >
            Copy instructions
          </Button>
        </div>
      </details>
    </section>
  );
}
