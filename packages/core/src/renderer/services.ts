import { Context, Effect, Layer } from "effect";

import type { Asset } from "../schema";
import type {
  AssetResolveFailed,
  CommandExecutionFailed,
  FfmpegFailed,
  FrameSequenceFailed,
  TempDirectoryFailed,
} from "./errors";
import type {
  BuildRenderPlanInput,
  CommandInput,
  CommandResult,
  FfmpegRenderInput,
  RenderCompositionInput,
  RenderEncodedVideoResult,
  RenderFrameSequenceInput,
  RenderFrameSequenceResult,
  RenderFrameStreamResult,
  RenderPlan,
  ResolvedAsset,
} from "./types";

export interface AssetResolverShape {
  readonly resolveAsset: (input: {
    readonly asset: Asset;
    readonly projectRoot: string;
  }) => Effect.Effect<ResolvedAsset, AssetResolveFailed>;
}

export class AssetResolver extends Context.Service<
  AssetResolver,
  AssetResolverShape
>()("@vbaas/core/renderer/AssetResolver") {
  static Passthrough = Layer.succeed(this, {
    resolveAsset: ({ asset, projectRoot }) =>
      Effect.succeed({
        ...asset,
        resolvedSource:
          asset.source.kind === "url"
            ? asset.source.path
            : new URL(asset.source.path, `file://${projectRoot}/`).pathname,
      }),
  });
}

export interface RenderPlannerShape {
  readonly buildPlan: (
    input: BuildRenderPlanInput
  ) => Effect.Effect<RenderPlan, never>;
}

export class RenderPlanner extends Context.Service<
  RenderPlanner,
  RenderPlannerShape
>()("@vbaas/core/renderer/RenderPlanner") {}

export interface FfmpegShape {
  readonly render: (
    input: FfmpegRenderInput
  ) => Effect.Effect<void, FfmpegFailed>;
}

export class Ffmpeg extends Context.Service<Ffmpeg, FfmpegShape>()(
  "@vbaas/core/renderer/Ffmpeg"
) {
  static Noop = Layer.succeed(this, {
    render: () => Effect.void,
  });
}

export interface FrameSequenceRendererShape {
  readonly renderEncodedVideo: (
    input: RenderFrameSequenceInput
  ) => Effect.Effect<RenderEncodedVideoResult, FrameSequenceFailed>;
  readonly renderFrameSequence: (
    input: RenderFrameSequenceInput
  ) => Effect.Effect<RenderFrameSequenceResult, FrameSequenceFailed>;
  readonly renderFrameStream: (
    input: RenderFrameSequenceInput
  ) => Effect.Effect<RenderFrameStreamResult, FrameSequenceFailed>;
}

export class FrameSequenceRenderer extends Context.Service<
  FrameSequenceRenderer,
  FrameSequenceRendererShape
>()("@vbaas/core/renderer/FrameSequenceRenderer") {}

export interface CommandExecutorShape {
  readonly run: (
    input: CommandInput
  ) => Effect.Effect<CommandResult, CommandExecutionFailed>;
}

export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorShape
>()("@vbaas/core/renderer/CommandExecutor") {}

export interface TempDirectoryShape {
  readonly withTempDirectory: <A, E, R>(
    use: (path: string) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | TempDirectoryFailed, R>;
}

export class TempDirectory extends Context.Service<
  TempDirectory,
  TempDirectoryShape
>()("@vbaas/core/renderer/TempDirectory") {
  static Test = Layer.succeed(this, {
    withTempDirectory: (use) => use("/tmp/vbaas-render-test"),
  });
}

export type RendererServices =
  | AssetResolver
  | Ffmpeg
  | FrameSequenceRenderer
  | RenderPlanner
  | TempDirectory;

export interface RenderCompositionServiceShape {
  readonly renderComposition: (
    input: RenderCompositionInput
  ) => Effect.Effect<unknown, unknown, RendererServices>;
}
