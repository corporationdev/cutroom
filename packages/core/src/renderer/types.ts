import type {
  Asset,
  AudioClip,
  CaptionTrack,
  ImageClip,
  Layout,
  TextClip,
  VbaasComposition,
  VideoClip,
} from "../schema";

export type RenderQuality = "draft" | "standard" | "high";

export interface RenderCompositionInput {
  readonly composition: VbaasComposition;
  readonly outputPath: string;
  readonly projectRoot?: string;
  readonly quality?: RenderQuality;
}

export interface RenderCompositionResult {
  readonly durationFrames: number;
  readonly outputPath: string;
  readonly plan: RenderPlan;
}

export interface RenderCanvas {
  readonly fps: number;
  readonly height: number;
  readonly width: number;
}

export interface ResolvedAsset extends Asset {
  readonly resolvedSource: string;
}

export interface RenderMediaInput {
  readonly asset: ResolvedAsset;
  readonly durationFrames: number;
  readonly id: string;
  readonly inputIndex: number;
  readonly playbackRate: number;
  readonly sourceStartFrame: number;
}

export interface VisualLayer {
  readonly clip: ImageClip | VideoClip;
  readonly clipId: string;
  readonly durationFrames: number;
  readonly inputIndex: number;
  readonly layout?: Layout;
  readonly startFrame: number;
  readonly type: "image" | "video";
}

export interface AudioLayer {
  readonly clip: AudioClip;
  readonly clipId: string;
  readonly durationFrames: number;
  readonly inputIndex: number;
  readonly playbackRate: number;
  readonly startFrame: number;
  readonly volume: number;
}

export interface HtmlLayer {
  readonly clip?: TextClip;
  readonly durationFrames: number;
  readonly id: string;
  readonly kind: "caption" | "text";
  readonly startFrame: number;
  readonly text: string;
  readonly track?: CaptionTrack;
}

export interface RenderPlan {
  readonly audioLayers: readonly AudioLayer[];
  readonly canvas: RenderCanvas;
  readonly composition: VbaasComposition;
  readonly durationFrames: number;
  readonly htmlLayers: readonly HtmlLayer[];
  readonly inputs: readonly RenderMediaInput[];
  readonly outputPath: string;
  readonly projectRoot: string;
  readonly visualLayers: readonly VisualLayer[];
}

export interface BuildRenderPlanInput extends RenderCompositionInput {
  readonly resolvedAssets: ReadonlyMap<string, ResolvedAsset>;
}

export interface RenderFrameSequenceInput {
  readonly outputDirectory: string;
  readonly plan: RenderPlan;
}

export interface RenderFrameSequenceResult {
  readonly framePattern: string;
  readonly frameRate: number;
}

export interface RenderFrameStreamResult {
  readonly frameRate: number;
  readonly frames: AsyncIterable<Uint8Array>;
}

export interface RenderEncodedVideoResult {
  readonly path: string;
}

export interface FfmpegRenderInput {
  readonly encodedVideo?: RenderEncodedVideoResult;
  readonly frameSequence?: RenderFrameSequenceResult;
  readonly frameStream?: RenderFrameStreamResult;
  readonly plan: RenderPlan;
  readonly quality?: RenderQuality;
}

export interface CommandInput {
  readonly args: readonly string[];
  readonly binary: string;
  readonly cwd?: string;
}

export interface CommandResult {
  readonly args: readonly string[];
  readonly binary: string;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}
