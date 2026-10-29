import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  webhookRequest,
  agentWebhookListSchema,
  type AgentWebhookList,
} from "@/services/agentWebhooks";

export function AgentWebhookInvites({ roomCode, allowed }: { roomCode: string; allowed: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<AgentWebhookList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const sending = useRef(false);
  useEffect(() => {
    let active = true;

    const refresh = () =>
      webhookRequest("", "GET", undefined, agentWebhookListSchema)
        .then((data) => {
          if (active) {
            setStatus(data);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError(t("webhook.inviteLoadFailed"));
        });

    void refresh();
    window.addEventListener("focus", refresh);

    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function invite(id: string, name: string) {
    if (!allowed || sending.current) return;
    sending.current = true;
    setBusy(id);
    setError("");
    setNotice("");

    try {
      await webhookRequest(`/${id}/invite`, "POST", { roomCode });
      setSent((previous) => ({ ...previous, [id]: true }));
      setNotice(t("webhook.inviteDelivered", { name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("webhook.inviteFailed"));
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="lobby-jev lobby-webhooks" aria-label={t("webhook.inviteTitle")}>
      <div>
        <strong>
          <span className="lobby-webhooks-dot" aria-hidden="true" />
          {t("webhook.inviteTitle")}
        </strong>
        <p>
          {status?.webhooks.length
            ? t("webhook.inviteHelp")
            : t("webhook.inviteEmpty")}
        </p>
      </div>
      <div className="lobby-jev-actions">
        {status?.webhooks.map((row) => (
          <Button
            key={row.id}
            size="sm"
            variant="secondary"
            disabled={!allowed || !status.available || busy !== null || sent[row.id]}
            onClick={() => void invite(row.id, row.name)}
          >
            {busy === row.id
              ? t("webhook.inviting", { name: row.name })
              : sent[row.id]
                ? t("webhook.invited", { name: row.name })
                : t("webhook.invite", { name: row.name })}
          </Button>
        ))}
        <ButtonLink
          size="sm"
          variant="ghost"
          href="/profile#agent-webhooks"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("setup.addWebhook")}
        </ButtonLink>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
