import { Effect, Layer } from "effect";

import type {
  AudioClip,
  CaptionTrack,
  Clip,
  ImageClip,
  TextClip,
  Track,
  VideoClip,
} from "../schema";
import { RenderPlanner } from "./services";
import type {
  BuildRenderPlanInput,
  HtmlLayer,
  RenderMediaInput,
  RenderPlan,
  ResolvedAsset,
} from "./types";

const defaultProjectRoot = process.cwd();

export const RenderPlannerLive = Layer.succeed(RenderPlanner, {
  buildPlan: (input) => Effect.succeed(buildRenderPlan(input)),
});

export const buildRenderPlan = (input: BuildRenderPlanInput): RenderPlan => {
  const inputs: RenderMediaInput[] = [];
  const visualLayers: RenderPlan["visualLayers"][number][] = [];
  const audioLayers: RenderPlan["audioLayers"][number][] = [];
  const htmlLayers: HtmlLayer[] = [];

  for (const track of input.composition.tracks) {
    addTrackToPlan({
      audioLayers,
      htmlLayers,
      inputs,
      resolvedAssets: input.resolvedAssets,
      track,
      visualLayers,
    });
  }

  return {
    audioLayers,
    canvas: {
      fps: input.composition.settings.fps,
      height: input.composition.settings.canvas.height,
      width: input.composition.settings.canvas.width,
    },
    composition: input.composition,
    durationFrames:
      input.composition.durationFrames ?? getDurationFrames(input),
    htmlLayers,
    inputs,
    outputPath: input.outputPath,
    projectRoot: input.projectRoot ?? defaultProjectRoot,
    visualLayers,
  };
};

const addTrackToPlan = ({
  audioLayers,
  htmlLayers,
  inputs,
  resolvedAssets,
  track,
  visualLayers,
}: {
  readonly audioLayers: RenderPlan["audioLayers"][number][];
  readonly htmlLayers: HtmlLayer[];
  readonly inputs: RenderMediaInput[];
  readonly resolvedAssets: ReadonlyMap<string, ResolvedAsset>;
  readonly track: Track;
  readonly visualLayers: RenderPlan["visualLayers"][number][];
}) => {
  if (track.hidden) {
    return;
  }

  if (track.kind === "caption") {
    htmlLayers.push(...captionTrackToHtmlLayers(track));
    return;
  }

  for (const clip of track.clips) {
    if (clip.hidden) {
      continue;
    }

    addClipToPlan({
      audioLayers,
      clip,
      htmlLayers,
      inputs,
      muted: track.kind === "audio" ? track.muted : false,
      resolvedAssets,
      visualLayers,
    });
  }
};

const addClipToPlan = ({
  audioLayers,
  clip,
  htmlLayers,
  inputs,
  muted,
  resolvedAssets,
  visualLayers,
}: {
  readonly audioLayers: RenderPlan["audioLayers"][number][];
  readonly clip: Clip;
  readonly htmlLayers: HtmlLayer[];
  readonly inputs: RenderMediaInput[];
  readonly muted: boolean;
  readonly resolvedAssets: ReadonlyMap<string, ResolvedAsset>;
  readonly visualLayers: RenderPlan["visualLayers"][number][];
}) => {
  if (clip.type === "text") {
    htmlLayers.push(textClipToHtmlLayer(clip));
    return;
  }

  if (clip.type === "audio") {
    if (!muted) {
      audioLayers.push(
        audioClipToAudioLayer(clip, addMediaInput(inputs, clip, resolvedAssets))
      );
    }
    return;
  }

  if (clip.type === "image") {
    visualLayers.push(
      imageClipToVisualLayer(clip, addMediaInput(inputs, clip, resolvedAssets))
    );
    return;
  }

  visualLayers.push(
    videoClipToVisualLayer(clip, addMediaInput(inputs, clip, resolvedAssets))
  );
};

const addMediaInput = (
  inputs: RenderMediaInput[],
  clip: AudioClip | ImageClip | VideoClip,
  resolvedAssets: ReadonlyMap<string, ResolvedAsset>
): number => {
  const assetId = clip.type === "image" ? clip.assetId : clip.media.assetId;
  const asset = resolvedAssets.get(assetId);
  const inputIndex = inputs.length;

  if (!asset) {
    return inputIndex;
  }

  inputs.push({
    asset,
    durationFrames:
      clip.type === "image"
        ? clip.durationFrames
        : (clip.media.sourceDurationFrames ?? clip.durationFrames),
    id: `${clip.id}:input:${inputIndex}`,
    inputIndex,
    playbackRate: clip.type === "image" ? 1 : clip.media.playbackRate,
    sourceStartFrame: clip.type === "image" ? 0 : clip.media.sourceStartFrame,
  });

  return inputIndex;
};

const imageClipToVisualLayer = (
  clip: ImageClip,
  inputIndex: number
): RenderPlan["visualLayers"][number] => ({
  clip,
  clipId: clip.id,
  durationFrames: clip.durationFrames,
  inputIndex,
  layout: clip.layout,
  startFrame: clip.startFrame,
  type: "image",
});

const videoClipToVisualLayer = (
  clip: VideoClip,
  inputIndex: number
): RenderPlan["visualLayers"][number] => ({
  clip,
  clipId: clip.id,
  durationFrames: clip.durationFrames,
  inputIndex,
  layout: clip.layout,
  startFrame: clip.startFrame,
  type: "video",
});

const audioClipToAudioLayer = (
  clip: AudioClip,
  inputIndex: number
): RenderPlan["audioLayers"][number] => ({
  clip,
  clipId: clip.id,
  durationFrames: clip.durationFrames,
  inputIndex,
  playbackRate: clip.media.playbackRate,
  startFrame: clip.startFrame,
  volume: clip.volume,
});

const textClipToHtmlLayer = (clip: TextClip): HtmlLayer => ({
  clip,
  durationFrames: clip.durationFrames,
  id: clip.id,
  kind: "text",
  startFrame: clip.startFrame,
  text: clip.text,
});

const captionTrackToHtmlLayers = (track: CaptionTrack): HtmlLayer[] =>
  track.cues.map((cue, cueIndex) => ({
    durationFrames: cue.durationFrames,
    id: `${track.id}:cue:${cueIndex}`,
    kind: "caption",
    startFrame: cue.startFrame,
    text: cue.text,
    track,
  }));

const getDurationFrames = (input: BuildRenderPlanInput): number => {
  let durationFrames = 0;

  for (const track of input.composition.tracks) {
    if (track.kind === "caption") {
      for (const cue of track.cues) {
        durationFrames = Math.max(
          durationFrames,
          cue.startFrame + cue.durationFrames
        );
      }
      continue;
    }

    for (const clip of track.clips) {
      durationFrames = Math.max(
        durationFrames,
        clip.startFrame + clip.durationFrames
      );
    }
  }

  return durationFrames;
};
