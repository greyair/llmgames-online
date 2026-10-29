import { CredentialReauthentication } from "./CredentialReauthentication";
import { CredentialRequestError } from "@/services/credentialError";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { ErrorMessage, StatusMessage, useMessageCue } from "./accountFeedback";
import { useLocale, useT } from "@/i18n";
import {
  agentWebhookInstructions,
  webhookRequest,
  agentWebhookListSchema,
  type AgentWebhook,
  type AgentWebhookList,
} from "@/services/agentWebhooks";

export function AgentWebhookSettings() {
  const t = useT();
  const locale = useLocale();
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
        if (active) setError(t("webhook.loadFailed"));
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
      setNotice(t("webhook.saved"));
      await refresh();
    } catch (e) {
      setRequiresReauthentication(
        e instanceof CredentialRequestError && e.requiresReauthentication,
      );
      setError(locale === "zh-CN" && e instanceof CredentialRequestError && e.requiresReauthentication ? t("profile.reauthenticationRequired") : e instanceof Error ? e.message : t("webhook.saveFailed"));
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
      setNotice(t("webhook.removed"));
      await refresh();
    } catch (e) {
      setRequiresReauthentication(
        e instanceof CredentialRequestError && e.requiresReauthentication,
      );
      setError(locale === "zh-CN" && e instanceof CredentialRequestError && e.requiresReauthentication ? t("profile.reauthenticationRequired") : e instanceof Error ? e.message : t("webhook.removeFailed"));
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
            <h2 id="agent-webhooks-heading">{t("webhook.title")}</h2>
            {status && (
              <span
                className="typesafe-status"
                data-state={status.webhooks.length ? "connected" : undefined}
              >
                {t("webhook.savedCount", { count: status.webhooks.length })}
              </span>
            )}
          </div>
          <p>{t("webhook.lead")}</p>
        </div>
        {status?.available && !editing && (
          <Button
            size="sm"
            disabled={busy || status.webhooks.length >= 10}
            data-sound="open"
            onClick={() => edit("new")}
          >
            {t("setup.addWebhook")}
          </Button>
        )}
      </header>
      {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
      {requiresReauthentication && <CredentialReauthentication />}
      {notice && <StatusMessage key={notice}>{notice}</StatusMessage>}
      {!status && !error && <p className="webhook-loading">{t("webhook.loading")}</p>}
      {!status && error && (
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            void refresh().catch(() => setError(t("webhook.loadFailed")));
          }}
        >
          {t("common.retry")}
        </Button>
      )}
      {status && !status.available && <p>{t("webhook.unavailable")}</p>}
      {status && (
        <div className="webhook-layout">
          {status.webhooks.length > 0 && (
            <ul className="webhook-list" aria-label={t("webhook.list")}>
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
                      aria-label={t("webhook.editName", { name: row.name })}
                    >
                      {t("webhook.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      data-sound="close"
                      onClick={() => void remove(row)}
                      aria-label={t("archive.removeName", { name: row.name })}
                    >
                      {t("archive.remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!editing && status.webhooks.length === 0 && (
            <p className="webhook-empty">
              {t("webhook.empty")}
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
              <h3>{t(editing === "new" ? "webhook.new" : "webhook.editTitle")}</h3>
              <div className="webhook-fields">
                <div className="webhook-field">
                  <label htmlFor="webhook-name">{t("webhook.agentName")}</label>
                  <Input
                    id="webhook-name"
                    required
                    maxLength={60}
                    value={name}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("webhook.agentPlaceholder")}
                  />
                </div>
                <div className="webhook-field">
                  <label htmlFor="webhook-url">{t("webhook.url")}</label>
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
                    placeholder={editing === "new" ? "https://…" : t("webhook.keepUrl")}
                    aria-describedby="webhook-url-help"
                  />
                  <small id="webhook-url-help">
                    {editing === "new"
                      ? t("webhook.postHelp")
                      : t("webhook.keepUrlHelp")}
                  </small>
                </div>
                <div className="webhook-field">
                  <label htmlFor="webhook-header">{t("webhook.header")}</label>
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
                  <label htmlFor="webhook-value">{t("webhook.value")}</label>
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
                    placeholder={editing === "new" ? "Bearer your-token" : t("webhook.keepValue")}
                    aria-describedby="webhook-value-help"
                  />
                  <small id="webhook-value-help">
                    {editing === "new"
                      ? t("webhook.valueHelp")
                      : t("webhook.valueEditHelp")}
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
                  {t("webhook.noAuth")}
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
                  {t("webhook.encrypted")}
                </small>
                <div className="webhook-form-actions">
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => edit(null)}>
                    {t("profile.cancel")}
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {t(busy ? "onboarding.saving" : "webhook.save")}
                  </Button>
                </div>
              </footer>
            </form>
          )}
        </div>
      )}
      <details className="webhook-instructions disclosure">
        <summary>{t("webhook.instructions")}</summary>
        <div>
          <p>
            {t("webhook.instructionsHelp")}
          </p>
          <pre>{agentWebhookInstructions}</pre>
          <Button
            size="sm"
            variant="outline"
            data-sound="copy"
            onClick={() => {
              void navigator.clipboard
                .writeText(agentWebhookInstructions)
                .then(() => setNotice(t("webhook.copied")))
                .catch(() =>
                  setError(t("webhook.copyFailed")),
                );
            }}
          >
            {t("webhook.copyInstructions")}
          </Button>
        </div>
      </details>
    </section>
  );
}
