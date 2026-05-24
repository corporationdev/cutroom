import { succeed } from "effect/Effect";
import {
  Array as ArraySchema,
  Boolean as BooleanSchema,
  Int,
  isGreaterThan,
  isGreaterThanOrEqualTo,
  isLessThanOrEqualTo,
  isMinLength,
  Literal,
  Literals,
  makeFilter,
  Number as NumberSchema,
  optionalKey,
  Record as RecordSchema,
  String as StringSchema,
  Struct,
  toJsonSchemaDocument,
  Union,
  withDecodingDefaultKey,
} from "effect/Schema";

export const vbaasSchemaVersion = "0.1";
export const vbaasCompositionFileName = "vbaas.json";

const jsonSchemaDraft202012 = "https://json-schema.org/draft/2020-12/schema";

const isUrl = makeFilter<string>((value) => {
  try {
    new URL(value);
    return;
  } catch {
    return "Expected a valid URL.";
  }
});

const idSchema = StringSchema.check(isMinLength(1));
const frameSchema = Int.check(isGreaterThanOrEqualTo(0));
const positiveFrameCountSchema = Int.check(isGreaterThan(0));
const positiveNumberSchema = NumberSchema.check(isGreaterThan(0));
const nonNegativeNumberSchema = NumberSchema.check(isGreaterThanOrEqualTo(0));
const positiveIntegerSchema = Int.check(isGreaterThan(0));
const nonEmptyStringSchema = StringSchema.check(isMinLength(1));
const urlStringSchema = StringSchema.check(isUrl);

export const canvasSchema = Struct({
  height: positiveIntegerSchema.annotate({
    description: "Output height in pixels.",
  }),
  width: positiveIntegerSchema.annotate({
    description: "Output width in pixels.",
  }),
});

export const compositionSettingsSchema = Struct({
  canvas: canvasSchema.annotate({
    description: "Output canvas dimensions.",
  }),
  fps: positiveNumberSchema.annotate({
    description: "Output frame rate.",
  }),
});

export const assetSourceSchema = Union([
  Struct({
    kind: Literal("file"),
    path: nonEmptyStringSchema.annotate({
      description: "Absolute or composition-relative path.",
    }),
  }),
  Struct({
    kind: Literal("url"),
    path: urlStringSchema.annotate({
      description: "Remote media URL.",
    }),
  }),
]);

export const assetSchema = Struct({
  durationFrames: optionalKey(frameSchema),
  fps: optionalKey(positiveNumberSchema),
  height: optionalKey(positiveIntegerSchema),
  id: idSchema.annotate({
    description: "Stable asset id referenced by clips.",
  }),
  mimeType: optionalKey(nonEmptyStringSchema),
  name: optionalKey(
    nonEmptyStringSchema.annotate({
      description: "Human-readable asset name.",
    })
  ),
  source: assetSourceSchema.annotate({
    description: "Where the media can be read from.",
  }),
  type: Literals(["video", "audio", "image", "font"]).annotate({
    description: "Asset media type.",
  }),
  width: optionalKey(positiveIntegerSchema),
});

export const mediaSourceSchema = Struct({
  assetId: idSchema.annotate({
    description: "Referenced media asset id.",
  }),
  playbackRate: positiveNumberSchema.pipe(withDecodingDefaultKey(succeed(1))),
  sourceDurationFrames: optionalKey(positiveFrameCountSchema),
  sourceStartFrame: frameSchema.pipe(withDecodingDefaultKey(succeed(0))),
});

export const cropSchema = Struct({
  height: positiveNumberSchema,
  width: positiveNumberSchema,
  x: nonNegativeNumberSchema,
  y: nonNegativeNumberSchema,
});

export const layoutSchema = Struct({
  crop: optionalKey(cropSchema),
  fit: Literals(["contain", "cover", "fill", "none"]).pipe(
    withDecodingDefaultKey(succeed("cover" as const))
  ),
  height: positiveNumberSchema,
  opacity: NumberSchema.check(
    isGreaterThanOrEqualTo(0),
    isLessThanOrEqualTo(1)
  ).pipe(withDecodingDefaultKey(succeed(1))),
  rotation: NumberSchema.pipe(withDecodingDefaultKey(succeed(0))),
  width: positiveNumberSchema,
  x: NumberSchema.pipe(withDecodingDefaultKey(succeed(0))),
  y: NumberSchema.pipe(withDecodingDefaultKey(succeed(0))),
});

export const effectParamValueSchema = Union([
  StringSchema,
  NumberSchema,
  BooleanSchema,
]);

export const effectSchema = Struct({
  enabled: BooleanSchema.pipe(withDecodingDefaultKey(succeed(true))),
  id: optionalKey(idSchema),
  params: RecordSchema(StringSchema, effectParamValueSchema).pipe(
    withDecodingDefaultKey(succeed({}))
  ),
  type: nonEmptyStringSchema,
});

const effectsSchema = ArraySchema(effectSchema).pipe(
  withDecodingDefaultKey(succeed([]))
);

export const textStyleSchema = Struct({
  align: optionalKey(Literals(["left", "center", "right"])),
  color: optionalKey(nonEmptyStringSchema),
  fontAssetId: optionalKey(idSchema),
  fontFamily: optionalKey(nonEmptyStringSchema),
  fontSize: optionalKey(positiveNumberSchema),
  fontWeight: optionalKey(
    Literals([
      "normal",
      "bold",
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
    ])
  ),
  lineHeight: optionalKey(positiveNumberSchema),
});

export const captionStyleSchema = Struct({
  backgroundColor: optionalKey(nonEmptyStringSchema),
  color: optionalKey(nonEmptyStringSchema),
  fontAssetId: optionalKey(idSchema),
  fontFamily: optionalKey(nonEmptyStringSchema),
  fontSize: optionalKey(positiveNumberSchema),
  fontWeight: optionalKey(Literals(["normal", "bold"])),
  lineHeight: optionalKey(positiveNumberSchema),
});

export const captionLayoutSchema = Struct({
  align: optionalKey(Literals(["left", "center", "right"])),
  maxWidth: optionalKey(positiveNumberSchema),
  position: optionalKey(Literals(["top", "center", "bottom"])),
});

export const captionCueSchema = Struct({
  durationFrames: positiveFrameCountSchema,
  speaker: optionalKey(nonEmptyStringSchema),
  startFrame: frameSchema,
  text: StringSchema,
});

const baseClipFields = {
  durationFrames: positiveFrameCountSchema.annotate({
    description: "Clip duration in timeline frames.",
  }),
  hidden: BooleanSchema.pipe(withDecodingDefaultKey(succeed(false))),
  id: idSchema.annotate({
    description: "Stable clip id.",
  }),
  name: optionalKey(nonEmptyStringSchema),
  startFrame: frameSchema.annotate({
    description: "Clip start time in timeline frames.",
  }),
} as const;

export const videoClipSchema = Struct({
  ...baseClipFields,
  effects: effectsSchema,
  layout: optionalKey(layoutSchema),
  media: mediaSourceSchema,
  type: Literal("video"),
});

export const imageClipSchema = Struct({
  ...baseClipFields,
  assetId: idSchema,
  effects: effectsSchema,
  layout: optionalKey(layoutSchema),
  type: Literal("image"),
});

export const audioClipSchema = Struct({
  ...baseClipFields,
  effects: effectsSchema,
  media: mediaSourceSchema,
  type: Literal("audio"),
  volume: nonNegativeNumberSchema.pipe(withDecodingDefaultKey(succeed(1))),
});

export const textClipSchema = Struct({
  ...baseClipFields,
  effects: effectsSchema,
  layout: optionalKey(layoutSchema),
  style: textStyleSchema.pipe(withDecodingDefaultKey(succeed({}))),
  text: StringSchema,
  type: Literal("text"),
});

export const clipSchema = Union([
  videoClipSchema,
  imageClipSchema,
  audioClipSchema,
  textClipSchema,
]);

const baseTrackFields = {
  hidden: BooleanSchema.pipe(withDecodingDefaultKey(succeed(false))),
  id: idSchema.annotate({
    description: "Stable track id.",
  }),
  name: optionalKey(nonEmptyStringSchema),
} as const;

export const visualTrackSchema = Struct({
  ...baseTrackFields,
  clips: ArraySchema(Union([videoClipSchema, imageClipSchema])).pipe(
    withDecodingDefaultKey(succeed([]))
  ),
  kind: Literal("visual"),
});

export const audioTrackSchema = Struct({
  ...baseTrackFields,
  clips: ArraySchema(audioClipSchema).pipe(withDecodingDefaultKey(succeed([]))),
  kind: Literal("audio"),
  muted: BooleanSchema.pipe(withDecodingDefaultKey(succeed(false))),
});

export const textTrackSchema = Struct({
  ...baseTrackFields,
  clips: ArraySchema(textClipSchema).pipe(withDecodingDefaultKey(succeed([]))),
  kind: Literal("text"),
});

export const captionTrackSchema = Struct({
  ...baseTrackFields,
  cues: ArraySchema(captionCueSchema).pipe(withDecodingDefaultKey(succeed([]))),
  kind: Literal("caption"),
  layout: captionLayoutSchema.pipe(withDecodingDefaultKey(succeed({}))),
  maxWordsPerCue: optionalKey(positiveIntegerSchema),
  sourceAudioAssetId: optionalKey(idSchema),
  style: captionStyleSchema.pipe(withDecodingDefaultKey(succeed({}))),
});

export const trackSchema = Union([
  visualTrackSchema,
  audioTrackSchema,
  textTrackSchema,
  captionTrackSchema,
]);

export const vbaasCompositionSchema = Struct({
  assets: ArraySchema(assetSchema).pipe(withDecodingDefaultKey(succeed([]))),
  durationFrames: optionalKey(positiveFrameCountSchema),
  id: idSchema,
  name: optionalKey(nonEmptyStringSchema),
  schemaVersion: Literal(vbaasSchemaVersion),
  settings: compositionSettingsSchema,
  tracks: ArraySchema(trackSchema).pipe(withDecodingDefaultKey(succeed([]))),
});

export const vbaasJsonSchemaDocument = toJsonSchemaDocument(
  vbaasCompositionSchema
);

export const vbaasJsonSchema = {
  $defs: vbaasJsonSchemaDocument.definitions,
  $schema: jsonSchemaDraft202012,
  ...vbaasJsonSchemaDocument.schema,
};

export type Asset = typeof assetSchema.Type;
export type AssetInput = typeof assetSchema.Encoded;
export type AssetSource = typeof assetSourceSchema.Type;
export type AudioClip = typeof audioClipSchema.Type;
export type AudioTrack = typeof audioTrackSchema.Type;
export type Canvas = typeof canvasSchema.Type;
export type CaptionCue = typeof captionCueSchema.Type;
export type CaptionLayout = typeof captionLayoutSchema.Type;
export type CaptionStyle = typeof captionStyleSchema.Type;
export type CaptionTrack = typeof captionTrackSchema.Type;
export type Clip = typeof clipSchema.Type;
export type ClipInput = typeof clipSchema.Encoded;
export type CompositionSettings = typeof compositionSettingsSchema.Type;
export type CompositionSettingsInput = typeof compositionSettingsSchema.Encoded;
export type Crop = typeof cropSchema.Type;
export type Effect = typeof effectSchema.Type;
export type EffectParamValue = typeof effectParamValueSchema.Type;
export type ImageClip = typeof imageClipSchema.Type;
export type Layout = typeof layoutSchema.Type;
export type MediaSource = typeof mediaSourceSchema.Type;
export type MediaSourceInput = typeof mediaSourceSchema.Encoded;
export type TextClip = typeof textClipSchema.Type;
export type TextStyle = typeof textStyleSchema.Type;
export type TextStyleInput = typeof textStyleSchema.Encoded;
export type TextTrack = typeof textTrackSchema.Type;
export type Track = typeof trackSchema.Type;
export type TrackInput = typeof trackSchema.Encoded;
export type VbaasComposition = typeof vbaasCompositionSchema.Type;
export type VbaasCompositionInput = typeof vbaasCompositionSchema.Encoded;
export type VideoClip = typeof videoClipSchema.Type;
export type VisualTrack = typeof visualTrackSchema.Type;

export interface CompositionValidationIssue {
  readonly message: string;
  readonly path: string;
}

const getDuplicateIds = <T extends { readonly id: string }>(
  items: readonly T[]
): string[] => {
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const item of items) {
    if (seenIds.has(item.id)) {
      duplicateIds.add(item.id);
      continue;
    }

    seenIds.add(item.id);
  }

  return Array.from(duplicateIds);
};

const getMediaFrameSpan = (clip: AudioClip | VideoClip): number =>
  clip.media.sourceDurationFrames ??
  Math.ceil(clip.durationFrames * clip.media.playbackRate);

const validateRangedMediaSource = (
  clip: AudioClip | VideoClip,
  asset: Asset | undefined,
  expectedAssetType: "audio" | "video",
  path: string,
  issues: CompositionValidationIssue[]
) => {
  if (!asset) {
    issues.push({
      message: `Missing asset "${clip.media.assetId}".`,
      path: `${path}.media.assetId`,
    });
    return;
  }

  if (asset.type !== expectedAssetType) {
    issues.push({
      message: `${clip.type} clip references ${asset.type} asset "${asset.id}".`,
      path: `${path}.media.assetId`,
    });
  }

  if (asset.durationFrames === undefined) {
    return;
  }

  const mediaEndFrame = clip.media.sourceStartFrame + getMediaFrameSpan(clip);

  if (mediaEndFrame > asset.durationFrames) {
    issues.push({
      message: `Clip source range ends at frame ${mediaEndFrame}, beyond asset duration ${asset.durationFrames}.`,
      path: `${path}.media`,
    });
  }
};

const validateImageAsset = (
  clip: ImageClip,
  asset: Asset | undefined,
  path: string,
  issues: CompositionValidationIssue[]
) => {
  if (!asset) {
    issues.push({
      message: `Missing asset "${clip.assetId}".`,
      path: `${path}.assetId`,
    });
    return;
  }

  if (asset.type !== "image") {
    issues.push({
      message: `Image clip references ${asset.type} asset "${asset.id}".`,
      path: `${path}.assetId`,
    });
  }
};

const validateFontAsset = (
  fontAssetId: string | undefined,
  assetsById: ReadonlyMap<string, Asset>,
  path: string,
  issues: CompositionValidationIssue[]
) => {
  if (!fontAssetId) {
    return;
  }

  const fontAsset = assetsById.get(fontAssetId);

  if (!fontAsset) {
    issues.push({
      message: `Missing font asset "${fontAssetId}".`,
      path,
    });
    return;
  }

  if (fontAsset.type !== "font") {
    issues.push({
      message: `Text style references ${fontAsset.type} asset "${fontAsset.id}" as a font.`,
      path,
    });
  }
};

const validateClipEndFrame = (
  clip: Clip,
  composition: VbaasComposition,
  path: string,
  issues: CompositionValidationIssue[]
) => {
  const clipEndFrame = clip.startFrame + clip.durationFrames;

  if (
    composition.durationFrames === undefined ||
    clipEndFrame <= composition.durationFrames
  ) {
    return;
  }

  issues.push({
    message: `Clip ends at frame ${clipEndFrame}, beyond composition duration ${composition.durationFrames}.`,
    path,
  });
};

const validateClip = (
  clip: Clip,
  composition: VbaasComposition,
  assetsById: ReadonlyMap<string, Asset>,
  path: string,
  issues: CompositionValidationIssue[]
) => {
  validateClipEndFrame(clip, composition, path, issues);

  if (clip.type === "video") {
    validateRangedMediaSource(
      clip,
      assetsById.get(clip.media.assetId),
      "video",
      path,
      issues
    );
    return;
  }

  if (clip.type === "audio") {
    validateRangedMediaSource(
      clip,
      assetsById.get(clip.media.assetId),
      "audio",
      path,
      issues
    );
    return;
  }

  if (clip.type === "image") {
    validateImageAsset(clip, assetsById.get(clip.assetId), path, issues);
    return;
  }

  validateFontAsset(
    clip.style.fontAssetId,
    assetsById,
    `${path}.style.fontAssetId`,
    issues
  );
};

const validateCaptionTrack = (
  track: CaptionTrack,
  composition: VbaasComposition,
  assetsById: ReadonlyMap<string, Asset>,
  path: string,
  issues: CompositionValidationIssue[]
) => {
  validateFontAsset(
    track.style.fontAssetId,
    assetsById,
    `${path}.style.fontAssetId`,
    issues
  );

  if (track.sourceAudioAssetId) {
    const sourceAudioAsset = assetsById.get(track.sourceAudioAssetId);

    if (!sourceAudioAsset) {
      issues.push({
        message: `Missing caption source audio asset "${track.sourceAudioAssetId}".`,
        path: `${path}.sourceAudioAssetId`,
      });
    } else if (sourceAudioAsset.type !== "audio") {
      issues.push({
        message: `Caption source references ${sourceAudioAsset.type} asset "${sourceAudioAsset.id}".`,
        path: `${path}.sourceAudioAssetId`,
      });
    }
  }

  for (const [cueIndex, cue] of track.cues.entries()) {
    const cueEndFrame = cue.startFrame + cue.durationFrames;

    if (
      composition.durationFrames === undefined ||
      cueEndFrame <= composition.durationFrames
    ) {
      continue;
    }

    issues.push({
      message: `Caption cue ends at frame ${cueEndFrame}, beyond composition duration ${composition.durationFrames}.`,
      path: `${path}.cues[${cueIndex}]`,
    });
  }
};

const collectClipIds = (
  track: Track,
  trackIndex: number,
  composition: VbaasComposition,
  assetsById: ReadonlyMap<string, Asset>,
  issues: CompositionValidationIssue[]
): Array<{ readonly id: string }> => {
  if (track.kind === "caption") {
    validateCaptionTrack(
      track,
      composition,
      assetsById,
      `tracks[${trackIndex}]`,
      issues
    );
    return [];
  }

  const clipIds: Array<{ readonly id: string }> = [];

  for (const [clipIndex, clip] of track.clips.entries()) {
    const clipPath = `tracks[${trackIndex}].clips[${clipIndex}]`;
    clipIds.push({ id: clip.id });
    validateClip(clip, composition, assetsById, clipPath, issues);
  }

  return clipIds;
};

export const validateComposition = (
  composition: VbaasComposition
): readonly CompositionValidationIssue[] => {
  const issues: CompositionValidationIssue[] = [];
  const assetsById = new Map(
    composition.assets.map((asset) => [asset.id, asset] as const)
  );

  for (const assetId of getDuplicateIds(composition.assets)) {
    issues.push({
      message: `Duplicate asset id "${assetId}".`,
      path: "assets",
    });
  }

  for (const trackId of getDuplicateIds(composition.tracks)) {
    issues.push({
      message: `Duplicate track id "${trackId}".`,
      path: "tracks",
    });
  }

  const clipIds = composition.tracks.flatMap((track, trackIndex) =>
    collectClipIds(track, trackIndex, composition, assetsById, issues)
  );

  for (const clipId of getDuplicateIds(clipIds)) {
    issues.push({
      message: `Duplicate clip id "${clipId}".`,
      path: "tracks",
    });
  }

  return issues;
};
