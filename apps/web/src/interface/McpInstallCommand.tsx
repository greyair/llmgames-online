import { useCallback, useState, useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { play } from "@/lib/sound";
import "./mcp-install.css";
import { McpHostIcon, type McpHostIconId } from "./McpHostIcon";
import { useT, type MessageKey } from "@/i18n";

import { SITE_URL } from "@/lib/siteMetadata";

const MCP_URL = import.meta.env.PUBLIC_MCP_URL || `${SITE_URL}/api/v1/mcp`;

const CONNECT_PROMPT = `Add the llmgames remote MCP server to this agent using ${MCP_URL} and name it llmgames. Use the native MCP setup flow. If it opens OAuth in my default browser, tell me to complete it there and do not open the authorization URL in another browser. Wait for the CLI callback, then verify authentication.`;

type McpHost = {
  id: string;
  name: string;
  shortName: string;
  icon: McpHostIconId;
  command: string;
  label: string;
  note: string;
};

const MCP_HOSTS: McpHost[] = [
  {
    id: "codex",
    name: "Codex CLI",
    shortName: "Codex",
    icon: "codex",
    command: `codex mcp add llmgames --url ${MCP_URL}`,
    label: "Terminal command",
    note: "Running this command opens the llmgames authorization page in your default browser. Complete OAuth there. If no page opens, run `codex mcp login llmgames`.",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    shortName: "Claude",
    icon: "claude",
    command: `claude mcp add --transport http llmgames ${MCP_URL}`,
    label: "Terminal command",
    note: "Open `/mcp` in Claude Code and start authentication for llmgames. Complete OAuth in the browser Claude Code opens. Do not reopen the authorization URL elsewhere. Return to Claude Code and wait for it to confirm the callback.",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    shortName: "Gemini",
    icon: "gemini",
    command: `gemini mcp add llmgames ${MCP_URL} --transport http`,
    label: "Terminal command",
    note: "Start Gemini and connect to llmgames. Complete OAuth in the browser Gemini opens. Do not reopen the authorization URL elsewhere. Return to Gemini and wait for it to confirm the callback.",
  },
  {
    id: "cursor",
    name: "Cursor",
    shortName: "Cursor",
    icon: "cursor",
    command: `{
  "mcpServers": {
    "llmgames": { "url": "${MCP_URL}" }
  }
}`,
    label: ".cursor/mcp.json",
    note: "Add this as project config, or use `~/.cursor/mcp.json` to make it available everywhere. Start authentication from Cursor's MCP settings, complete OAuth in the browser Cursor opens, and return to Cursor for callback verification. Do not reopen the authorization URL elsewhere.",
  },
  {
    id: "grok",
    name: "Grok",
    shortName: "Grok",
    icon: "grok",
    command: MCP_URL,
    label: "Remote MCP URL",
    note: "Open `/mcps`, add a remote server, paste this URL, then select Authenticate. Complete OAuth in the browser Grok opens and return to Grok for callback verification. Do not reopen the authorization URL elsewhere.",
  },
];

export function McpInstallCommand({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const instanceId = useId();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [activeHostId, setActiveHostId] = useState(MCP_HOSTS[0]!.id);
  const [promptCopied, setPromptCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const activeHost = MCP_HOSTS.find((host) => host.id === activeHostId) ?? MCP_HOSTS[0]!;
  const isTerminal = activeHost.label === "Terminal command";

  const notes = {
    codex: "setup.noteCodex", "claude-code": "setup.noteClaude", "gemini-cli": "setup.noteGemini", cursor: "setup.noteCursor", grok: "setup.noteGrok",
  } satisfies Record<string, MessageKey>;

  const noteKey = Object.entries(notes).find(([id]) => id === activeHost.id)?.[1];

  const selectHost = useCallback((hostId: string) => {
    setActiveHostId(hostId);
    setCommandCopied(false);
  }, []);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CONNECT_PROMPT);
      play("copy");
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1600);
    } catch {
      setPromptCopied(false);
    }
  }, []);

  const copyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activeHost.command);
      play("copy");
      setCommandCopied(true);
      window.setTimeout(() => setCommandCopied(false), 1600);
    } catch {
      setCommandCopied(false);
    }
  }, [activeHost.command]);

  return (
    <div className="mcp-connect-flow" data-compact={compact || undefined}>
      <section className="mcp-prompt-card" aria-label={t("setup.prompt")}>
        <div className="mcp-card-head">
          <span className="mcp-card-title">{t("setup.promptTitle")}</span>
          {!compact && <span className="mcp-card-hint">{t("setup.noKey")}</span>}
        </div>
        <div className="mcp-prompt-content">
          <p className="connection-prompt">{CONNECT_PROMPT}</p>
          <Button
            disabled={!ready}
            type="button"
            onClick={copyPrompt}
            className="mcp-prompt-copy"
            data-sound="none"
            aria-label={t(promptCopied ? "setup.copied" : "setup.copyPrompt")}
            data-copied={promptCopied || undefined}
          >
            <Icon name={promptCopied ? "check" : "copy"} size={14} />
            <span>{t(promptCopied ? "setup.copied" : "setup.copyPrompt")}</span>
          </Button>
        </div>
      </section>
      <section
        aria-label={t("setup.manualLabel")}
        className="mcp-command mcp-manual-card"
      >
        <div className="mcp-card-head mcp-manual-head">
          <span className="mcp-card-title">{t("setup.manual")}</span>
          <div className="mcp-host-tabs" role="tablist" aria-label={t("setup.chooseAgent")}>
            {MCP_HOSTS.map((host) => {
              const active = activeHost.id === host.id;

              return (
                <button
                  disabled={!ready}
                  key={host.id}
                  type="button"
                  role="tab"
                  className="mcp-host-tab"
                  aria-selected={active}
                  aria-controls={`${instanceId}-panel`}
                  id={`${instanceId}-${host.id}`}
                  tabIndex={active ? 0 : -1}
                  onKeyDown={(event) => {
                    const index = MCP_HOSTS.findIndex((item) => item.id === host.id);

                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % MCP_HOSTS.length
                        : event.key === "ArrowLeft"
                          ? (index + MCP_HOSTS.length - 1) % MCP_HOSTS.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? MCP_HOSTS.length - 1
                              : -1;

                    if (next < 0) return;
                    event.preventDefault();
                    selectHost(MCP_HOSTS[next]!.id);
                    document.getElementById(`${instanceId}-${MCP_HOSTS[next]!.id}`)?.focus();
                  }}
                  onClick={() => selectHost(host.id)}
                >
                  <McpHostIcon host={host.icon} width={14} height={14} />
                  {host.shortName}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id={`${instanceId}-panel`}
          aria-labelledby={`${instanceId}-${activeHost.id}`}
          role="tabpanel"
          className="mcp-host-panel"
        >
          <div className="mcp-host-meta">
            <span className="mcp-host-name">{activeHost.name}</span>
            <span className="mcp-host-label">{isTerminal ? t("setup.terminal") : activeHost.label === "Remote MCP URL" ? t("setup.remoteUrl") : activeHost.label}</span>
          </div>
          <div className="mcp-code" data-surface="dark">
            <div tabIndex={0} role="region" aria-label={t("setup.command")} className="mcp-code-scroll">
              {isTerminal && (
                <span className="mcp-code-prompt" aria-hidden="true">
                  $
                </span>
              )}
              <pre data-terminal={isTerminal || undefined}>
                <code>{activeHost.command}</code>
              </pre>
            </div>
            <Button
              disabled={!ready}
              type="button"
              onClick={copyCommand}
              variant="ghost"
              size="icon"
              className="mcp-code-copy"
              data-sound="none"
              data-copied={commandCopied || undefined}
              aria-label={t(commandCopied ? "setup.copied" : "setup.copyCommand")}
            >
              <Icon name={commandCopied ? "check" : "copy"} size={14} />
            </Button>
          </div>
          {!compact && (
            <p className="mcp-host-note">
              {(noteKey ? t(noteKey) : activeHost.note)
                .split(/(`[^`]+`)/g)
                .map((part, index) =>
                  part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part,
                )}{" "}
              {t("setup.noKeyFull")}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
