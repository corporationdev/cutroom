import { z } from "zod";

export const vbaasSchemaVersion = "0.1";
export const vbaasCompositionFileName = "vbaas.json";

const idSchema = z.string().min(1);
const timeSecondsSchema = z.number().nonnegative();

export const canvasSchema = z.object({
  width: z.number().int().positive().describe("Output width in pixels."),
  height: z.number().int().positive().describe("Output height in pixels."),
});

export const compositionSettingsSchema = z.object({
  fps: z.number().positive().describe("Output frame rate."),
  canvas: canvasSchema.describe("Output canvas dimensions."),
});

export const assetSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1).describe("Absolute or composition-relative path."),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.url().describe("Remote media URL."),
  }),
]);

export const assetSchema = z.object({
  id: idSchema.describe("Stable asset id referenced by clips."),
  type: z.enum(["video", "audio", "image"]).describe("Asset media type."),
  source: assetSourceSchema.describe("Where the media can be read from."),
  name: z.string().min(1).optional().describe("Human-readable asset name."),
  duration: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  mimeType: z.string().min(1).optional(),
});

export const mediaSourceSchema = z.object({
  assetId: idSchema.describe("Referenced video or audio asset id."),
  sourceStart: timeSecondsSchema.default(0),
  sourceDuration: z.number().positive().optional(),
  playbackRate: z.number().positive().default(1),
});

export const transformSchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    scale: z.number().positive().default(1),
    rotation: z.number().default(0),
    opacity: z.number().min(0).max(1).default(1),
    fit: z.enum(["contain", "cover", "fill", "none"]).default("cover"),
  })
  .partial();

export const textStyleSchema = z
  .object({
    fontFamily: z.string().min(1),
    fontSize: z.number().positive(),
    color: z.string().min(1),
    align: z.enum(["left", "center", "right"]),
  })
  .partial();

const baseClipSchema = z.object({
  id: idSchema.describe("Stable clip id."),
  start: timeSecondsSchema.describe("Clip start time in seconds."),
  duration: z.number().positive().describe("Clip duration in seconds."),
  name: z.string().min(1).optional(),
});

export const videoClipSchema = baseClipSchema.extend({
  type: z.literal("video"),
  media: mediaSourceSchema,
  transform: transformSchema.optional(),
});

export const audioClipSchema = baseClipSchema.extend({
  type: z.literal("audio"),
  media: mediaSourceSchema,
  volume: z.number().nonnegative().default(1),
});

export const imageClipSchema = baseClipSchema.extend({
  type: z.literal("image"),
  assetId: idSchema,
  transform: transformSchema.optional(),
});

export const textClipSchema = baseClipSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  style: textStyleSchema.default({}),
  transform: transformSchema.optional(),
});

export const clipSchema = z.discriminatedUnion("type", [
  videoClipSchema,
  audioClipSchema,
  imageClipSchema,
  textClipSchema,
]);

export const trackSchema = z.object({
  id: idSchema.describe("Stable track id."),
  type: z.enum(["video", "audio", "image", "text"]),
  name: z.string().min(1).optional(),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  clips: z.array(clipSchema).default([]),
});

export const vbaasCompositionSchema = z.object({
  schemaVersion: z.literal(vbaasSchemaVersion),
  id: idSchema,
  name: z.string().min(1).optional(),
  settings: compositionSettingsSchema,
  assets: z.array(assetSchema).default([]),
  tracks: z.array(trackSchema).default([]),
});

export const vbaasJsonSchema = z.toJSONSchema(vbaasCompositionSchema, {
  target: "draft-2020-12",
});

export type Asset = z.infer<typeof assetSchema>;
export type AssetInput = z.input<typeof assetSchema>;
export type AssetSource = z.infer<typeof assetSourceSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
export type Canvas = z.infer<typeof canvasSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type ClipInput = z.input<typeof clipSchema>;
export type CompositionSettings = z.infer<typeof compositionSettingsSchema>;
export type CompositionSettingsInput = z.input<
  typeof compositionSettingsSchema
>;
export type VbaasComposition = z.infer<typeof vbaasCompositionSchema>;
export type VbaasCompositionInput = z.input<typeof vbaasCompositionSchema>;
export type ImageClip = z.infer<typeof imageClipSchema>;
export type MediaSource = z.infer<typeof mediaSourceSchema>;
export type MediaSourceInput = z.input<typeof mediaSourceSchema>;
export type TextClip = z.infer<typeof textClipSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type TextStyleInput = z.input<typeof textStyleSchema>;
export type Track = z.infer<typeof trackSchema>;
export type TrackInput = z.input<typeof trackSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type TransformInput = z.input<typeof transformSchema>;
export type VideoClip = z.infer<typeof videoClipSchema>;
