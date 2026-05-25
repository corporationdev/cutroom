import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { spawn } from "bun";
import { Effect, Layer } from "effect";

import type { Layout } from "../schema";
import { FfmpegFailed } from "./errors";
import { CommandExecutor, Ffmpeg } from "./services";
import type {
  AudioLayer,
  FfmpegRenderInput,
  RenderCanvas,
  RenderMediaInput,
  VisualLayer,
} from "./types";

const ffmpegBinary = "ffmpeg";
const defaultAudioBitrate = "192k";
const defaultAudioCodec = "aac";
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

          if (input.frameStream) {
            yield* runFfmpegWithFrameStream({ args, input });
          } else {
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
          }
        }),
    };
  })
);

export const buildFfmpegArgs = (input: FfmpegRenderInput): string[] => {
  if (input.encodedVideo) {
    return buildEncodedVideoFfmpegArgs(input);
  }

  const filterGraph = buildFilterGraph(input);

  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...buildFrameInputArgs(input),
    ...getFfmpegMediaInputs(input).flatMap((mediaInput) =>
      buildInputArgs(mediaInput, input.plan.canvas)
    ),
    "-filter_complex",
    filterGraph,
    "-map",
    "[vout]",
    ...buildAudioOutputArgs(input),
    ...buildVideoEncodingArgs(input),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.plan.outputPath,
  ];
};

const buildEncodedVideoFfmpegArgs = (input: FfmpegRenderInput): string[] => {
  if (!input.encodedVideo) {
    return [];
  }

  const hasAudio = input.plan.audioLayers.length > 0;

  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.encodedVideo.path,
    ...getFfmpegMediaInputs(input).flatMap((mediaInput) =>
      buildInputArgs(mediaInput, input.plan.canvas)
    ),
    ...(hasAudio
      ? ["-filter_complex", buildAudioFilters(input).join(";")]
      : []),
    "-map",
    "0:v",
    ...(hasAudio ? buildAudioOutputArgs(input) : ["-an"]),
    "-c:v",
    "copy",
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

const runFfmpegWithFrameStream = ({
  args,
  input,
}: {
  readonly args: readonly string[];
  readonly input: FfmpegRenderInput;
}): Effect.Effect<void, FfmpegFailed> =>
  Effect.tryPromise({
    catch: (error) =>
      new FfmpegFailed({
        message:
          error instanceof Error
            ? error.message
            : "Unable to stream rendered frames into ffmpeg.",
      }),
    try: async () => {
      if (!input.frameStream) {
        return;
      }

      const process = spawn([ffmpegBinary, ...args], {
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      });
      const stdoutPromise = new Response(process.stdout).arrayBuffer();
      const stderrPromise = new Response(process.stderr).text();
      try {
        for await (const frame of input.frameStream.frames) {
          process.stdin.write(frame);
        }
      } finally {
        process.stdin.end();
      }

      const [stderr, exitCode] = await Promise.all([
        stderrPromise,
        process.exited,
        stdoutPromise,
      ]).then(([stderrResult, exitCodeResult]) => [
        stderrResult,
        exitCodeResult,
      ]);

      if (exitCode !== 0) {
        throw new Error(
          [
            `ffmpeg exited with code ${exitCode}.`,
            stderr && `stderr: ${stderr}`,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    },
  });

const getUnsupportedReason = (input: FfmpegRenderInput): string | undefined => {
  const missingVisualInput = hasRenderedFrameInput(input)
    ? undefined
    : input.plan.visualLayers.find(
        (visualLayer) =>
          getInputForLayer(input, visualLayer.inputIndex) === undefined
      );

  if (missingVisualInput) {
    return `Missing ffmpeg input for visual layer "${missingVisualInput.clipId}".`;
  }

  const missingAudioInput = input.plan.audioLayers.find(
    (audioLayer) => getInputForLayer(input, audioLayer.inputIndex) === undefined
  );

  if (missingAudioInput) {
    return `Missing ffmpeg input for audio layer "${missingAudioInput.clipId}".`;
  }

  const playbackRateInput = getFfmpegMediaInputs(input).find(
    (mediaInput) => mediaInput.playbackRate !== 1
  );

  if (playbackRateInput) {
    return "FfmpegLive does not support playbackRate yet.";
  }

  return;
};

const buildInputArgs = (
  mediaInput: RenderMediaInput,
  canvas: RenderCanvas
): string[] => {
  const sourceStartSeconds = framesToSeconds(
    mediaInput.sourceStartFrame,
    canvas.fps
  );

  if (mediaInput.asset.type === "image") {
    return [
      "-loop",
      "1",
      "-t",
      formatSeconds(framesToSeconds(mediaInput.durationFrames, canvas.fps)),
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

const buildFilterGraph = (input: FfmpegRenderInput): string => {
  const parts: string[] = [];
  const { fps, height, width } = input.plan.canvas;
  const durationSeconds = getDurationSeconds(input);
  let currentCanvasLabel = "canvas0";

  if (hasRenderedFrameInput(input)) {
    parts.push(`[0:v]format=rgba[${currentCanvasLabel}]`);
  } else {
    parts.push(
      `color=c=black@1:s=${width}x${height}:r=${fps}:d=${formatSeconds(
        durationSeconds
      )},format=rgba[${currentCanvasLabel}]`
    );

    for (const [layerIndex, visualLayer] of input.plan.visualLayers.entries()) {
      const mediaInput = getInputForLayer(input, visualLayer.inputIndex);

      if (!mediaInput) {
        continue;
      }

      const layerLabel = `visual${layerIndex}`;
      const nextCanvasLabel = `canvas${layerIndex + 1}`;
      const overlay = getOverlayLayout(visualLayer.layout, input.plan.canvas);
      const mediaInputIndex = getFfmpegInputIndexForMediaInput(
        input,
        mediaInput
      );

      parts.push(
        `[${mediaInputIndex}:v]${buildVisualLayerFilter(
          visualLayer,
          input.plan.canvas
        )}[${layerLabel}]`
      );
      parts.push(
        `[${currentCanvasLabel}][${layerLabel}]overlay=${formatNumber(
          overlay.x
        )}:${formatNumber(overlay.y)}:eof_action=pass:shortest=0:enable='between(t\\,${formatSeconds(
          framesToSeconds(visualLayer.startFrame, input.plan.canvas.fps)
        )}\\,${formatSeconds(
          framesToSeconds(
            visualLayer.startFrame + visualLayer.durationFrames,
            input.plan.canvas.fps
          )
        )})'[${nextCanvasLabel}]`
      );

      currentCanvasLabel = nextCanvasLabel;
    }
  }

  parts.push(`[${currentCanvasLabel}]format=yuv420p[vout]`);

  if (input.plan.audioLayers.length > 0) {
    parts.push(...buildAudioFilters(input));
  }

  return parts.join(";");
};

const buildVisualLayerFilter = (
  visualLayer: VisualLayer,
  canvas: RenderCanvas
): string => {
  const durationSeconds = framesToSeconds(
    visualLayer.durationFrames,
    canvas.fps
  );
  const startSeconds = framesToSeconds(visualLayer.startFrame, canvas.fps);
  const layout = getOverlayLayout(visualLayer.layout, canvas);
  const filters = [
    `trim=duration=${formatSeconds(durationSeconds)}`,
    `setpts=PTS-STARTPTS+${formatSeconds(startSeconds)}/TB`,
    "format=rgba",
    ...buildLayoutFilters(visualLayer.layout, layout),
  ];

  if (layout.opacity < 1) {
    filters.push(`colorchannelmixer=aa=${formatNumber(layout.opacity)}`);
  }

  return filters.join(",");
};

const buildLayoutFilters = (
  sourceLayout: Layout | undefined,
  layout: RequiredOverlayLayout
): string[] => {
  const filters: string[] = [];

  if (sourceLayout?.crop) {
    filters.push(
      `crop=${formatNumber(sourceLayout.crop.width)}:${formatNumber(
        sourceLayout.crop.height
      )}:${formatNumber(sourceLayout.crop.x)}:${formatNumber(
        sourceLayout.crop.y
      )}`
    );
  }

  if (sourceLayout?.rotation) {
    filters.push(
      `rotate=${formatNumber(sourceLayout.rotation)}*PI/180:c=black@0`
    );
  }

  if (layout.fit === "fill") {
    filters.push(
      `scale=${formatNumber(layout.width)}:${formatNumber(layout.height)}`
    );
  } else if (layout.fit === "contain") {
    filters.push(
      `scale=${formatNumber(layout.width)}:${formatNumber(
        layout.height
      )}:force_original_aspect_ratio=decrease`,
      `pad=${formatNumber(layout.width)}:${formatNumber(
        layout.height
      )}:(ow-iw)/2:(oh-ih)/2:color=black@0`
    );
  } else if (layout.fit === "cover") {
    filters.push(
      `scale=${formatNumber(layout.width)}:${formatNumber(
        layout.height
      )}:force_original_aspect_ratio=increase`,
      `crop=${formatNumber(layout.width)}:${formatNumber(layout.height)}`
    );
  }

  return filters;
};

const buildAudioFilters = (input: FfmpegRenderInput): string[] => {
  const parts: string[] = [];
  const audioLabels = input.plan.audioLayers.map(
    (audioLayer, audioLayerIndex) => {
      const mediaInput = getInputForLayer(input, audioLayer.inputIndex);
      const label = `audio${audioLayerIndex}`;

      if (!mediaInput) {
        return label;
      }
      const mediaInputIndex = getFfmpegInputIndexForMediaInput(
        input,
        mediaInput
      );

      parts.push(
        `[${mediaInputIndex}:a]${buildAudioLayerFilter(
          audioLayer,
          input.plan.canvas
        )}[${label}]`
      );

      return label;
    }
  );
  const durationSeconds = getDurationSeconds(input);

  if (audioLabels.length === 1) {
    parts.push(
      `[${audioLabels[0]}]apad,atrim=duration=${formatSeconds(
        durationSeconds
      )}[aout]`
    );
    return parts;
  }

  parts.push(
    `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${
      audioLabels.length
    }:duration=longest:normalize=0,apad,atrim=duration=${formatSeconds(
      durationSeconds
    )}[aout]`
  );

  return parts;
};

const buildAudioLayerFilter = (
  audioLayer: AudioLayer,
  canvas: RenderCanvas
): string => {
  const durationSeconds = framesToSeconds(
    audioLayer.durationFrames,
    canvas.fps
  );
  const delayMilliseconds = Math.round(
    framesToSeconds(audioLayer.startFrame, canvas.fps) * 1000
  );

  return [
    `atrim=duration=${formatSeconds(durationSeconds)}`,
    "asetpts=PTS-STARTPTS",
    `volume=${formatNumber(audioLayer.volume)}`,
    `adelay=${delayMilliseconds}:all=1`,
  ].join(",");
};

const buildAudioOutputArgs = (input: FfmpegRenderInput): string[] => {
  if (input.plan.audioLayers.length === 0) {
    return ["-an"];
  }

  return [
    "-map",
    "[aout]",
    "-c:a",
    defaultAudioCodec,
    "-b:a",
    defaultAudioBitrate,
  ];
};

const buildVideoEncodingArgs = (input: FfmpegRenderInput): string[] => {
  if (input.encodedVideo) {
    return ["-c:v", "copy"];
  }

  return [
    "-c:v",
    defaultVideoCodec,
    "-preset",
    defaultPreset,
    "-crf",
    getCrf(input),
  ];
};

interface RequiredOverlayLayout {
  readonly fit: "contain" | "cover" | "fill" | "none";
  readonly height: number;
  readonly opacity: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const getOverlayLayout = (
  layout: Layout | undefined,
  canvas: RenderCanvas
): RequiredOverlayLayout => ({
  fit: layout?.fit ?? "cover",
  height: layout?.height ?? canvas.height,
  opacity: layout?.opacity ?? 1,
  width: layout?.width ?? canvas.width,
  x: layout?.x ?? 0,
  y: layout?.y ?? 0,
});

const getInputForLayer = (
  input: FfmpegRenderInput,
  inputIndex: number
): RenderMediaInput | undefined =>
  input.plan.inputs.find((candidate) => candidate.inputIndex === inputIndex);

const getFfmpegMediaInputs = (
  input: FfmpegRenderInput
): readonly RenderMediaInput[] => {
  if (!hasRenderedFrameInput(input)) {
    return input.plan.inputs;
  }

  const audioInputIndexes = new Set(
    input.plan.audioLayers.map((audioLayer) => audioLayer.inputIndex)
  );

  return input.plan.inputs.filter((mediaInput) =>
    audioInputIndexes.has(mediaInput.inputIndex)
  );
};

const getFfmpegInputIndexForMediaInput = (
  input: FfmpegRenderInput,
  mediaInput: RenderMediaInput
): number => {
  if (!hasRenderedFrameInput(input)) {
    return mediaInput.inputIndex;
  }

  return (
    1 +
    getFfmpegMediaInputs(input).findIndex(
      (candidate) => candidate.inputIndex === mediaInput.inputIndex
    )
  );
};

const buildFrameInputArgs = (input: FfmpegRenderInput): string[] => {
  if (input.encodedVideo) {
    return ["-i", input.encodedVideo.path];
  }

  if (input.frameStream) {
    return [
      "-framerate",
      formatNumber(input.frameStream.frameRate),
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-i",
      "pipe:0",
    ];
  }

  if (input.frameSequence) {
    return [
      "-framerate",
      formatNumber(input.frameSequence.frameRate),
      "-i",
      input.frameSequence.framePattern,
    ];
  }

  return [];
};

const hasRenderedFrameInput = (input: FfmpegRenderInput): boolean =>
  input.encodedVideo !== undefined ||
  input.frameSequence !== undefined ||
  input.frameStream !== undefined;

const getDurationSeconds = (input: FfmpegRenderInput): number =>
  framesToSeconds(input.plan.durationFrames, input.plan.canvas.fps);

const framesToSeconds = (frames: number, fps: number): number => frames / fps;

const formatSeconds = (seconds: number): string =>
  Number.isInteger(seconds) ? seconds.toString() : seconds.toFixed(6);

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? value.toString() : value.toFixed(6);

const getCrf = (input: FfmpegRenderInput): string => {
  if (input.quality === "high") {
    return "18";
  }

  if (input.quality === "draft") {
    return "28";
  }

  return "23";
};
