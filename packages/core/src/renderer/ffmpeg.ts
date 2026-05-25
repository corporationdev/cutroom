import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Effect, Layer } from "effect";

import { FfmpegFailed } from "./errors";
import { CommandExecutor, Ffmpeg } from "./services";
import type { FfmpegRenderInput, RenderMediaInput, VisualLayer } from "./types";

const ffmpegBinary = "ffmpeg";
const defaultVideoCodec = "libx264";
const defaultPreset = "veryfast";

export const FfmpegLive = Layer.effect(
  Ffmpeg,
  Effect.gen(function* () {
    const commandExecutor = yield* CommandExecutor;

    return {
      render: (input) =>
        Effect.gen(function* () {
          const args = yield* buildFfmpegArgsEffect(input);

          yield* Effect.tryPromise({
            catch: (error) =>
              new FfmpegFailed({
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to create output directory.",
              }),
            try: () =>
              mkdir(dirname(input.plan.outputPath), { recursive: true }),
          });

          yield* commandExecutor
            .run({
              args,
              binary: ffmpegBinary,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new FfmpegFailed({
                    message: [
                      error.message,
                      error.stderr ? `stderr: ${error.stderr}` : undefined,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  })
              )
            );
        }),
    };
  })
);

export const buildFfmpegArgs = (input: FfmpegRenderInput): string[] => {
  const visualLayer = input.plan.visualLayers[0];
  const mediaInput =
    visualLayer === undefined
      ? undefined
      : input.plan.inputs.find(
          (candidate) => candidate.inputIndex === visualLayer.inputIndex
        );

  if (visualLayer === undefined || mediaInput === undefined) {
    return [];
  }

  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...buildInputArgs(visualLayer, mediaInput, input),
    "-filter_complex",
    `[0:v]${buildVideoFilter(input)}[v]`,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    defaultVideoCodec,
    "-preset",
    defaultPreset,
    "-crf",
    getCrf(input),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.plan.outputPath,
  ];
};

const buildFfmpegArgsEffect = (
  input: FfmpegRenderInput
): Effect.Effect<string[], FfmpegFailed> => {
  const unsupportedReason = getUnsupportedReason(input);

  if (unsupportedReason) {
    return Effect.fail(
      new FfmpegFailed({
        message: unsupportedReason,
      })
    );
  }

  return Effect.succeed(buildFfmpegArgs(input));
};

const getUnsupportedReason = (input: FfmpegRenderInput): string | undefined => {
  if (input.overlayPath) {
    return "FfmpegLive does not support Hyperframes overlays yet.";
  }

  if (input.plan.audioLayers.length > 0) {
    return "FfmpegLive does not support audio layers yet.";
  }

  if (input.plan.visualLayers.length !== 1) {
    return "FfmpegLive currently supports exactly one visual layer.";
  }

  const visualLayer = input.plan.visualLayers[0];

  if (!visualLayer) {
    return "FfmpegLive requires a visual layer.";
  }

  const mediaInput = input.plan.inputs.find(
    (candidate) => candidate.inputIndex === visualLayer.inputIndex
  );

  if (!mediaInput) {
    return `Missing ffmpeg input for visual layer "${visualLayer.clipId}".`;
  }

  if (mediaInput.playbackRate !== 1) {
    return "FfmpegLive does not support playbackRate yet.";
  }

  return;
};

const buildInputArgs = (
  visualLayer: VisualLayer,
  mediaInput: RenderMediaInput,
  input: FfmpegRenderInput
): string[] => {
  const sourceStartSeconds = framesToSeconds(
    mediaInput.sourceStartFrame,
    input.plan.canvas.fps
  );

  if (visualLayer.type === "image") {
    return [
      "-loop",
      "1",
      "-t",
      formatSeconds(
        framesToSeconds(visualLayer.durationFrames, input.plan.canvas.fps)
      ),
      "-i",
      mediaInput.asset.resolvedSource,
    ];
  }

  return [
    ...(sourceStartSeconds > 0
      ? ["-ss", formatSeconds(sourceStartSeconds)]
      : []),
    "-i",
    mediaInput.asset.resolvedSource,
  ];
};

const buildVideoFilter = (input: FfmpegRenderInput): string => {
  const { fps, height, width } = input.plan.canvas;
  const durationSeconds = framesToSeconds(input.plan.durationFrames, fps);

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${fps}`,
    `trim=duration=${formatSeconds(durationSeconds)}`,
    "setpts=PTS-STARTPTS",
    "format=yuv420p",
  ].join(",");
};

const framesToSeconds = (frames: number, fps: number): number => frames / fps;

const formatSeconds = (seconds: number): string =>
  Number.isInteger(seconds) ? seconds.toString() : seconds.toFixed(6);

const getCrf = (input: FfmpegRenderInput): string => {
  if (input.quality === "high") {
    return "18";
  }

  if (input.quality === "draft") {
    return "28";
  }

  return "23";
};
