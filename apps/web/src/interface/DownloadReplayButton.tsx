import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { play } from "@/lib/sound";
import type { RewatchPayload } from "@/features/replay/rewatchPayload";
import { useT } from "@/i18n";

export function DownloadReplayButton({
  loadReplay,
}: {
  loadReplay: () => Promise<RewatchPayload>;
}) {
  const t = useT();
  const controller = useRef<AbortController | null>(null);

  const [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [fraction, setFraction] = useState(0);

  useEffect(() => () => controller.current?.abort(), []);

  async function download() {
    const task = new AbortController();
    controller.current = task;
    setError("");
    setFraction(0);
    setProgress(t("history.preparing"));

    try {
      const [replay, { downloadGameVideo }] = await Promise.all([
        loadReplay(),
        import("@/features/replay/downloadGameVideo"),
      ]);

      if (task.signal.aborted) return;
      await downloadGameVideo(
        replay,
        (p) => {
          if (task.signal.aborted) return;
          setFraction(
            p.phase === "rendering" && p.total
              ? p.completed / p.total
              : p.phase === "finalizing"
                ? 1
                : 0,
          );
          setProgress(
            p.phase === "rendering"
              ? t("history.creating", { completed: p.completed, total: p.total })
              : p.phase === "finalizing"
                ? t("history.finishing")
                : t("history.preparing"),
          );
        },
        task.signal,
      );

      if (!task.signal.aborted) play("success");
    } catch (e) {
      if (!task.signal.aborted) {
        play("error");
        setError(e instanceof Error ? e.message : t("history.downloadFailed"));
      }
    } finally {
      if (controller.current === task) {
        controller.current = null;
        setProgress("");
      }
    }
  }

  return (
    <div className="history-download" data-busy={Boolean(progress) || undefined}>
      <div className="history-download-row">
        <Button
          size="sm"
          variant="secondary"
          className="history-download-button"
          disabled={Boolean(progress)}
          onClick={() => void download()}
        >
          <Icon name="download" size={16} />
          <span className="tabular">{progress || t("history.download")}</span>
        </Button>
        {progress && (
          <Button
            size="sm"
            variant="ghost"
            data-sound="close"
            onClick={() => {
              controller.current?.abort();
              setProgress("");
            }}
          >
            {t("profile.cancel")}
          </Button>
        )}
      </div>
      {progress && (
        <span className="history-download-bar" aria-hidden="true">
          <i
            data-indeterminate={fraction === 0 || undefined}
            style={
              { "--progress": fraction } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          />
        </span>
      )}
      {error && (
        <p role="alert" className="is-shaking">
          {error}
        </p>
      )}
    </div>
  );
}
