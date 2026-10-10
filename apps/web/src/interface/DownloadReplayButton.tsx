import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { play } from "@/lib/sound";
import type { RewatchPayload } from "@/features/replay/rewatchPayload";

export function DownloadReplayButton({
  loadReplay,
}: {
  loadReplay: () => Promise<RewatchPayload>;
}) {
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
    setProgress("Preparing MP4…");

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
              ? `Creating MP4 ${p.completed}/${p.total}`
              : p.phase === "finalizing"
                ? "Finishing MP4…"
                : "Preparing MP4…",
          );
        },
        task.signal,
      );

      if (!task.signal.aborted) play("success");
    } catch (e) {
      if (!task.signal.aborted) {
        play("error");
        setError(e instanceof Error ? e.message : "Could not create the MP4.");
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
          <span className="tabular">{progress || "Download video"}</span>
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
            Cancel
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
