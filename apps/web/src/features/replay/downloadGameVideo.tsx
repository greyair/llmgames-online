import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { GameBoard } from "@/game-ui/GameBoard";
import { MatchDesk } from "@/game-ui/MatchDesk";
import { readOnlyReplayState, type RewatchPayload } from "./rewatchPayload";
import { exportReplayMp4, downloadReplayBlob, type ReplayExportProgress } from "./replayMp4";
import { replayFilename } from "./replayTimeline";

export async function downloadGameVideo(
  replay: RewatchPayload,
  onProgress: (progress: ReplayExportProgress) => void,
  signal: AbortSignal,
) {
  const iframe = document.createElement("iframe");
  iframe.title = "Video rendering";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1280px;height:720px;border:0;pointer-events:none;";
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write('<!doctype html><html><head></head><body><div id="video-stage"></div></body></html>');
  doc.close();
  const base = doc.createElement("base");
  base.href = document.baseURI;
  doc.head.append(base);
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme;

  for (const style of document.querySelectorAll('style,link[rel="stylesheet"]'))
    doc.head.append(style.cloneNode(true));
  const style = doc.createElement("style");
  style.textContent =
    "html,body,#video-stage{margin:0;width:1280px;height:720px;overflow:hidden}#video-stage{background:var(--card)}*,*::before,*::after{animation:none!important;transition:none!important}.preview-console{display:none!important}";
  doc.head.append(style);
  const stage = doc.getElementById("video-stage")!;
  const root = createRoot(stage);

  try {
    await Promise.all(
      [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) =>
        link.sheet
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              link.onload = () => resolve();
              link.onerror = () => reject(new Error("Could not load the video styles."));
            }),
      ),
    );

    const blob = await exportReplayMp4({
      frames: replay.frames,
      stage,
      title: `${replay.gameType} replay`,
      signal,
      onProgress,
      prepareFrame: async (frame, index) => {
        if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
        const state = { ...readOnlyReplayState(frame.state), type: replay.gameType };
        // Each exported still must start at its authoritative snapshot, without carrying
        // animation queues or transient board state forward from the previous frame.
        flushSync(() =>
          root.render(
            <MatchDesk key={index} state={state} onExit={() => {}}>
              <GameBoard state={state} />
            </MatchDesk>,
          ),
        );
        await doc.fonts.ready;
        await Promise.all(
          [...stage.querySelectorAll("img")].map((img) => img.decode().catch(() => {})),
        );
      },
    });

    if (!signal.aborted) downloadReplayBlob(blob, replayFilename(replay.gameType));
  } finally {
    root.unmount();
    iframe.remove();
  }
}
