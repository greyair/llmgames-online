import { renderReplayAudio } from "./replayAudio";
import { buildReplayTimeline, type ReplayTimelineFrame } from "./replayTimeline";

const REPLAY_VIDEO_WIDTH = 1280;

const REPLAY_VIDEO_HEIGHT = 720;

export type ReplayExportProgress = {
  phase: "preparing" | "rendering" | "audio" | "finalizing";
  completed: number;
  total: number;
};

export type ReplayMp4Options<TFrame extends ReplayTimelineFrame> = {
  frames: TFrame[];
  stage: HTMLElement;
  title: string;
  prepareFrame: (frame: TFrame, index: number) => Promise<void>;
  onProgress?: (progress: ReplayExportProgress) => void;
  signal?: AbortSignal;
};

let customAacRegistered = false;

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException("Replay export canceled", "AbortError");
}

async function nextPaint() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function exportReplayMp4<TFrame extends ReplayTimelineFrame>({
  frames,
  stage,
  title,
  prepareFrame,
  onProgress,
  signal,
}: ReplayMp4Options<TFrame>): Promise<Blob> {
  if (frames.length === 0) throw new Error("This replay has no frames to export.");

  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("This browser cannot create the replay audio track.");
  }

  onProgress?.({ phase: "preparing", completed: 0, total: frames.length });
  throwIfAborted(signal);

  const [media, screenshot] = await Promise.all([
    import("mediabunny"),
    import("modern-screenshot"),
  ]);

  const quality = new media.Quality("high");

  const canEncodeAvc = await media.canEncodeVideo("avc", {
    width: REPLAY_VIDEO_WIDTH,
    height: REPLAY_VIDEO_HEIGHT,
    quality,
  });

  if (!canEncodeAvc) {
    throw new Error(
      "H.264 MP4 export is not available in this browser. Try the latest Chrome, Edge, or Safari.",
    );
  }

  if (!(await media.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000 }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");

    if (!customAacRegistered) {
      registerAacEncoder();
      customAacRegistered = true;
    }
  }

  if (!(await media.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000 }))) {
    throw new Error("AAC audio encoding could not be initialized in this browser.");
  }

  if (document.fonts?.ready) await document.fonts.ready;
  const timeline = buildReplayTimeline(frames);
  const audioPromise = renderReplayAudio(timeline.sounds, timeline.duration);
  const stageBackground = getComputedStyle(stage).backgroundColor || "#f8f5ee";

  const canvas = document.createElement("canvas");
  canvas.width = REPLAY_VIDEO_WIDTH;
  canvas.height = REPLAY_VIDEO_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) throw new Error("Could not create the replay video canvas.");

  const target = new media.BufferTarget();

  const output = new media.Output({
    format: new media.Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  const videoSource = new media.CanvasSource(canvas, {
    codec: "avc",
    quality,
  });

  const audioSource = new media.AudioBufferSource({
    codec: "aac",
    quality: new media.Quality("high"),
  });

  output.addVideoTrack(videoSource, {
    name: "LLM Games replay",
    languageCode: "eng",
  });
  output.addAudioTrack(audioSource, {
    name: "LLM Games sound effects",
    languageCode: "eng",
  });
  output.setMetadataTags({
    title,
    artist: "LLM Games",
    comment: "Server-authoritative game rewatch",
  });

  try {
    await output.start();

    for (let index = 0; index < timeline.entries.length; index += 1) {
      throwIfAborted(signal);
      const entry = timeline.entries[index];

      if (!entry) continue;
      await prepareFrame(entry.frame, index);
      await nextPaint();

      const frameCanvas = await screenshot.domToCanvas(stage, {
        width: REPLAY_VIDEO_WIDTH,
        height: REPLAY_VIDEO_HEIGHT,
        scale: 1,
        backgroundColor: stageBackground,
        timeout: 30_000,
      });

      context.fillStyle = stageBackground;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frameCanvas, 0, 0, canvas.width, canvas.height);
      await videoSource.add(entry.timestamp, entry.duration, {
        keyFrame: index === 0 || index % 10 === 0,
      });
      onProgress?.({
        phase: "rendering",
        completed: index + 1,
        total: timeline.entries.length,
      });
    }

    throwIfAborted(signal);
    onProgress?.({
      phase: "audio",
      completed: timeline.entries.length,
      total: timeline.entries.length,
    });
    await audioSource.add(await audioPromise);
    onProgress?.({
      phase: "finalizing",
      completed: timeline.entries.length,
      total: timeline.entries.length,
    });
    await output.finalize();
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  }

  if (!target.buffer) throw new Error("The MP4 encoder returned an empty file.");

  return new Blob([target.buffer], { type: "video/mp4" });
}

export function downloadReplayBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
