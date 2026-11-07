import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/i18n";
import { CredentialReauthentication } from "./CredentialReauthentication";
import { CredentialRequestError } from "@/services/credentialError";
import { ErrorMessage, StatusMessage, useMessageCue } from "./accountFeedback";
import {
  personalTokenCreatedSchema,
  personalTokenListSchema,
  personalTokenRequest,
  personalTokenRevokedSchema,
  personalTokenUsage,
  type PersonalToken,
  type PersonalTokenList,
} from "@/services/mcpTokens";
import "./mcp-tokens.css";

/**
 * MCP personal access tokens.
 *
 * The one rule the UI has to carry: a token is shown exactly once. Creation
 * returns it inline, it is never re-fetchable, and there is no "show again"
 * affordance that would imply otherwise.
 */
export function McpTokenSettings() {
  const t = useT();
  const locale = useLocale();
  const [list, setList] = useState<PersonalTokenList | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requiresReauthentication, setRequiresReauthentication] = useState(false);
  useMessageCue(error, "error");
  useMessageCue(notice, "success");

  const date = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    dateStyle: "medium",
  });

  const format = (value: number | null) => (value ? date.format(new Date(value * 1000)) : "");

  async function refresh() {
    setList(await personalTokenRequest("", "GET", personalTokenListSchema));
  }

  useEffect(() => {
    let active = true;

    personalTokenRequest("", "GET", personalTokenListSchema)
      .then((data) => {
        if (active) setList(data);
      })
      .catch(() => {
        if (active) setError(t("mcpToken.loadFailed"));
      });

    return () => {
      active = false;
    };
  }, []);

  /** Turn whatever the request threw into one inline message. */
  function handleFailure(error: Error) {
    setRequiresReauthentication(
      error instanceof CredentialRequestError && error.requiresReauthentication,
    );
    setError(error.message);
  }

  async function create() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const created = await personalTokenRequest("", "POST", personalTokenCreatedSchema, {
        name: name.trim(),
        expiresInDays: days,
      });

      setFresh(created.token);
      setCopied(false);
      setCreating(false);
      setName("");
      setNotice(t("mcpToken.createdNotice"));
      await refresh();
    } catch (error) {
      handleFailure(error instanceof Error ? error : new Error(t("mcpToken.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: PersonalToken) {
    if (!window.confirm(t("mcpToken.revokeConfirm", { name: token.name }))) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await personalTokenRequest(`/${token.id}`, "DELETE", personalTokenRevokedSchema);
      setNotice(t("mcpToken.revokedNotice"));
      await refresh();
    } catch (error) {
      handleFailure(error instanceof Error ? error : new Error(t("mcpToken.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!fresh) return;

    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      // Clipboard permission can be denied; the value stays selectable.
      setCopied(false);
    }
  }

  const active = list?.tokens.filter((token) => !token.revokedAt && !token.expired).length ?? 0;
  const atLimit = list ? active >= list.maxActive : false;

  return (
    <section id="mcp-tokens" className="mcp-token-settings" aria-labelledby="mcp-tokens-heading">
      <header className="mcp-token-heading">
        <div>
          <div className="mcp-token-title">
            <h2 id="mcp-tokens-heading" className="panel-title">
              {t("mcpToken.title")}
            </h2>
            {list && (
              <span className="mcp-token-count" data-full={atLimit || undefined}>
                {t("mcpToken.count", { count: active, max: list.maxActive })}
              </span>
            )}
          </div>
          <p>{t("mcpToken.lead")}</p>
        </div>
        {list && !creating && (
          <Button size="sm" disabled={busy || atLimit} onClick={() => setCreating(true)}>
            {t("mcpToken.create")}
          </Button>
        )}
      </header>

      {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
      {requiresReauthentication && <CredentialReauthentication />}
      {notice && <StatusMessage key={notice}>{notice}</StatusMessage>}

      {fresh && (
        <div className="mcp-token-reveal" role="group" aria-label={t("mcpToken.revealTitle")}>
          <strong>{t("mcpToken.revealTitle")}</strong>
          <code className="mcp-token-secret">{fresh}</code>
          <p>{t("mcpToken.revealNote")}</p>
          <p className="mcp-token-usage">
            <span>{t("mcpToken.usageLabel")}</span>
            <code>{personalTokenUsage}</code>
          </p>
          <div className="mcp-token-reveal-actions">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? t("mcpToken.copied") : t("mcpToken.copy")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
              {t("mcpToken.dismiss")}
            </Button>
          </div>
        </div>
      )}

      {creating && (
        <form
          className="mcp-token-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="mcp-token-field">
            <label htmlFor="mcp-token-name">{t("mcpToken.name")}</label>
            <Input
              id="mcp-token-name"
              required
              maxLength={40}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("mcpToken.namePlaceholder")}
              autoComplete="off"
            />
          </div>
          <div className="mcp-token-field">
            <label htmlFor="mcp-token-days">{t("mcpToken.expiry")}</label>
            <select
              id="mcp-token-days"
              className="mcp-token-select"
              value={days}
              disabled={busy}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              {[30, 90, 180, 365].map((option) => (
                <option key={option} value={option}>
                  {t("mcpToken.days", { count: option })}
                </option>
              ))}
            </select>
          </div>
          <div className="mcp-token-form-actions">
            <Button size="sm" type="submit" disabled={busy || !name.trim()}>
              {t("mcpToken.create")}
            </Button>
            <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
              {t("mcpToken.cancel")}
            </Button>
          </div>
        </form>
      )}

      {!list && !error && <p className="mcp-token-empty">{t("common.loading")}</p>}

      {list && list.tokens.length === 0 && (
        <p className="mcp-token-empty">{t("mcpToken.empty")}</p>
      )}

      {list && list.tokens.length > 0 && (
        <ul className="mcp-token-list" aria-label={t("mcpToken.title")}>
          {list.tokens.map((token) => {
            const inactive = Boolean(token.revokedAt) || token.expired;

            return (
              <li key={token.id} className="mcp-token-row" data-inactive={inactive || undefined}>
                <div className="mcp-token-identity">
                  <strong>{token.name}</strong>
                  <small>
                    {t("mcpToken.created", { date: format(token.createdAt) })} ·{" "}
                    {t("mcpToken.expires", { date: format(token.expiresAt) })} ·{" "}
                    {token.lastUsedAt
                      ? t("mcpToken.lastUsed", { date: format(token.lastUsedAt) })
                      : t("mcpToken.neverUsed")}
                  </small>
                </div>
                {token.revokedAt ? (
                  <span className="mcp-token-state">{t("mcpToken.revoked")}</span>
                ) : token.expired ? (
                  <span className="mcp-token-state">{t("mcpToken.expired")}</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void revoke(token)}
                    aria-label={t("mcpToken.revokeName", { name: token.name })}
                  >
                    {t("mcpToken.revoke")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mcp-token-footnote">{t("mcpToken.footnote")}</p>
    </section>
  );
}
