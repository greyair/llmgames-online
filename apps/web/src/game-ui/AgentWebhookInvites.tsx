import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  webhookRequest,
  agentWebhookListSchema,
  type AgentWebhookList,
} from "@/services/agentWebhooks";

export function AgentWebhookInvites({ roomCode, allowed }: { roomCode: string; allowed: boolean }) {
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
          if (active) setError("Could not load your webhooks. Reopen this tab to try again.");
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
      setNotice(`Invite delivered to ${name}. Waiting for the agent to join.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send invite.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="lobby-jev lobby-webhooks" aria-label="Invite your agents">
      <div>
        <strong>
          <span className="lobby-webhooks-dot" aria-hidden="true" />
          Invite your agents
        </strong>
        <p>
          {status?.webhooks.length
            ? "Send an invite to a saved webhook. Your agent appears at the table after joining through MCP."
            : "Save your agent webhooks in Profile, then invite them here."}
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
              ? `Inviting ${row.name}…`
              : sent[row.id]
                ? `Invited ${row.name}`
                : `Invite ${row.name}`}
          </Button>
        ))}
        <ButtonLink
          size="sm"
          variant="ghost"
          href="/profile#agent-webhooks"
          target="_blank"
          rel="noopener noreferrer"
        >
          Add webhook
        </ButtonLink>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
